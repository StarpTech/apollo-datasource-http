import anyTest, { TestInterface } from 'ava'
import http from 'http'
import { setGlobalDispatcher, Agent, Pool } from 'undici'
import AbortController from 'abort-controller'
import querystring from 'querystring'
import { HTTPDataSource, Request, Response, RequestError } from '../src'
import { AddressInfo } from 'net'
import { KeyValueCacheSetOptions } from 'apollo-server-caching'

const agent = new Agent({
  keepAliveTimeout: 10, // milliseconds
  keepAliveMaxTimeout: 10, // milliseconds
})

setGlobalDispatcher(agent)

const test = anyTest as TestInterface<{ path: string }>

function delay(t: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve.bind(null), t)
  })
}

test('Should be able to make a simple GET call', async (t) => {
  t.plan(5)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    res.writeHead(200, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      return this.get(path)
    }
  })()

  const response = await dataSource.getFoo()

  t.false(response.isFromCache)
  t.false(response.memoized)
  t.falsy(response.maxTtl)
  t.deepEqual(response.body, { name: 'foo' })
})

test('Should be able to make a simple POST call', async (t) => {
  t.plan(2)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'POST')
    res.writeHead(200, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    postFoo() {
      return this.post(path)
    }
  })()

  const response = await dataSource.postFoo()

  t.deepEqual(response.body, { name: 'foo' })
})

test('Should be able to make a simple DELETE call', async (t) => {
  t.plan(2)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'DELETE')
    res.writeHead(200, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    deleteFoo() {
      return this.delete(path)
    }
  })()

  const response = await dataSource.deleteFoo()

  t.deepEqual(response.body, { name: 'foo' })
})

test('Should be able to make a simple PUT call', async (t) => {
  t.plan(2)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'PUT')
    res.writeHead(200, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    putFoo() {
      return this.put(path)
    }
  })()

  const response = await dataSource.putFoo()

  t.deepEqual(response.body, { name: 'foo' })
})

test('Should be able to make a simple PATCH call', async (t) => {
  t.plan(2)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'PATCH')
    res.writeHead(200, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    patchFoo() {
      return this.patch(path)
    }
  })()

  const response = await dataSource.patchFoo()

  t.deepEqual(response.body, { name: 'foo' })
})

test('Should be able to pass query params', async (t) => {
  t.plan(3)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    t.is(req.url, '/?a=1&b=2')
    res.writeHead(200, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      return this.get(path, {
        query: {
          a: 1,
          b: '2',
          c: undefined,
        },
      })
    }
  })()

  const response = await dataSource.getFoo()

  t.deepEqual(response.body, { name: 'foo' })
})

test('Should error on HTTP errors > 299 and != 304', async (t) => {
  t.plan(4)

  const path = '/'

  const server = http.createServer((req, res) => {
    const queryObject = querystring.parse(req.url?.replace('/?', '')!)
    t.is(req.method, 'GET')
    res.writeHead(queryObject['statusCode'] as unknown as number)
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo(statusCode: number) {
      return this.get(path, {
        query: {
          statusCode,
        },
      })
    }
  })()

  await t.throwsAsync(
    dataSource.getFoo(401),
    {
      instanceOf: Error,
      code: 401,
      message: 'Response code 401 (Unauthorized)',
    },
    'Unauthenticated',
  )

  await t.throwsAsync(
    dataSource.getFoo(500),
    {
      instanceOf: Error,
      code: 500,
      message: 'Response code 500 (Internal Server Error)',
    },
    'Internal Server Error',
  )
})

test('Should not parse content as JSON when content-type header is missing', async (t) => {
  t.plan(3)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    res.writeHead(200)
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      return this.get(path)
    }
  })()

  const response = await dataSource.getFoo()
  t.is(response.statusCode, 200)
  t.is(response.body, JSON.stringify(wanted))
})

test('Should memoize subsequent GET calls to the same endpoint', async (t) => {
  t.plan(17)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    res.writeHead(200, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    setTimeout(() => res.end(), 50).unref()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      return this.get(path)
    }
  })()

  let response = await dataSource.getFoo()
  t.deepEqual(response.body, wanted)
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.falsy(response.maxTtl)

  response = await dataSource.getFoo()
  t.deepEqual(response.body, wanted)
  t.false(response.isFromCache)
  t.true(response.memoized)
  t.falsy(response.maxTtl)

  response = await dataSource.getFoo()
  t.deepEqual(response.body, wanted)
  t.false(response.isFromCache)
  t.true(response.memoized)
  t.falsy(response.maxTtl)

  response = await dataSource.getFoo()
  t.deepEqual(response.body, wanted)
  t.false(response.isFromCache)
  t.true(response.memoized)
  t.falsy(response.maxTtl)
})

