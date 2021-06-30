import { DataSource, DataSourceConfig } from 'apollo-datasource'
import { Client, Pool } from 'undici'
import { STATUS_CODES } from 'http'
import QuickLRU from '@alloc/quick-lru'
import sjson from 'secure-json-parse'
import AbortController from 'abort-controller'

import Keyv, { Store } from 'keyv'
import { KeyValueCache } from 'apollo-server-caching'
import { DispatchOptions, ResponseData } from 'undici/types/dispatcher'
import { ApolloError } from 'apollo-server-errors'

export type CacheTTLOptions = {
  requestCache?: {
    // The maximum time an item is cached
    maxTtl: number
    // The maximum time an item fetched from the cache is case of an error. This value must be greater than `maxTtl`.
    maxTtlIfError: number
  }
}

export type ClientRequestOptions = Omit<DispatchOptions, 'origin' | 'path' | 'method'> & CacheTTLOptions

export type RequestOptions = DispatchOptions & CacheTTLOptions

export type Response<TResult> = {
  body: TResult
} & Omit<ResponseData, 'body'>

export interface LRUOptions {
  readonly maxAge?: number
  readonly maxSize: number
}

export interface HTTPDataSourceOptions {
  pool?: Pool
  requestOptions?: ClientRequestOptions
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

// https://en.wikipedia.org/wiki/List_of_HTTP_status_codes#2xx_success
const cacheableStatusCodes = [200, 201, 202, 203, 206]

/**
 * HTTPDataSource is an optimized HTTP Data Source for Apollo Server
 * It focus on reliability and performance.
 */
export abstract class HTTPDataSource<TContext = any> extends DataSource {
  public context!: TContext
  private storageAdapter!: Keyv
  private readonly pool: Pool
  private readonly globalRequestOptions?: ClientRequestOptions
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

  protected isResponseCacheable<TResult = unknown>(
    requestOptions: RequestOptions,
    response: Response<TResult>,
  ): boolean {
    return cacheableStatusCodes.indexOf(response.statusCode) > -1 && requestOptions.method === 'GET'
  }

  /**
   * onCacheKeyCalculation returns the key for the GET request.
   * The key is used to memoize the request in the LRU cache.
   *
   * @param request
   * @returns
   */
  protected onCacheKeyCalculation(requestOptions: RequestOptions): string {
    return requestOptions.origin + requestOptions.path
  }

  /**
   * onRequest is executed before a request is made and isn't executed for memoized calls.
   * You can manipulate the request e.g to add/remove headers.
   *
   * @param request
   */
  protected onRequest?(requestOptions: ClientRequestOptions): void

  /**
   * onResponse is executed when a response has been received.
   * By default the implementation will throw for for unsuccessful responses.
   *
   * @param _requestOptions
   * @param response
   */
  protected onResponse<TResult = unknown>(
    _requestOptions: RequestOptions,
    response: Response<TResult>,
  ): Response<TResult> {
    if (this.isResponseOk(response.statusCode)) {
      return response
    }

    throw new ApolloError(
      `Response code ${response.statusCode} (${STATUS_CODES[response.statusCode]})`,
      response.statusCode.toString(),
    )
  }

  protected onError?(_error: Error, requestOptions: RequestOptions): void

  protected async get<TResult = unknown>(
    path: string,
    requestOptions?: ClientRequestOptions,
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
    requestOptions?: ClientRequestOptions,
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
    requestOptions?: ClientRequestOptions,
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
    requestOptions?: ClientRequestOptions,
  ): Promise<Response<TResult>> {
    return await this.request<TResult>({
      ...requestOptions,
      method: 'PUT',
      path,
      origin: this.baseURL,
    })
  }

  private async performRequest<TResult>(
    options: RequestOptions,
    cacheKey: string,
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
        json = sjson.parse(data)
      }

      const response: Response<TResult> = {
        ...responseData,
        body: json,
      }

      this.onResponse<TResult>(options, response)

      if (options.requestCache && this.isResponseCacheable<TResult>(options, response)) {
        this.storageAdapter.set(cacheKey, response, options.requestCache?.maxTtl)
        this.storageAdapter.set(
          `staleIfError:${cacheKey}`,
          response,
          options.requestCache?.maxTtlIfError,
        )
      }

      return response
    } catch (error) {
      this.onError?.(error, options)

      if (options.requestCache) {
        const hasFallback: Response<TResult> = await this.storageAdapter.get(
          `staleIfError:${cacheKey}`,
        )
        if (hasFallback) {
          return hasFallback
        }
      }

      throw error
    }
  }

  private async request<TResult = unknown>(
    requestOptions: RequestOptions,
  ): Promise<Response<TResult>> {
    const cacheKey = this.onCacheKeyCalculation(requestOptions)
    const ttlCacheEnabled = requestOptions.requestCache

    // check if we have any GET call in the cache and respond immediatly
    if (requestOptions.method === 'GET' && ttlCacheEnabled) {
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

    // Memoize GET calls for the same data source instance
    // a single instance of the data sources is scoped to one graphql request
    if (options.method === 'GET') {
      const cachedResponse = this.memoizedResults.get(cacheKey)
      if (cachedResponse) {
        return cachedResponse
      }

      const response = await this.performRequest<TResult>(options, cacheKey)

      if (this.isResponseCacheable<TResult>(options, response)) {
        this.memoizedResults.set(cacheKey, response)
      }

      return response
    }

    return this.performRequest<TResult>(options, cacheKey)
  }
}
