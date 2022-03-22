import { DataSource, DataSourceConfig } from 'apollo-datasource'
import { Pool } from 'undici'
import { STATUS_CODES } from 'http'
import QuickLRU from '@alloc/quick-lru'

import { createUnzip, createBrotliDecompress } from 'zlib'
import streamToPromise from 'stream-to-promise'
import { KeyValueCache } from 'apollo-server-caching'
import Dispatcher, { HttpMethod, ResponseData } from 'undici/types/dispatcher'
import { toApolloError } from 'apollo-server-errors'
import { EventEmitter } from 'stream'
import { Logger } from 'apollo-server-types'
import { URLSearchParams } from 'url'

type AbortSignal = unknown

export class RequestError<T = unknown> extends Error {
  constructor(
    public message: string,
    public code: number,
    public request: Request,
    public response: Response<T>,
  ) {
    super(message)
    this.name = 'RequestError'
  }
}

export type CacheTTLOptions = {
  requestCache?: {
    // The maximum time an item is cached in seconds.
    maxTtl: number
    // The maximum time the cache should be used when the re-fetch from the origin fails.
    maxTtlIfError: number
  }
}

interface Dictionary<T> {
  [Key: string]: T | undefined
}

export type RequestOptions = Omit<Partial<Request>, 'origin' | 'path' | 'method'>

export type Request<T = unknown> = {
  context: Dictionary<string>
  query: Dictionary<string | number>
  body: T
  signal?: AbortSignal | EventEmitter | null
  json?: boolean
  origin: string
  path: string
  method: HttpMethod
  // Indicates if the response of this request should be memoized
  memoize?: boolean
  headers: Dictionary<string>
} & CacheTTLOptions

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

