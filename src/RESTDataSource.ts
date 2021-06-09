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
import Keyv, { Store } from "keyv";
import { KeyValueCache } from "apollo-server-caching";

export type Request = OptionsOfJSONResponseBody;

function apolloKeyValueCacheToKeyv(cache: KeyValueCache): Store<string> {
  return {
    get(key: string) {
      return cache.get(key);
    },
    clear() {},
    async delete(key: string) {
      const result = await cache.delete(key);
      if (result === false) {
        return false;
      }
      return true;
    },
    set(key: string, value: string, ttl?: number) {
      return cache.set(key, value, {
        ttl,
      });
    },
  };
}

export abstract class RESTDataSource<TContext = any> extends DataSource {
  public baseURL?: string;
  public context!: TContext;
  private storageAdapter!: Keyv;
  private memoizedResults: QuickLRU<string, Response<any>> = new QuickLRU({
    maxSize: 100,
    maxAge: 10000,
  });
  private agents!: Agents;

  constructor(private globalRequestOpts?: OptionsOfJSONResponseBody) {
    super();
    this.agents = {
      http: new HttpAgent({
        scheduling: "lifo"
      }),
      https: new HttpsAgent({
        scheduling: "lifo"
      }),
    };
  }

  initialize(config: DataSourceConfig<TContext>): void {
    this.context = config.context;
    this.storageAdapter = new Keyv({
      store: apolloKeyValueCacheToKeyv(config.cache),
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

      const options = got.mergeOptions(
        {
          cache: this.storageAdapter,
          responseType: "json",
          timeout: 5000,
          agent: this.agents,
          prefixUrl: this.baseURL,
        },
        {
          ...this.globalRequestOpts,
        },
        request
      );

      const response: Response<TResult> = await got(
        `${request.pathname}`,
        options as OptionsOfJSONResponseBody
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
