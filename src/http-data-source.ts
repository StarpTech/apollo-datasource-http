import { DataSource, DataSourceConfig } from 'apollo-datasource'
import { Pool } from 'undici'
import { STATUS_CODES } from 'http'
import QuickLRU from '@alloc/quick-lru'
import sjson from 'secure-json-parse'

import { KeyValueCache } from 'apollo-server-caching'
import { ResponseData, RequestOptions as UndiciRequestOptions } from 'undici/types/dispatcher'
import { ApolloError } from 'apollo-server-errors'
import { EventEmitter, Readable } from 'stream'
import { Logger } from 'apollo-server-types'
import { URLSearchParams } from 'url'

type AbortSignal = unknown

export type CacheTTLOptions = {
  requestCache?: {
    // The maximum time an item is cached (seconds)
    maxTtl: number
    // The maximum time an item fetched from the cache is case of an error (seconds). This value must be greater than `maxTtl`
    maxTtlIfError: number
  }
}

interface Dictionary<T> {
  [Key: string]: T | undefined
}

export type RequestOptions = {
  context?: Dictionary<string>
  query?: Dictionary<string | number>
  body?: string | Buffer | Uint8Array | Readable | null
  headers?: Dictionary<string>
  signal?: AbortSignal | EventEmitter | null
} & CacheTTLOptions

export type Request = UndiciRequestOptions &
  CacheTTLOptions & {
    context?: Dictionary<string>
    headers: Dictionary<string>
    query?: Dictionary<string | number>
  }

export type Response<TResult> = {
  body: TResult
  memoized: boolean
  isFromCache: boolean
  // maximum ttl (seconds)
  maxTtl?: number
} & Omit<ResponseData, 'body'>

export interface LRUOptions {
  readonly maxAge?: number
  readonly maxSize: number
}

export interface HTTPDataSourceOptions {
  logger?: Logger
  pool?: Pool
  requestOptions?: RequestOptions
  clientOptions?: Pool.Options
  lru?: Partial<LRUOptions>
}

// https://en.wikipedia.org/wiki/List_of_HTTP_status_codes#2xx_success
const cacheableStatusCodes = [200, 201, 202, 203, 206]

/**
 * HTTPDataSource is an optimized HTTP Data Source for Apollo Server
 * It focus on reliability and performance.
 */
export abstract class HTTPDataSource<TContext = any> extends DataSource {
  public context!: TContext
  private pool: Pool
  private logger?: Logger
  private cache!: KeyValueCache<string>
  private globalRequestOptions?: RequestOptions
  private readonly memoizedResults: QuickLRU<string, Promise<Response<any>>>

  constructor(public readonly baseURL: string, private readonly options?: HTTPDataSourceOptions) {
    super()
    this.memoizedResults = new QuickLRU({
      maxSize: this.options?.lru?.maxSize ? this.options.lru.maxSize : 100,
    })
    this.pool = options?.pool ?? new Pool(this.baseURL, options?.clientOptions)
    this.globalRequestOptions = options?.requestOptions
    this.logger = options?.logger
  }

  private buildQueryString(query: Dictionary<string | number>): string {
    const params = new URLSearchParams()
    for (const key in query) {
      if (Object.prototype.hasOwnProperty.call(query, key)) {
        const value = query[key]
        if (value !== undefined) {
          params.append(key, value.toString())
        }
      }
    }
    return params.toString()
  }

  /**
   * Initialize the datasource with apollo internals (context, cache).
   *
   * @param config
   */
  initialize(config: DataSourceConfig<TContext>): void {
    this.context = config.context
    this.cache = config.cache
  }

  protected isResponseOk(statusCode: number): boolean {
    return (statusCode >= 200 && statusCode <= 399) || statusCode === 304
  }

  protected isResponseCacheable<TResult = unknown>(
    request: Request,
    response: Response<TResult>,
  ): boolean {
    return cacheableStatusCodes.indexOf(response.statusCode) > -1 && request.method === 'GET'
  }

  /**
   * onCacheKeyCalculation returns the key for the GET request.
   * The key is used to memoize the request in the LRU cache.
   *
   * @param request
   * @returns
   */
  protected onCacheKeyCalculation(request: Request): string {
    return request.origin + request.path
  }

  /**
   * onRequest is executed before a request is made and isn't executed for memoized calls.
   * You can manipulate the request e.g to add/remove headers.
   *
   * @param request
   */
  protected async onRequest?(request: Request): Promise<void>

