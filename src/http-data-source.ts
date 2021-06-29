import { DataSource, DataSourceConfig } from 'apollo-datasource'
import got, {
  Agents,
  RequestError,
  NormalizedOptions,
  OptionsOfJSONResponseBody,
  Response,
  GotReturn as Request,
  HTTPError,
  PlainResponse,
} from 'got'
import QuickLRU from '@alloc/quick-lru'
import AbortController from 'abort-controller'

import HttpAgent from 'agentkeepalive'

import { ApolloError, AuthenticationError, ForbiddenError } from 'apollo-server-errors'
import Keyv, { Store } from 'keyv'
import { KeyValueCache } from 'apollo-server-caching'

const { HttpsAgent } = HttpAgent

export type RequestOptions = OptionsOfJSONResponseBody | NormalizedOptions
export interface LRUOptions {
  readonly maxAge?: number
  readonly maxSize: number
}

export interface HTTPDataSourceOptions {
  requestOptions?: Partial<RequestOptions>
  lru?: Partial<LRUOptions>
}

function apolloKeyValueCacheToKeyv(cache: KeyValueCache): Store<string> {
  return {
    async get(key: string) {
      return await cache.get(key)
    },
    clear() {
      throw new Error('clear() method is not supported by apollo key value cache')
    },
    async delete(key: string) {
      const result = await cache.delete(key)
      if (result === false) {
        return false
      }

      return true
    },
    async set(key: string, value: string, ttl?: number) {
      return await cache.set(key, value, {
        ttl,
      })
    },
  }
}

/**
 * HTTPDataSource is an optimized HTTP Data Source for Apollo Server
 * It focus on reliability and performance.
 */
export abstract class HTTPDataSource<TContext = any> extends DataSource {
  private static readonly agents: Agents = {
    http: new HttpAgent({
      keepAlive: true,
      // New default starting with Node 16
      scheduling: 'lifo',
    }),
    https: new HttpsAgent({
      keepAlive: true,
      scheduling: 'lifo',
    }),
  }

  public baseURL?: string
  public context!: TContext
  private storageAdapter!: Keyv
  private readonly abortController: AbortController
  private readonly memoizedResults: QuickLRU<string, Response<any>>

  constructor(private readonly options?: HTTPDataSourceOptions) {
    super()
    this.memoizedResults = new QuickLRU({
      maxSize: this.options?.lru?.maxSize ? this.options.lru.maxSize : 100,
    })
    this.abortController = new AbortController()
  }

  /**
   * Initialize the datasource with apollo internals (context, cache).
   *
   * @param config
   */
  initialize(config: DataSourceConfig<TContext>): void {
    this.context = config.context
    this.storageAdapter = new Keyv({
      store: apolloKeyValueCacheToKeyv(config.cache),
    })
  }

  /**
   * Abort and signal to any request that the associated activity is to be aborted.
   */
  abort() {
    this.abortController.abort()
  }

  protected isResponseOk(response: PlainResponse): boolean {
    const { statusCode } = response
    const limitStatusCode = response.request.options.followRedirect ? 299 : 399

    return (statusCode >= 200 && statusCode <= limitStatusCode) || statusCode === 304
  }

  /**
   * onCacheKeyCalculation returns the key for the GET request.
   * The key is used to memoize the request in the LRU cache.
   *
   * @param request
   * @returns
   */
  protected onCacheKeyCalculation(requestOptions: RequestOptions): string {
    if (requestOptions.url) return requestOptions.url.toString()
    throw new Error('No Cache key provided')
  }

  /**
   * onRequest is executed before a request is made and isn't executed for memoized calls.
   * You can manipulate the request e.g to add/remove headers.
   *
   * @param request
   */
  protected onRequest?(requestOptions: RequestOptions): void

  /**
   * onResponse is executed when a response has been received.
   * By default the implementation will throw for for unsuccessful responses.
   *
   * @param _error
   * @param _request
   */
  protected onResponse<TResult = unknown>(
    _request: Request,
    response: Response<TResult>,
  ): Response<TResult> {
    if (this.isResponseOk(response)) {
      return response
    }

    throw new HTTPError(response)
  }

  protected onError?(_error: RequestError): void

  protected async get<TResult = unknown>(
    url: string,
    requestOptions?: RequestOptions,
  ): Promise<Response<TResult>> {
    return await this.request(url, {
      method: 'GET',
      ...requestOptions,
    })
  }

  protected async post<TResult = unknown>(
    url: string,
    requestOptions?: RequestOptions,
  ): Promise<Response<TResult>> {
    return await this.request(url, {
      method: 'POST',
      ...requestOptions,
    })
  }

  protected async delete<TResult = unknown>(
    url: string,
    requestOptions?: RequestOptions,
  ): Promise<Response<TResult>> {
    return await this.request(url, {
      method: 'DELETE',
      ...requestOptions,
    })
  }

  protected async put<TResult = unknown>(
    url: string,
    requestOptions?: RequestOptions,
  ): Promise<Response<TResult>> {
    return await this.request(url, {
      method: 'PUT',
      ...requestOptions,
    })
  }

  private async performRequest<TResult>(options: NormalizedOptions) {
    this.onRequest?.(options)

    const cancelableRequest = got<TResult>(options as OptionsOfJSONResponseBody)

    const abort = () => {
      cancelableRequest.cancel('abortController')
    }

    this.abortController.signal.addEventListener('abort', abort)

    try {
      const response = await cancelableRequest
      this.abortController.signal.removeEventListener('abort', abort)
      this.onResponse<TResult>(response.request, response)

      return response
    } catch (error) {
      let error_ = error

      // same mapping as in apollo-datasource-rest
      if (error instanceof HTTPError) {
        if (error.response.statusCode === 401) {
          const err = new AuthenticationError(error.message)
          err.originalError = error
          error_ = err
        } else if (error.response.statusCode === 403) {
          const err = new ForbiddenError(error.message)
          err.originalError = error
          error_ = err
        } else {
          const err = new ApolloError(error.message, error.code)
          err.originalError = error
          error_ = err
        }
      }

      // pass original error
      this.onError?.(error)

      this.abortController.signal.removeEventListener('abort', abort)

      // throw wrapped error
      throw error_
    }
  }

  private async request<TResult = unknown>(
    path: string,
    requestOptions: RequestOptions,
  ): Promise<Response<TResult>> {
    const options = got.mergeOptions(
      {
        cache: this.storageAdapter,
        path,
        responseType: 'json',
        throwHttpErrors: false,
        timeout: 5000,
        agent: HTTPDataSource.agents,
        prefixUrl: this.baseURL,
      },
      {
        ...this.options?.requestOptions,
      },
      requestOptions,
    )

    const cacheKey = this.onCacheKeyCalculation(options)

    // Memoize get call for the same data source instance
    // data sources are scoped to the current request
    if (options.method === 'GET') {
      const cachedResponse = this.memoizedResults.get(cacheKey)
      if (cachedResponse) return cachedResponse

      const response = await this.performRequest<TResult>(options)
      this.memoizedResults.set(cacheKey, response)
      return response
    }

    return this.performRequest<TResult>(options)
  }
}
