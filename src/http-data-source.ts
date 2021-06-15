import { DataSource, DataSourceConfig } from 'apollo-datasource'
import got, {
  Agents,
  HTTPError,
  NormalizedOptions,
  OptionsOfJSONResponseBody,
  RequestError,
  Response,
  CacheError,
  UploadError,
  ReadError,
  MaxRedirectsError,
  GotReturn as Request,
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
  requestOptions?: RequestOptions
  lru?: LRUOptions
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

  /**
   * onResponse is executed after a response has been received.
   * You can manipulate the response by returning a different response.
   *
   * @param response
   * @param _request
   * @returns
   */
  protected async onResponse<TResult = unknown>(
    response: Response<TResult>,
    _request: Request,
  ): Promise<Response<TResult>> {
    return response
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
   * beforeRequest is executed before a request is made and isn't executed for memoized calls.
   * You can manipulate the request e.g add/remove headers.
   *
   * @param request
   */
  protected beforeRequest?(requestOptions?: RequestOptions): Promise<void>

  /**
   * onRequestError is executed for any request error.
   * The raw error is passed. The thrown error might be different.
   *
   * @param _error
   * @param _request
   */
  protected onRequestError?(_error: Error, _request?: Request): Promise<void>

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
    if (this.beforeRequest != null) {
      await this.beforeRequest(options)
    }

    const cancelableRequest = got<TResult>(options as OptionsOfJSONResponseBody)

    const abort = () => {
      cancelableRequest.cancel('abortController')
    }

    this.abortController.signal.addEventListener('abort', abort)

    try {
      const response = await cancelableRequest
      return this.onResponse<TResult>(response, cancelableRequest)
    } catch (error) {
      let error_ = error

      if (error instanceof HTTPError) {
        if (error.response.statusCode === 401) {
          error_ = new AuthenticationError(error.message)
        } else if (error.response.statusCode === 403) {
          error_ = new ForbiddenError(error.message)
        } else {
          error_ = new ApolloError(error.message)
        }
      }

      if (
        this.onRequestError &&
        (error instanceof RequestError ||
          error instanceof HTTPError ||
          error instanceof CacheError ||
          error instanceof UploadError ||
          error instanceof ReadError ||
          error instanceof MaxRedirectsError)
      ) {
        await this.onRequestError(error, error.request)
      }

      throw error_
    } finally {
      this.abortController.signal.removeEventListener('abort', abort)
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
