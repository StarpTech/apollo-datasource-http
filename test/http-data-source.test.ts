import anyTest, { TestInterface } from 'ava'
import http from 'http'
import { setGlobalDispatcher, Agent, Pool } from 'undici'
import AbortController from 'abort-controller'
import { HTTPDataSource, Request, Response } from '../src'
import { AddressInfo } from 'net'
import { KeyValueCacheSetOptions } from 'apollo-server-caching'

const agent = new Agent({
  keepAliveTimeout: 10, // milliseconds
  keepAliveMaxTimeout: 10, // milliseconds
})

setGlobalDispatcher(agent)

const test = anyTest as TestInterface<{ path: string }>

test('Should be able to make a simple GET call', async (t) => {
  t.plan(5)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
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

test('Should be able to pass query params', async (t) => {
  t.plan(3)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    t.is(req.url, '/?a=1&b=2')
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

test('Should error', async (t) => {
  t.plan(2)

  const path = '/'

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
    res.writeHead(401)
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

  await t.throwsAsync(
    dataSource.getFoo(),
    {
      instanceOf: Error,
      message: 'Response code 401 (Unauthorized)',
    },
    'Unauthenticated',
  )
})

test('Should memoize subsequent GET calls to the same endpoint', async (t) => {
  t.plan(17)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
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

  let response = await dataSource.getFoo()
  t.deepEqual(response.body, { name: 'foo' })
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.falsy(response.maxTtl)

  response = await dataSource.getFoo()
  t.deepEqual(response.body, { name: 'foo' })
  t.false(response.isFromCache)
  t.true(response.memoized)
  t.falsy(response.maxTtl)

  response = await dataSource.getFoo()
  t.deepEqual(response.body, { name: 'foo' })
  t.false(response.isFromCache)
  t.true(response.memoized)
  t.falsy(response.maxTtl)

  response = await dataSource.getFoo()
  t.deepEqual(response.body, { name: 'foo' })
  t.false(response.isFromCache)
  t.true(response.memoized)
  t.falsy(response.maxTtl)
})

test('Should be able to define a custom cache key for request memoization', async (t) => {
  t.plan(7)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
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
  t.deepEqual(response.body, { name: 'foo' })

  response = await dataSource.getFoo()
  t.deepEqual(response.body, { name: 'foo' })
})

test('Should call onError on request error', async (t) => {
  t.plan(7)

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

    onResponse<TResult = any>(requestOptions: Request, response: Response<TResult>) {
      t.truthy(requestOptions)
      t.truthy(response)
      t.pass('onResponse')
      return super.onResponse<TResult>(requestOptions, response)
    }

    onError(error: Error) {
      t.truthy(error)
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
      message: 'Response code 500 (Internal Server Error)',
    },
    'Server error',
  )
})

test.cb('Should abort request', (t) => {
  t.plan(2)

  const path = '/'

  const server = http
    .createServer((req, res) => {
      t.is(req.method, 'GET')
      setTimeout(() => {
        res.writeHead(200)
        res.end()
        res.socket?.unref()
      }, 500)
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

test.cb('Should timeout', (t) => {
  t.plan(3)

  const path = '/'

  const server = http
    .createServer((req, res) => {
      t.is(req.method, 'GET')
      setTimeout(() => {
        res.writeHead(200)
        res.end()
        res.socket?.unref()
      }, 500)
    })
    .unref()

  t.teardown(server.close.bind(server))

  server.listen()

  const baseURL = `http://localhost:${(server.address() as AddressInfo)?.port}`

  const dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL, {
        clientOptions: {
          bodyTimeout: 100,
          headersTimeout: 100,
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
    onRequest(request: Request) {
      request.headers = {
        'X-Foo': 'bar',
      }
    }
    getFoo() {
      return this.get(path)
    }
  })()

  const response = await dataSource.getFoo()

  t.deepEqual(response.body, { name: 'foo' })
})

test('Initialize data source with cache and context', async (t) => {
  t.plan(3)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
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

  const map = new Map<string, string>()

  dataSource.initialize({
    context: {
      a: 1,
    },
    cache: {
      async delete(key: string) {
        return map.delete(key)
      },
      async get(key: string) {
        return map.get(key)
      },
      async set(key: string, value: string) {
        map.set(key, value)
      },
    },
  })

  const response = await dataSource.getFoo()

  t.deepEqual(response.body, { name: 'foo' })
})

test('Response is cached', async (t) => {
  t.plan(16)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
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
          maxTtl: 10,
          maxTtlIfError: 20,
        },
      })
    }
  })()

  const map = new Map<string, string>()
  const datasSourceConfig = {
    context: {
      a: 1,
    },
    cache: {
      async delete(key: string) {
        return map.delete(key)
      },
      async get(key: string) {
        return map.get(key)
      },
      async set(key: string, value: string) {
        map.set(key, value)
      },
    },
  }

  dataSource.initialize(datasSourceConfig)

  let response = await dataSource.getFoo()
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.is(response.maxTtl, 20)
  t.deepEqual(response.body, { name: 'foo' })

  response = await dataSource.getFoo()
  t.false(response.isFromCache)
  t.true(response.memoized)
  t.is(response.maxTtl, 20)
  t.deepEqual(response.body, { name: 'foo' })

  dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      return this.get(path, {
        requestCache: {
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
  t.deepEqual(response.body, { name: 'foo' })

  const cached = JSON.parse(map.get('keyv:' + baseURL + path)!)

  t.is(map.size, 2)
  t.truthy(cached.expires)
  t.like(cached, {
    value: {
      statusCode: 200,
      trailers: {},
      opaque: null,
      headers: {
        connection: 'keep-alive',
        'keep-alive': 'timeout=5',
        'transfer-encoding': 'chunked',
      },
      body: wanted,
    },
  })
})

test('Fallback from cache on origin error', async (t) => {
  t.plan(12)

  const path = '/'

  const wanted = { name: 'foo' }

  let reqCount = 0

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')

    if (reqCount === 0) res.writeHead(200)
    else res.writeHead(500)

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
          maxTtl: 10,
          maxTtlIfError: 20,
        },
      })
    }
  })()

  const map = new Map<string, string>()
  const datasSourceConfig = {
    context: {
      a: 1,
    },
    cache: {
      async delete(key: string) {
        return map.delete(key)
      },
      async get(key: string) {
        return map.get(key)
      },
      async set(key: string, value: string) {
        map.set(key, value)
      },
    },
  }

  dataSource.initialize(datasSourceConfig)

  let response = await dataSource.getFoo()
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.is(response.maxTtl, 20)

  t.deepEqual(response.body, { name: 'foo' })

  t.is(map.size, 2)

  map.delete('keyv:' + baseURL + path) // ttl is up

  dataSource = new (class extends HTTPDataSource {
    constructor() {
      super(baseURL)
    }
    getFoo() {
      return this.get(path, {
        requestCache: {
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

  t.deepEqual(response.body, { name: 'foo' })

  t.is(map.size, 1)
})

test('Should not cache POST requests', async (t) => {
  t.plan(6)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'POST')
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
          maxTtl: 10,
          maxTtlIfError: 20,
        },
      })
    }
  })()

  const map = new Map<string, string>()

  dataSource.initialize({
    context: {
      a: 1,
    },
    cache: {
      async delete(key: string) {
        return map.delete(key)
      },
      async get(key: string) {
        return map.get(key)
      },
      async set(key: string, value: string, options: KeyValueCacheSetOptions) {
        t.deepEqual(options, { ttl: 10 })
        map.set(key, value)
      },
    },
  })

  const response = await dataSource.postFoo()
  t.false(response.isFromCache)
  t.false(response.memoized)
  t.falsy(response.maxTtl)

  t.deepEqual(response.body, { name: 'foo' })

  t.is(map.size, 0)
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
          maxTtl: 10,
          maxTtlIfError: 20,
        },
      })
    }
  })()

  const map = new Map<string, string>()

  dataSource.initialize({
    context: {
      a: 1,
    },
    cache: {
      async delete(key: string) {
        return map.delete(key)
      },
      async get(key: string) {
        return map.get(key)
      },
      async set(key: string, value: string) {
        console.log(key)

        map.set(key, value)
      },
    },
  })

  await t.throwsAsync(
    dataSource.getFoo(),
    {
      message: 'Response code 500 (Internal Server Error)',
    },
    'message',
  )

  t.is(map.size, 0)
})

test('Should be able to pass custom Undici Pool', async (t) => {
  t.plan(2)

  const path = '/'

  const wanted = { name: 'foo' }

  const server = http.createServer((req, res) => {
    t.is(req.method, 'GET')
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

  t.deepEqual(response.body, { name: 'foo' })
})