// rfc7231 6.1
// We only cache status codes that indicates a successful response
// We don't cache redirects, client errors because we expect to cache JSON payload.
const statusCodeCacheableByDefault = new Set([200, 203])

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
  private readonly memoizedResults: QuickLRU<string, Response<any>>

  constructor(public readonly baseURL: string, private readonly options?: HTTPDataSourceOptions) {
    super()
    this.memoizedResults = new QuickLRU({
      // The maximum number of items before evicting the least recently used items.
      maxSize: this.options?.lru?.maxSize ? this.options.lru.maxSize : 100,
      // The maximum number of milliseconds an item should remain in cache.
      // By default maxAge will be Infinity, which means that items will never expire.
      maxAge: this.options?.lru?.maxAge,
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

    // avoid cache fragmentation when the query order is not guaranteed
    params.sort()

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
    return statusCode >= 200 && statusCode <= 399
  }

  protected isResponseCacheable<TResult = unknown>(
    request: Request,
    response: Response<TResult>,
  ): boolean {
    return statusCodeCacheableByDefault.has(response.statusCode) && this.isRequestCacheable(request)
  }

  protected isRequestCacheable(request: Request): boolean {
    // default behaviour is to cache only get requests
    // If extending to non GET requests take care to provide an adequate onCacheKeyCalculation and isResponseCacheable
    return request.method === 'GET'
  }

  /**
   * Checks if the GET request is memoizable. This validation is performed before the
   * response is set in **memoizedResults**.
   * @param request
   * @returns *true* if request should be memoized
   */
  protected isRequestMemoizable(request: Request): boolean {
    return Boolean(request.memoize) && request.method === 'GET'
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
    request: Request,
    response: Response<TResult>,
  ): Response<TResult> {
    if (this.isResponseOk(response.statusCode)) {
      return response
    }

    throw new RequestError(
      `Response code ${response.statusCode} (${STATUS_CODES[response.statusCode.toString()]})`,
      response.statusCode,
      request,
      response,
    )
  }

  protected onError?(_error: Error, requestOptions: Request): void

  /**
   * Execute a HTTP GET request.
   * Note that the **memoizedResults** and **cache** will be checked before request is made.
   * By default the received response will be memoized.
   *
   * @param path the path to the resource
   * @param requestOptions
   */
  public async get<TResult = unknown>(
    path: string,
    requestOptions?: RequestOptions,
  ): Promise<Response<TResult>> {
    return this.request<TResult>({
      headers: {},
      query: {},
      body: null,
      memoize: true,
      context: {},
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
      query: {},
      body: null,
      context: {},
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
      query: {},
      body: null,
      context: {},
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
      query: {},
      body: null,
      context: {},
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
      query: {},
      body: null,
      context: {},
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
    try {
      // in case of JSON set appropriate content-type header
      if (request.body !== null && typeof request.body === 'object') {
        if (request.headers['content-type'] === undefined) {
          request.headers['content-type'] = 'application/json; charset=utf-8'
        }
        request.body = JSON.stringify(request.body)
      }

      await this.onRequest?.(request)

      const requestOptions: Dispatcher.RequestOptions = {
        method: request.method,
        origin: request.origin,
        path: request.path,
        headers: request.headers,
        signal: request.signal,
        body: request.body as string,
      }

      const responseData = await this.pool.request(requestOptions)
      const body = responseData.body
      const headers = responseData.headers

      let dataBuffer: Buffer
      switch (headers['content-encoding']) {
        case 'br':
          dataBuffer = await streamToPromise(body.pipe(createBrotliDecompress()))
          break
        case 'gzip':
        case 'deflate':
          dataBuffer = await streamToPromise(body.pipe(createUnzip()))
          break
        default:
          dataBuffer = await streamToPromise(body)
          break
      }

      // This will be string initially, but may become any once JSON parsed.
      let data: any = dataBuffer.toString('utf-8')

      // can we parse it as JSON?
      if (
        responseData.headers['content-type']?.includes('application/json') &&
        data.length &&
        typeof data === 'string'
      ) {
        data = JSON.parse(data)
      }
      const response: Response<TResult> = {
        isFromCache: false,
        memoized: false,
        ...responseData,
        // in case of the server does not properly respond with JSON we pass it as text.
        // this is necessary since POST, DELETE don't always have a JSON body.
        body: data as unknown as TResult,
      }

      this.onResponse<TResult>(request, response)

      if (this.isRequestMemoizable(request)) {
        this.memoizedResults.set(cacheKey, response)
      }

      // let's see if we can fill the shared cache
      if (request.requestCache && this.isResponseCacheable<TResult>(request, response)) {
        response.maxTtl = request.requestCache.maxTtl
        const cachedResponse = JSON.stringify(response)

        // respond with the result immediately without waiting for the cache
        this.cache
          .set(cacheKey, cachedResponse, {
            ttl: request.requestCache.maxTtl,
          })
          .catch((err) => this.logger?.error(err))
        this.cache
          .set(`staleIfError:${cacheKey}`, cachedResponse, {
            ttl: request.requestCache.maxTtl + request.requestCache.maxTtlIfError,
          })
          .catch((err) => this.logger?.error(err))
      }
      return response
    } catch (error: any) {
      this.onError?.(error, request)

      // in case of an error we try to respond with a stale result from the stale-if-error cache
      if (request.requestCache) {
        const cacheItem = await this.cache.get(`staleIfError:${cacheKey}`)

        if (cacheItem) {
          const response: Response<TResult> = JSON.parse(cacheItem)
          response.isFromCache = true
          return response
        }
      }

      throw toApolloError(error)
    }
  }

  private async request<TResult = unknown>(request: Request): Promise<Response<TResult>> {
    if (Object.keys(request.query).length > 0) {
      request.path = request.path + '?' + this.buildQueryString(request.query)
    }

    const cacheKey = this.onCacheKeyCalculation(request)

    const isRequestMemoizable = this.isRequestMemoizable(request)

    // check if we have a memoizable call in the cache to respond immediately
    if (isRequestMemoizable) {
      // Memoize calls for the same data source instance
      // a single instance of the data sources is scoped to one graphql request
      if (this.memoizedResults.has(cacheKey)) {
        const response = this.memoizedResults.get(cacheKey)!
        response.memoized = true
        response.isFromCache = false
        return response
      }
    }

    const headers = {
      ...(this.globalRequestOptions?.headers || {}),
      ...request.headers,
    }

    const options = {
      ...this.globalRequestOptions,
      ...request,
      headers,
    }

    const requestIsCacheable = this.isRequestCacheable(request)

    if (requestIsCacheable) {
      // try to fetch from shared cache
      if (request.requestCache) {
        try {
          const cacheItem = await this.cache.get(cacheKey)
          if (cacheItem) {
            const cachedResponse: Response<TResult> = JSON.parse(cacheItem)
            cachedResponse.memoized = false
            cachedResponse.isFromCache = true
            return cachedResponse
          }
          const response = this.performRequest<TResult>(options, cacheKey)

          return response
        } catch (error: any) {
          this.logger?.error(`Cache item '${cacheKey}' could not be loaded: ${error.message}`)
        }
      }

      const response = this.performRequest<TResult>(options, cacheKey)

      return response
    }

    return this.performRequest<TResult>(options, cacheKey)
  }
}
