import { DataSource, DataSourceConfig } from "apollo-datasource";
import got, {
  Agents,
  HTTPError,
  OptionsOfJSONResponseBody,
  Response,
} from "got";
import QuickLRU from "@alloc/quick-lru";

import HttpAgent from "agentkeepalive";

const { HttpsAgent } = HttpAgent;

import {
  ApolloError,
  AuthenticationError,
  ForbiddenError,
} from "apollo-server-errors";
import Keyv from "keyv";

export type Request = OptionsOfJSONResponseBody;

export abstract class RESTDataSource<TContext = any> extends DataSource {
  public baseURL?: string;
  public context!: TContext;
  private storageAdapter!: Keyv;
  private memoizedResults: QuickLRU<string, Response<any>> = new QuickLRU({
    maxSize: 100,
    maxAge: 10000,
  });
  private agents!: Agents;

  constructor(private requestOpts?: OptionsOfJSONResponseBody) {
    super();
    this.agents = {
      http: new HttpAgent(),
      https: new HttpsAgent(),
    };
  }

  initialize(config: DataSourceConfig<TContext>): void {
    this.context = config.context;
    // add custom adapter to support apollo cache
    this.storageAdapter = new Keyv({
      store: {
        get(key: string) {
          return config.cache.get(key);
        },
        clear() {},
        async delete(key: string) {
          const result = await config.cache.delete(key);
          if (result === false) {
            return false;
          }
          return true;
        },
        set(key: string, value: string, ttl?: number) {
          return config.cache.set(key, value, {
            ttl,
          });
        },
      },
    });
  }

  private async request<TResult = unknown>(
    request: Request
  ): Promise<Response<TResult>> {
    try {
      const cacheKey = this.cacheKey(request);

      // memoize get call for the same data source instance
      // data sources are scoped to the current request
      if (request.method === "GET") {
        const response = this.memoizedResults.get(cacheKey);
        if (response) return response;
      } else {
        this.memoizedResults.delete(cacheKey);
      }

      if (this.willSendRequest) {
        this.willSendRequest(request);
      }

      const response: Response<TResult> = await got(
        `${this.baseURL}${request.path}`,
        {
          cache: this.storageAdapter,
          responseType: "json",
          timeout: 5000,
          agent: this.agents,
          ...this.requestOpts,
          ...request,
        }
      );

      this.memoizedResults.set(cacheKey, response);

      return this.didReceiveResponse<TResult>(response, request);
    } catch (error) {
      let err = error;

      this.didEncounterError(error);

      if (error instanceof HTTPError) {
        if (error.code === "401") {
          err = new AuthenticationError(error.message);
        } else if (error.code === "403") {
          err = new ForbiddenError(error.message);
        } else {
          err = new ApolloError(error.message);
        }
      }

      throw err;
    }
  }

  protected async didReceiveResponse<TResult = unknown>(
    response: Response<TResult>,
    _request: Request
  ): Promise<Response<TResult>> {
    return response;
  }

  protected cacheKey(request: Request): string {
    return `${this.baseURL}${request.path}`;
  }

  protected willSendRequest?(request?: Request): Promise<void>;

  protected didEncounterError(_error: Error) {}

  protected async get<TResult = unknown>(
    request: Request
  ): Promise<Response<TResult>> {
    return this.request({
      method: "GET",
      ...request,
    });
  }

  protected async post<TResult = unknown>(
    request: Request
  ): Promise<Response<TResult>> {
    return this.request({
      method: "POST",
      ...request,
    });
  }

  protected async delete<TResult = unknown>(
    request: Request
  ): Promise<Response<TResult>> {
    return this.request({
      method: "DELETE",
      ...request,
    });
  }

  protected async put<TResult = unknown>(
    request: Request
  ): Promise<Response<TResult>> {
    return this.request({
      method: "PUT",
      ...request,
    });
  }
}
