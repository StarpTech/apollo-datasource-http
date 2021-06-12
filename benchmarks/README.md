# Benchmark

Compare `apollo-datasource-http` with apollo's `apollo-datasource-rest`

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