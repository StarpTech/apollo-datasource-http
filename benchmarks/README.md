# Benchmark

```
node http.js
```

## HTTP1

Compare `apollo-datasource-http` (HTTP1 + Undici Pool) with apollo's `apollo-datasource-rest`  (HTTP1 + keepalive).

```
❯ node benchmarks/http.js
{
  'apollo-datasource-rest (http1)': { startTime: 5974754539400n, endTime: 5975292928900n },
  'apollo-datasource-http (http1)': { startTime: 5974751416200n, endTime: 5974986816000n }
}
Results for 1000 subsequent requests: 
apollo-datasource-rest (http1) | total time: 538389500ns (538.389ms)
apollo-datasource-http (http1) | total time: 235399800ns (235.400ms)
---
apollo-datasource-http (http1) <> apollo-datasource-rest (http1) percent change: -56.277%
```

**Result:** `apollo-datasource-http` is around `56%` faster than `apollo-datasource-rest`
