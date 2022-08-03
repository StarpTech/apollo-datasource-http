# Benchmark

```
node http.js
```

## HTTP1

Compare `apollo-datasource-http` (HTTP1 + Undici Pool) with apollo's `apollo-datasource-rest` (HTTP1 + keepalive).

```
❯ node benchmarks/http.js
{
  'apollo-datasource-rest (http1)': { startTime: 12631206300610n, endTime: 12632239922219n },
  'apollo-datasource-http (http1)': { startTime: 12631187804518n, endTime: 12631777587439n }
}
Results for 1000 subsequent requests:
apollo-datasource-rest (http1) | total time: 1033621609ns (1033.622ms)
apollo-datasource-http (http1) | total time: 589782921ns (589.783ms)
---
apollo-datasource-http (http1) <> apollo-datasource-rest (http1) percent change: -42.940%
```

**Result:** `apollo-datasource-http` is around `43%` faster than `apollo-datasource-rest`