test('Should not memoize subsequent GET calls for unsuccessful responses', async (t) => {
  t.plan(17)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    const queryObject = querystring.parse(req.url?.replace('/?', '')!)
    t.is(req.method, 'GET')
    res.writeHead(queryObject['statusCode'] as unknown as number, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    setTimeout(() => res.end(), 50).unref()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    onError(error: Error) {
      if (error instanceof RequestError) {
        t.false(error.response.isFromCache)
        t.false(error.response.memoized)
        t.falsy(error.response.maxTtl)
        t.truthy(error.request)
      }
    }
    getFoo(statusCode: number) {
      return this.get(path, {
        query: {
          statusCode,
        },
      })
    }
  })()

  let response = await dataSource.getFoo(300)
  t.deepEqual(response.body, { name: 'foo' })
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.falsy(response.maxTtl)

  await t.throwsAsync(dataSource.getFoo(401), {
    instanceOf: Error,
    code: 401,
    message: 'Response code 401 (Unauthorized)',
  })
  await t.throwsAsync(dataSource.getFoo(500), {
    instanceOf: Error,
    code: 500,
    message: 'Response code 500 (Internal Server Error)',
  })
})

test('Should be able to define a custom cache key for request memoization', async (t) => {
  t.plan(7)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    res.writeHead(200, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    onCacheKeyCalculation(request: Request) {
      t.pass('onCacheKeyCalculation')
      t.truthy(request)
      return 'foo'
    }
    getFoo() {
      return this.get(path)
    }
  })()

  let response = await dataSource.getFoo()
  t.deepEqual(response.body, wanted)

  response = await dataSource.getFoo()
  t.deepEqual(response.body, wanted)
})

test('Should call onError on request error', async (t) => {
  t.plan(11)

  const path = '/'

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    res.writeHead(500)
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }

    onResponse<TResult = any>(request: Request, response: Response<TResult>) {
      t.truthy(request)
      t.truthy(response)
      t.pass('onResponse')
      return super.onResponse<TResult>(request, response)
    }

    onError(error: Error) {
      t.is(error.name, 'RequestError')
      t.is(error.message, 'Response code 500 (Internal Server Error)')
      if (error instanceof RequestError) {
        t.is(error.code, 500)
        t.truthy(error.request)
        t.truthy(error.response)
      }
      t.pass('onRequestError')
    }

    async getFoo() {
      return await this.get(path)
    }
  })()

  await t.throwsAsync(
    dataSource.getFoo(),
    {
      instanceOf: Error,
      code: 500,
      message: 'Response code 500 (Internal Server Error)',
    },
    'Server error',
  )
})

test('Should be possible to pass a request context', async (t) => {
  t.plan(3)

  const path = '/'

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    res.writeHead(200)
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }

    onResponse<TResult = any>(request: Request, response: Response<TResult>) {
      t.deepEqual(request.context, { a: '1' })
      t.pass('onResponse')
      return super.onResponse<TResult>(request, response)
    }

    async getFoo() {
      return await this.get(path, {
        context: {
          a: '1',
        },
      })
    }
  })()

  await dataSource.getFoo()
})

test.cb('Should abort request when abortController signal is called', (t) => {
  t.plan(2)

  const path = '/'

  const server = http
    .createServer((req, res) => {
      t.is(req.method, 'GET')
      setTimeout(() => {
        res.writeHead(200)
        res.end()
        res.socket?.unref()
      }, 50)
    })
    .unref()

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const abortController = new AbortController()

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }

    async getFoo() {
      return await this.get(path, {
        signal: abortController.signal,
      })
    }
  })()

  t.throwsAsync(
    async () => {
      try {
        await dataSource.getFoo()
        t.fail()
      } catch (error) {
        t.pass('Throw error')
        throw error
      }
    },
    {
      instanceOf: Error,
      message: 'Request aborted',
    },
    'Timeout',
  ).finally(t.end)

  abortController.abort()
})