  /**
   * onResponse is executed when a response has been received.
   * By default the implementation will throw for for unsuccessful responses.
   *
   * @param _request
   * @param response
   */
  protected onResponse<TResult = unknown>(
    _request: Request,
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

  protected onError?(_error: Error, requestOptions: Request): void

  public async get<TResult = unknown>(
    path: string,
    requestOptions?: RequestOptions,
  ): Promise<Response<TResult>> {
    return this.request<TResult>({
      headers: {},
      ...requestOptions,
      method: 'GET',
      path,
      origin: this.baseURL,
    })
  }

  public async post<TResult = unknown>(
    path: string,
    requestOptions?: RequestOptions,
  ): Promise<Response<TResult>> {
    return this.request<TResult>({
      headers: {},
      ...requestOptions,
      method: 'POST',
      path,
      origin: this.baseURL,
    })
  }

  public async delete<TResult = unknown>(
    path: string,
    requestOptions?: RequestOptions,
  ): Promise<Response<TResult>> {
    return this.request<TResult>({
      headers: {},
      ...requestOptions,
      method: 'DELETE',
      path,
      origin: this.baseURL,
    })
  }

  public async put<TResult = unknown>(
    path: string,
    requestOptions?: RequestOptions,
  ): Promise<Response<TResult>> {
    return this.request<TResult>({
      headers: {},
      ...requestOptions,
      method: 'PUT',
      path,
      origin: this.baseURL,
    })
  }

  public async patch<TResult = unknown>(
    path: string,
    requestOptions?: RequestOptions,
  ): Promise<Response<TResult>> {
    return this.request<TResult>({
      headers: {},
      ...requestOptions,
      method: 'PATCH',
      path,
      origin: this.baseURL,
    })
  }

  private async performRequest<TResult>(
    request: Request,
    cacheKey: string,
  ): Promise<Response<TResult>> {
    await this.onRequest?.(request)

    try {
      const responseData = await this.pool.request({
        method: request.method,
        origin: request.origin,
        path: request.path,
        body: request.body,
        headers: request.headers,
        signal: request.signal,
      })

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
        isFromCache: false,
        memoized: false,
        ...responseData,
        body: json,
      }

      this.onResponse<TResult>(request, response)

      // let's see if we can fill the shared cache
      if (request.requestCache && this.isResponseCacheable<TResult>(request, response)) {
        response.maxTtl = Math.max(request.requestCache.maxTtl, request.requestCache.maxTtlIfError)
        const cachedResponse = JSON.stringify(response)
        this.cache
          .set(cacheKey, cachedResponse, {
            ttl: request.requestCache?.maxTtl,
          })
          .catch((err) => this.logger?.error(err))
        this.cache
          .set(`staleIfError:${cacheKey}`, cachedResponse, {
            ttl: request.requestCache?.maxTtlIfError,
          })
          .catch((err) => this.logger?.error(err))
      }

      return response
    } catch (error) {
      this.onError?.(error, request)

      if (request.requestCache) {
        const cacheItem = await this.cache.get(`staleIfError:${cacheKey}`)
        if (cacheItem) {
          const response: Response<TResult> = sjson.parse(cacheItem)
          response.isFromCache = true
          return response
        }
      }

      throw error
    }
  }

  private async request<TResult = unknown>(request: Request): Promise<Response<TResult>> {
    if (request?.query) {
      request.path = request.path + '?' + this.buildQueryString(request.query)
    }

    const cacheKey = this.onCacheKeyCalculation(request)

    // check if we have any GET call in the cache to respond immediatly
    if (request.method === 'GET') {
      // Memoize GET calls for the same data source instance
      // a single instance of the data sources is scoped to one graphql request
      if (this.memoizedResults.has(cacheKey)) {
        const response = await this.memoizedResults.get(cacheKey)!
        response.memoized = true
        response.isFromCache = false
        return response
      }
    }

    const options = {
      ...request,
      ...this.globalRequestOptions,
    }

    if (options.method === 'GET') {
      // try to fetch from shared cache
      if (request.requestCache) {
        const cacheItem = await this.cache.get(cacheKey)
        if (cacheItem) {
          const cachedResponse: Response<TResult> = sjson.parse(cacheItem)
          cachedResponse.memoized = false
          cachedResponse.isFromCache = true
          return cachedResponse
        }
      }

      const response = this.performRequest<TResult>(options, cacheKey)
      this.memoizedResults.set(cacheKey, response)

      return response
    }

    return this.performRequest<TResult>(options, cacheKey)
  }
}
