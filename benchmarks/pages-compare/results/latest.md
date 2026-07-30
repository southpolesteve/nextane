# Pages rendering benchmark

Generated 2026-07-30T03:15:23.035Z on Apple M4.

## Results

| Metric | Next.js | Vinext | Nextane |
| --- | ---: | ---: | ---: |
| Production build, median | 1111.5 ms | 507.5 ms | 1220.1 ms |
| Cold-page JS, raw | 353.9 KiB | 247.3 KiB | 124.4 KiB |
| Cold-page JS, gzip | 109.9 KiB | 77.8 KiB | 40.8 KiB |
| SSR HTML, raw | 2.2 KiB | 2.2 KiB | 1.8 KiB |
| SSR HTML, gzip | 0.7 KiB | 0.8 KiB | 0.7 KiB |
| Local SSR requests/sec, median | 4163.5 | 3186.9 | 1744.6 |
| Local SSR p50 | 3.5 ms | 4.1 ms | 7.0 ms |
| Client artifact JS/CSS, gzip | 125.2 KiB | 92.1 KiB | 40.8 KiB |
| Server artifact JS/CSS, gzip | 48.9 KiB | 48.4 KiB | 31.3 KiB |

All three produced the same normalized visible text and hydrated `Count: 0` to
`Count: 1`. Browser JavaScript counts only unique `.js` responses requested
by a cold page load; gzip is calculated per requested file.

Next.js and Vinext used their local Node production servers. Nextane used
local workerd. Throughput therefore compares the current product stacks, not
isolated renderer speed. Server artifact layouts are also not equivalent.

## Versions

- Next.js 16.2.12
- React 19.2.7
- Vinext 1.0.0-beta.4 (npm package)
- Octane 0.1.19
- Nextane 0.1.0