test.cb('Should timeout because server does not respond fast enough', (t) => {
  t.plan(3)

  const path = '/'

  const server = http
    .createServer((req, res) => {
      t.is(req.method, 'GET')
      setTimeout(() => {
        res.writeHead(200)
        res.end()
        res.socket?.unref()
      }, 100)
    })
    .unref()

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL, {
        clientOptions: {
          bodyTimeout: 50,
          headersTimeout: 50,
        },
      })
    }

    async getFoo() {
      return await this.get(path)
    }
  })()

  t.throwsAsync(
    async () => {
      try {
        await dataSource.getFoo()
        t.fail()
      } catch (error) {
        t.pass('Throw error')
        throw error
      }
    },
    {
      instanceOf: Error,
      message: 'Headers Timeout Error',
    },
    'Timeout',
  ).finally(t.end)
})

test('Should be able to modify request in willSendRequest', async (t) => {
  t.plan(3)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    t.deepEqual(req.headers['x-foo'], 'bar')
    res.writeHead(200, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    async onRequest(request: Request) {
      request.headers = {
        'X-Foo': 'bar',
      }
    }
    getFoo() {
      return this.get(path)
    }
  })()

  const response = await dataSource.getFoo()

  t.deepEqual(response.body, wanted)
})

test('Should be able to define base headers for every request', async (t) => {
  t.plan(4)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    t.deepEqual(req.headers['x-foo'], 'bar')
    res.writeHead(200, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL, {
        requestOptions: {
          headers: {
            'X-Foo': 'bar',
          },
        },
      })
    }
    async onRequest(request: Request) {
      t.deepEqual(request.headers, {
        'X-Foo': 'bar',
      })
    }
    getFoo() {
      return this.get(path)
    }
  })()

  const response = await dataSource.getFoo()

  t.deepEqual(response.body, wanted)
})

test('Initialize data source with cache and context', async (t) => {
  t.plan(3)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    res.writeHead(200, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      t.deepEqual(this.context, {
        a: 1,
      })
      return this.get(path)
    }
  })()

  const cacheMap = new Map<string, string>()

  dataSource.initialize({
    context: {
      a: 1,
    },
    cache: {
      async delete(key: string) {
        return cacheMap.delete(key)
      },
      async get(key: string) {
        return cacheMap.get(key)
      },
      async set(key: string, value: string) {
        cacheMap.set(key, value)
      },
    },
  })

  const response = await dataSource.getFoo()

  t.deepEqual(response.body, wanted)
})

test('Should cache a GET response and respond with the result on subsequent calls', async (t) => {
  t.plan(15)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    res.writeHead(200, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  let dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      return this.get(path, {
        requestCache: {
          maxCacheTimeout: 50,
          maxTtl: 10,
          maxTtlIfError: 20,
        },
      })
    }
  })()

  const cacheMap = new Map<string, string>()
  const datasSourceConfig = {
    context: {
      a: 1,
    },
    cache: {
      async delete(key: string) {
        return cacheMap.delete(key)
      },
      async get(key: string) {
        return cacheMap.get(key)
      },
      async set(key: string, value: string) {
        cacheMap.set(key, value)
      },
    },
  }

  dataSource.initialize(datasSourceConfig)

  let response = await dataSource.getFoo()
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.is(response.maxTtl, 20)
  t.deepEqual(response.body, wanted)

  response = await dataSource.getFoo()
  t.false(response.isFromCache)
  t.true(response.memoized)
  t.is(response.maxTtl, 20)
  t.deepEqual(response.body, wanted)

  dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      return this.get(path, {
        requestCache: {
          maxCacheTimeout: 50,
          maxTtl: 10,
          maxTtlIfError: 20,
        },
      })
    }
  })()

  dataSource.initialize(datasSourceConfig)

  response = await dataSource.getFoo()
  t.true(response.isFromCache)
  t.false(response.memoized)
  t.is(response.maxTtl, 20)
  t.deepEqual(response.body, wanted)

  const cached = JSON.parse(cacheMap.get(baseURL + path)!)

  t.is(cacheMap.size, 2)
  t.like(cached, {
    statusCode: 200,
    trailers: {},
    opaque: null,
    headers: {
      connection: 'keep-alive',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
    },
    body: wanted,
  })
})

