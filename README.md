# Apollo HTTP Data Source

[![CI](https://github.com/StarpTech/apollo-datasource-http/actions/workflows/ci.yml/badge.svg)](https://github.com/StarpTech/apollo-datasource-http/actions/workflows/ci.yml)

Optimized HTTP Data Source for Apollo Server

- JSON by default
- HTTP/1 [Keep-alive agents](https://github.com/node-modules/agentkeepalive) for socket reuse
- HTTP/2 support (requires Node.js 15.10.0 or newer)
- Uses [Got](https://github.com/sindresorhus/got) a modern HTTP Client shipped with:
  - Retry mechanism
  - Request cancellation
  - Timeout handling
  - RFC 7234 compliant HTTP caching
- Request Deduplication and a Resource Cache
- Support [AbortController ](https://github.com/mysticatea/abort-controller) to manually cancel all running requests
- Support for [Apollo Cache Storage backend](https://www.apollographql.com/docs/apollo-server/data/data-sources/#using-memcachedredis-as-a-cache-storage-backend)

## Documentation

View the [Apollo Server documentation for data sources](https://www.apollographql.com/docs/apollo-server/features/data-sources/) for more details.

## Usage

To get started, install the `apollo-datasource-http` package:

```bash
npm install apollo-datasource-http
```

To define a data source, extend the [`HTTPDataSource`](./src/http-data-source.ts) class and implement the data fetching methods that your resolvers require. Data sources can then be provided via the `dataSources` property to the `ApolloServer` constructor, as demonstrated in the section below.

```ts
const server = new ApolloServer({
  typeDefs,
  resolvers,
  dataSources: () => {
    return {
      moviesAPI: new MoviesAPI(),
    }
  },
})
```

Your implementation of these methods can call on convenience methods built into the [HTTPDataSource](./src/http-data-source.ts) class to perform HTTP requests, while making it easy to pass different options and handle errors.

```ts
import { HTTPDataSource } from 'apollo-datasource-http'

const datasource = new (class MoviesAPI extends HTTPDataSource {
  constructor() {
    // global client options
    super({
      requestOptions: {
        timeout: 2000,
        http2: true,
        headers: {
          'X-Client': 'client',
        },
      },
    })
    this.baseURL = 'https://movies-api.example.com'
  }

  onCacheKeyCalculation(requestOptions: RequestOptions): string {
    // return different key based on request options
  }

  onRequest(requestOptions: RequestOptions): void {
    // manipulate request
  }

  onResponse<TResult = unknown>(request: Request, response: Response<TResult>): void {
    // manipulate response or handle unsuccessful response in a different way
    return super.onResponse(request, response)
  }

  onError(error: RequestError): void {
    // log errors
  }

  async getMovie(id) {
    return this.get(`/movies/${id}`, {
      headers: {
        'X-Foo': 'bar',
      },
      timeout: 3000,
    })
  }
})()

// cancel all running requests e.g when request is closed prematurely
datasource.abort()
```

## Hooks

- `onCacheKeyCalculation` - Returns the cache key for request memoization.
- `onRequest` - Is executed before a request is made. This can be used to intercept requests (setting header, timeouts ...).
- `onResponse` - Is executed when a response has been received. This can be used to alter the response before it is passed to caller or to log errors.
- `onError` - Is executed for any error.

## Error handling

The http client throws for unsuccessful responses (statusCode >= 400). In case of an request error `onError` is executed. By default the error is rethrown as an instance of `ApolloError`.
