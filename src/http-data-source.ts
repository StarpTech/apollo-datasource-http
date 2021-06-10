import {DataSource, DataSourceConfig} from 'apollo-datasource';
import got, {
	Agents,
	HTTPError,
	NormalizedOptions,
	OptionsOfJSONResponseBody,
	Response
} from 'got';
import QuickLRU from '@alloc/quick-lru';
import AbortController from 'abort-controller';

import HttpAgent from 'agentkeepalive';

import {
	ApolloError,
	AuthenticationError,
	ForbiddenError
} from 'apollo-server-errors';
import Keyv, {Store} from 'keyv';
import {KeyValueCache} from 'apollo-server-caching';

const {HttpsAgent} = HttpAgent;

export type Request = OptionsOfJSONResponseBody | NormalizedOptions;
export interface LRUOptions {
	readonly maxAge?: number;
	readonly maxSize: number;
}

export interface HTTPDataSourceOptions {
	request?: OptionsOfJSONResponseBody;
	lru?: LRUOptions;
}

function apolloKeyValueCacheToKeyv(cache: KeyValueCache): Store<string> {
	return {
		async get(key: string) {
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
		async set(key: string, value: string, ttl?: number) {
			return cache.set(key, value, {
				ttl
			});
		}
	};
}

export abstract class HTTPDataSource<TContext = any> extends DataSource {
	private static readonly agents: Agents = {
		http: new HttpAgent({
			keepAlive: true,
			// New default starting with Node 16
			scheduling: 'lifo'
		}),
		https: new HttpsAgent({
			keepAlive: true,
			scheduling: 'lifo'
		})
	};

	public baseURL?: string;
	public context!: TContext;
	public abortController: AbortController;
	private storageAdapter!: Keyv;
	private readonly memoizedResults: QuickLRU<string, Response<any>>;

	constructor(private readonly options?: HTTPDataSourceOptions) {
		super();
		this.memoizedResults = new QuickLRU({
			maxSize: this.options?.lru?.maxSize ? this.options.lru.maxSize : 100
		});
		this.abortController = new AbortController();
	}

	initialize(config: DataSourceConfig<TContext>): void {
		this.context = config.context;
		this.storageAdapter = new Keyv({
			store: apolloKeyValueCacheToKeyv(config.cache)
		});
	}

	protected async didReceiveResponse<TResult = unknown>(
		response: Response<TResult>,
		_request: Request
	): Promise<Response<TResult>> {
		return response;
	}

	protected cacheKey(request: Request): string {
		if (request.url) return request.url.toString();
		throw new Error('No Cache key provided');
	}

	protected willSendRequest?(request?: Request): Promise<void>;

	protected didEncounterError(_error: Error) {}

	protected async get<TResult = unknown>(
		url: string,
		request?: Request
	): Promise<Response<TResult>> {
		return this.request(url, {
			method: 'GET',
			...request
		});
	}

	protected async post<TResult = unknown>(
		url: string,
		request?: Request
	): Promise<Response<TResult>> {
		return this.request(url, {
			method: 'POST',
			...request
		});
	}

	protected async delete<TResult = unknown>(
		url: string,
		request?: Request
	): Promise<Response<TResult>> {
		return this.request(url, {
			method: 'DELETE',
			...request
		});
	}

	protected async put<TResult = unknown>(
		url: string,
		request?: Request
	): Promise<Response<TResult>> {
		return this.request(url, {
			method: 'PUT',
			...request
		});
	}

	private async request<TResult = unknown>(
		path: string,
		request: Request
	): Promise<Response<TResult>> {
		const options = got.mergeOptions(
			{
				cache: this.storageAdapter,
				path,
				responseType: 'json',
				timeout: 5000,
				agent: HTTPDataSource.agents,
				prefixUrl: this.baseURL
			},
			{
				...this.options?.request
			},
			request
		);

		const cacheKey = this.cacheKey(options);

		// Memoize get call for the same data source instance
		// data sources are scoped to the current request
		if (options.method === 'GET') {
			const response = this.memoizedResults.get(cacheKey);
			if (response) return response;
		}

		if (this.willSendRequest) {
			await this.willSendRequest(options);
		}

		const cancelableRequest = got<TResult>(
			options as OptionsOfJSONResponseBody
		);

		const abort = () => {
			cancelableRequest.cancel('abortController');
		};

		this.abortController.signal.addEventListener('abort', abort);

		try {
			const response = await cancelableRequest;
			this.memoizedResults.set(cacheKey, response);
			return this.didReceiveResponse<TResult>(response, options);
		} catch (error) {
			let error_ = error;

			this.didEncounterError(error);

			if (error instanceof HTTPError) {
				if (error.response.statusCode === 401) {
					error_ = new AuthenticationError(error.message);
				} else if (error.response.statusCode === 403) {
					error_ = new ForbiddenError(error.message);
				} else {
					error_ = new ApolloError(error.message);
				}
			}

			throw error_;
		} finally {
			this.abortController.signal.removeEventListener('abort', abort);
		}
	}
}