test('Should respond with stale-if-error cache on origin error', async (t) => {
  t.plan(12)

  const path = '/'

  const wanted = { name: 'foo' }

  let reqCount = 0

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')

    if (reqCount === 0)
      res.writeHead(200, {
        'content-type': 'application/json',
      })
    else
      res.writeHead(500, {
        'content-type': 'application/json',
      })

    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
    reqCount++
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  let dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      return this.get(path, {
        requestCache: {
          maxCacheTimeout: 50,
          maxTtl: 10,
          maxTtlIfError: 20,
        },
      })
    }
  })()

  const cacheMap = new Map<string, string>()
  const datasSourceConfig = {
    context: {
      a: 1,
    },
    cache: {
      async delete(key: string) {
        return cacheMap.delete(key)
      },
      async get(key: string) {
        return cacheMap.get(key)
      },
      async set(key: string, value: string) {
        cacheMap.set(key, value)
      },
    },
  }

  dataSource.initialize(datasSourceConfig)

  let response = await dataSource.getFoo()
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.is(response.maxTtl, 20)

  t.deepEqual(response.body, wanted)

  t.is(cacheMap.size, 2)

  cacheMap.delete(baseURL + path) // ttl is up

  dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      return this.get(path, {
        requestCache: {
          maxCacheTimeout: 50,
          maxTtl: 10,
          maxTtlIfError: 20,
        },
      })
    }
  })()

  dataSource.initialize(datasSourceConfig)

  response = await dataSource.getFoo()
  t.true(response.isFromCache)
  t.false(response.memoized)
  t.is(response.maxTtl, 20)

  t.deepEqual(response.body, wanted)

  t.is(cacheMap.size, 1)
})

test('Should throw timeout error when the fallback cache does not respond in appropriate time', async (t) => {
  t.plan(8)

  const path = '/'

  const wanted = { name: 'foo' }

  let reqCount = 0

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')

    if (reqCount === 0)
      res.writeHead(200, {
        'content-type': 'application/json',
      })
    else
      res.writeHead(500, {
        'content-type': 'application/json',
      })

    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
    reqCount++
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  let dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      return this.get(path, {
        requestCache: {
          maxCacheTimeout: 50,
          maxTtl: 10,
          maxTtlIfError: 20,
        },
      })
    }
  })()

  const cacheMap = new Map<string, string>()
  const cache = {
    async delete(key: string) {
      return cacheMap.delete(key)
    },
    async get(key: string) {
      return cacheMap.get(key)
    },
    async set(key: string, value: string) {
      cacheMap.set(key, value)
    },
  }
  const datasSourceConfig = {
    context: {
      a: 1,
    },
    cache,
  }

  dataSource.initialize(datasSourceConfig)

  let response = await dataSource.getFoo()
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.is(response.maxTtl, 20)

  t.deepEqual(response.body, wanted)

  t.is(cacheMap.size, 2)

  cacheMap.delete(baseURL + path) // ttl is up

  dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      return this.get(path, {
        requestCache: {
          maxCacheTimeout: 50,
          maxTtl: 10,
          maxTtlIfError: 20,
        },
      })
    }
  })()

  cache.get = async function get() {
    await delay(60)
    return ''
  }

  dataSource.initialize(datasSourceConfig)

  await t.throwsAsync(dataSource.getFoo(), {
    message: 'Promise timed out after 50 milliseconds',
  })
})

test('Should not cache POST requests', async (t) => {
  t.plan(6)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'POST')
    res.writeHead(200, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    postFoo() {
      return this.post(path, {
        requestCache: {
          maxCacheTimeout: 50,
          maxTtl: 10,
          maxTtlIfError: 20,
        },
      })
    }
  })()

  const cacheMap = new Map<string, string>()

  dataSource.initialize({
    context: {
      a: 1,
    },
    cache: {
      async delete(key: string) {
        return cacheMap.delete(key)
      },
      async get(key: string) {
        return cacheMap.get(key)
      },
      async set(key: string, value: string, options: KeyValueCacheSetOptions) {
        t.deepEqual(options, { ttl: 10 })
        cacheMap.set(key, value)
      },
    },
  })

  const response = await dataSource.postFoo()
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.falsy(response.maxTtl)

  t.deepEqual(response.body, wanted)

  t.is(cacheMap.size, 0)
})

