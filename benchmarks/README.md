# Benchmark

```
node http.js
node http2.js
```

## HTTP1

Compare `apollo-datasource-http` (HTTP1) with apollo's `apollo-datasource-rest`  (HTTP1 + keepalive).

```
❯ node benchmarks/http.js
{
  'apollo-datasource-rest (http1)': { startTime: 11400374808900n, endTime: 11400984968900n },
  'apollo-datasource-http (http1)': { startTime: 11400392984400n, endTime: 11400996973700n }
}
Results for 1000 subsequent requests: 
apollo-datasource-rest (http1) | total time: 610160000ns (610.160ms)
apollo-datasource-http (http1) | total time: 603989300ns (603.989ms)
---
apollo-datasource-http (http1) <> apollo-datasource-rest (http1) percent change: -1.011%
```

**Result:** Difference of +-1%. You can use `apollo-datasource-http` without noticeable performance cost.

## HTTP2 vs HTTP1

Compare `apollo-datasource-http` (HTTP2) with apollo's `apollo-datasource-rest` (HTTP1 + keepalive).

```
❯ node benchmarks/http2.js
{
  'apollo-datasource-rest (http1)': { startTime: 11433280599700n, endTime: 11433935846300n },
  'apollo-datasource-http (http2)': { startTime: 11433296884100n, endTime: 11434310028100n },
  'h2url (http2)': { startTime: 11433246480200n, endTime: 11435060063800n }
}
Results for 1000 subsequent requests: 
apollo-datasource-rest (http1) | total time: 655246600ns (655.247ms)
apollo-datasource-http (http2) | total time: 1013144000ns (1013.144ms)
h2url (http2)             | total time: 1813583600ns (1813.584ms)
---
apollo-datasource-http (http2) <> apollo-datasource-rest (http1) percent change: 54.620%
apollo-datasource-http (http2) <> h2url (http2) percent change: -44.136%
```

**Result:** Currently, HTTP2 is slower than HTTPS + keepalive. There is currently no reason to switch. The overhead must be discovered. 
