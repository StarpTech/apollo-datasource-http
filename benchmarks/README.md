# Benchmark

```
node http.js
```

## HTTP1

Compare `apollo-datasource-http` (HTTP1 + Undici Pool) with apollo's `apollo-datasource-rest`  (HTTP1 + keepalive).

```
❯ node benchmarks/http.js
{
  'apollo-datasource-rest (http1)': { startTime: 114330370557900n, endTime: 114331160850400n },
  'apollo-datasource-http (http1)': { startTime: 114330327205800n, endTime: 114330690627800n }
}
Results for 1000 subsequent requests: 
apollo-datasource-rest (http1) | total time: 790292500ns (790.293ms)
apollo-datasource-http (http1) | total time: 363422000ns (363.422ms)
---
apollo-datasource-http (http1) <> apollo-datasource-rest (http1) percent change: -54.014%
```

**Result:** `apollo-datasource-http` is around `54%` faster than `apollo-datasource-rest`
