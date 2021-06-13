# Benchmark

## HTTP1

Compare `apollo-datasource-http` (HTTP1) with apollo's `apollo-datasource-rest`  (HTTP1 + keepalive).

```
{
  'apollo-datasource-rest': { startTime: 86302094103500n, endTime: 86302716018200n },
  'apollo-datasource-http': { startTime: 86302111594200n, endTime: 86302736876100n }
}
Results for 1000 subsequent requests: 
apollo-datasource-rest    | total time: 621914700ns (621.915ms)
apollo-datasource-http    | total time: 625281900ns (625.282ms)
---
apollo-datasource-http <> apollo-datasource-rest percent change: 0.541%
```

**Result:** Difference of +-0.5%. You can use `apollo-datasource-http` without noticeable performance cost.

## HTTP2 vs HTTP1

Compare `apollo-datasource-http` (HTTP2) with apollo's `apollo-datasource-rest` (HTTP1 + keepalive).

```
❯ node benchmarks/http2.js
{
  'apollo-datasource-rest': { startTime: 7983409787700n, endTime: 7983882569300n },
  'apollo-datasource-http': { startTime: 7983425804700n, endTime: 7984164033200n }
}
Results for 1000 subsequent requests: 
apollo-datasource-rest    | total time: 472781600ns (472.782ms)
apollo-datasource-http    | total time: 738228500ns (738.228ms)
---
apollo-datasource-http <> apollo-datasource-rest percent change: 56.146%
```

**Result:** Currently, HTTP2 is slower than HTTPS + keepalive. The reason must be discovered. 
