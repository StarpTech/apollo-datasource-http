import { DataSource, DataSourceConfig } from 'apollo-datasource'
import { Client, Pool } from 'undici'
import QuickLRU from '@alloc/quick-lru'
import AbortController from 'abort-controller'

import Keyv, { Store } from 'keyv'
import { KeyValueCache } from 'apollo-server-caching'
import { DispatchOptions, ResponseData } from 'undici/types/dispatcher'

export type CacheTTLOptions = {
  requestCache?: {
    maxTtl: number
  }
}

export type RequestOptions = Omit<DispatchOptions, 'origin' | 'path' | 'method'> & CacheTTLOptions

type InternalRequestOptions = DispatchOptions & CacheTTLOptions

export type Response<TResult> = {
  body: TResult
} & Omit<ResponseData, 'body'>

export interface LRUOptions {
  readonly maxAge?: number
  readonly maxSize: number
}

export interface HTTPDataSourceOptions {
  pool?: Pool
  requestOptions?: RequestOptions
  clientOptions?: Client.Options
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
  public context!: TContext
  private storageAdapter!: Keyv
  private readonly pool: Pool
  private readonly globalRequestOptions?: RequestOptions
  private readonly abortController: AbortController
  private readonly memoizedResults: QuickLRU<string, Response<any>>

  constructor(public readonly baseURL: string, private readonly options?: HTTPDataSourceOptions) {
    super()
    this.memoizedResults = new QuickLRU({
      maxSize: this.options?.lru?.maxSize ? this.options.lru.maxSize : 100,
    })
    this.pool = options?.pool ?? new Pool(this.baseURL, options?.clientOptions)
    this.globalRequestOptions = options?.requestOptions
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

  protected isResponseOk(statusCode: number): boolean {
    return (statusCode >= 200 && statusCode <= 399) || statusCode === 304
  }

  /**
   * onCacheKeyCalculation returns the key for the GET request.
   * The key is used to memoize the request in the LRU cache.
   *
   * @param request
   * @returns
   */
  protected onCacheKeyCalculation(requestOptions: InternalRequestOptions): string {
    return requestOptions.origin + requestOptions.path
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
  protected onResponse<TResult = unknown>(response: Response<TResult>): Response<TResult> {
    if (this.isResponseOk(response.statusCode)) {
      return response
    }

    throw new Error(`Response code ${response.statusCode}`)
  }

  protected onError?(_error: Error): void

  protected async get<TResult = unknown>(
    path: string,
    requestOptions?: RequestOptions,
  ): Promise<Response<TResult>> {
    return await this.request<TResult>({
      ...requestOptions,
      method: 'GET',
      path,
      origin: this.baseURL,
    })
  }

  protected async post<TResult = unknown>(
    path: string,
    requestOptions?: RequestOptions,
  ): Promise<Response<TResult>> {
    return await this.request<TResult>({
      ...requestOptions,
      method: 'POST',
      path,
      origin: this.baseURL,
    })
  }

  protected async delete<TResult = unknown>(
    path: string,
    requestOptions?: RequestOptions,
  ): Promise<Response<TResult>> {
    return await this.request<TResult>({
      ...requestOptions,
      method: 'DELETE',
      path,
      origin: this.baseURL,
    })
  }

  protected async put<TResult = unknown>(
    path: string,
    requestOptions?: RequestOptions,
  ): Promise<Response<TResult>> {
    return await this.request<TResult>({
      ...requestOptions,
      method: 'PUT',
      path,
      origin: this.baseURL,
    })
  }

  private async performRequest<TResult>(
    options: InternalRequestOptions,
    cacheKey?: string,
  ): Promise<Response<TResult>> {
    this.onRequest?.(options)

    try {
      const responseData = await this.pool.request(options)

      responseData.body.setEncoding('utf8')
      let data = ''
      for await (const chunk of responseData.body) {
        data += chunk
      }

      let json
      if (data) {
        json = JSON.parse(data)
      }

      const response: Response<TResult> = {
        ...responseData,
        body: json,
      }

      this.onResponse<TResult>(response)

      if (cacheKey && options.requestCache) {
        this.storageAdapter.set(cacheKey, json, options.requestCache?.maxTtl)
      }

      return response
    } catch (error) {
      let error_ = error

      if (cacheKey && options.requestCache) {
        const cachedResponseBody = await this.storageAdapter.get(cacheKey)
        if (cachedResponseBody) {
          return cachedResponseBody
        }
      }

      // pass original error
      this.onError?.(error)

      // throw wrapped error
      throw error_
    }
  }

  private async request<TResult = unknown>(
    requestOptions: InternalRequestOptions,
  ): Promise<Response<TResult>> {
    const cacheKey = this.onCacheKeyCalculation(requestOptions)
    const ttlCacheEnabled = requestOptions.requestCache

    if (ttlCacheEnabled) {
      const cachedResponse = await this.storageAdapter.get(cacheKey)
      if (cachedResponse) {
        return cachedResponse
      }
    }

    const options = {
      ...this.globalRequestOptions,
      ...requestOptions,
      signal: this.abortController.signal,
    }

    // Memoize get call for the same data source instance
    // data sources are scoped to the current request
    if (options.method === 'GET') {
      const cachedResponse = this.memoizedResults.get(cacheKey)
      if (cachedResponse) return cachedResponse

      const response = await this.performRequest<TResult>(options, cacheKey)
      this.memoizedResults.set(cacheKey, response)
      return response
    }

    return this.performRequest<TResult>(options, cacheKey)
  }
}