test('Should only cache GET successful responses with the correct status code', async (t) => {
  t.plan(30)

  const path = '/'

  const wanted = { name: 'foo' }
  const server = http.createServer((req, res) => {
    const queryObject = querystring.parse(req.url?.replace('/?', '')!)
    t.is(req.method, 'GET')
    res.writeHead(queryObject['statusCode'] as unknown as number, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo(statusCode: number) {
      return this.get(path, {
        query: {
          statusCode,
        },
        requestCache: {
          maxCacheTimeout: 50,
          maxTtl: 10,
          maxTtlIfError: 20,
        },
      })
    }
  })()

  const cacheMap = new Map<string, string>()

  dataSource.initialize({
    context: {
      a: 1,
    },
    cache: {
      async delete(key: string) {
        return cacheMap.delete(key)
      },
      async get(key: string) {
        return cacheMap.get(key)
      },
      async set(key: string, value: string) {
        cacheMap.set(key, value)
      },
    },
  })

  let response = await dataSource.getFoo(200)
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.is(response.maxTtl, 20)
  t.deepEqual(response.body, wanted)
  t.is(cacheMap.size, 2)

  cacheMap.clear()

  response = await dataSource.getFoo(203)
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.is(response.maxTtl, 20)
  t.deepEqual(response.body, wanted)
  t.is(cacheMap.size, 2)

  cacheMap.clear()

  // 204 = no content
  response = await dataSource.getFoo(204)
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.falsy(response.maxTtl)
  t.falsy(response.body)
  t.is(cacheMap.size, 0)

  cacheMap.clear()

  response = await dataSource.getFoo(300)
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.falsy(response.maxTtl)
  t.deepEqual(response.body, wanted)
  t.is(cacheMap.size, 0)

  cacheMap.clear()

  response = await dataSource.getFoo(301)
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.falsy(response.maxTtl)
  t.deepEqual(response.body, wanted)
  t.is(cacheMap.size, 0)
})

test('Response is not cached due to origin error', async (t) => {
  const path = '/'

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    res.writeHead(500)
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      return this.get(path, {
        requestCache: {
          maxCacheTimeout: 50,
          maxTtl: 10,
          maxTtlIfError: 20,
        },
      })
    }
  })()

  const cacheMap = new Map<string, string>()

  dataSource.initialize({
    context: {
      a: 1,
    },
    cache: {
      async delete(key: string) {
        return cacheMap.delete(key)
      },
      async get(key: string) {
        return cacheMap.get(key)
      },
      async set(key: string, value: string) {
        console.log(key)

        cacheMap.set(key, value)
      },
    },
  })

  await t.throwsAsync(
    dataSource.getFoo(),
    {
      message: 'Response code 500 (Internal Server Error)',
      code: 500,
    },
    'message',
  )

  t.is(cacheMap.size, 0)
})

test('Should be able to pass custom Undici Pool', async (t) => {
  t.plan(2)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    res.writeHead(200, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`
  const pool = new Pool(baseURL)

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL, {
        pool,
      })
    }
    getFoo() {
      return this.get(path)
    }
  })()

  const response = await dataSource.getFoo()

  t.deepEqual(response.body, wanted)
})

test('Should abort cache request when cache does not respond in appropriate time', async (t) => {
  t.plan(16)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    res.writeHead(200, {
      'content-type': 'application/json',
    })
    res.write(JSON.stringify(wanted))
    res.end()
    res.socket?.unref()
  })

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  let dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      return this.get(path, {
        requestCache: {
          maxCacheTimeout: 50,
          maxTtl: 10,
          maxTtlIfError: 20,
        },
      })
    }
  })()

  const cacheMap = new Map<string, string>()
  const cache = {
    async delete(key: string) {
      return cacheMap.delete(key)
    },
    async get(key: string) {
      return cacheMap.get(key)
    },
    async set(key: string, value: string) {
      cacheMap.set(key, value)
    },
  }
  const datasSourceConfig = {
    context: {
      a: 1,
    },
    cache,
  }

  dataSource.initialize(datasSourceConfig)

  let response = await dataSource.getFoo()
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.is(response.maxTtl, 20)
  t.deepEqual(response.body, wanted)

  response = await dataSource.getFoo()
  t.false(response.isFromCache)
  t.true(response.memoized)
  t.is(response.maxTtl, 20)
  t.deepEqual(response.body, wanted)

  dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      return this.get(path, {
        requestCache: {
          maxCacheTimeout: 50,
          maxTtl: 10,
          maxTtlIfError: 20,
        },
      })
    }
  })()

  // overwrite getter to simulate a delay in cache request
  cache.get = async function get() {
    await delay(60)
    return ''
  }

  dataSource.initialize(datasSourceConfig)

  response = await dataSource.getFoo()
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.is(response.maxTtl, 20)
  t.deepEqual(response.body, wanted)

  const cached = JSON.parse(cacheMap.get(baseURL + path)!)

  t.is(cacheMap.size, 2)
  t.like(cached, {
    statusCode: 200,
    trailers: {},
    opaque: null,
    headers: {
      connection: 'keep-alive',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
    },
    body: wanted,
  })
})
