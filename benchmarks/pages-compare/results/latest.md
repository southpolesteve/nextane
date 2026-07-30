# Pages rendering benchmark

Generated 2026-07-30T18:41:55.281Z on Apple M4.

## Results

| Metric | Next.js | Vinext | Nextane |
| --- | ---: | ---: | ---: |
| Production build, median | 1061.1 ms | 408.4 ms | 1055.0 ms |
| Cold-page JS, raw | 353.9 KiB | 247.2 KiB | 131.0 KiB |
| Cold-page JS, gzip | 110.0 KiB | 77.8 KiB | 43.0 KiB |
| SSR HTML, raw | 2.2 KiB | 2.2 KiB | 1.8 KiB |
| SSR HTML, gzip | 0.7 KiB | 0.8 KiB | 0.7 KiB |
| Local SSR requests/sec, median | 4021.5 | 3323.4 | 1696.2 |
| Local SSR p50 | 3.4 ms | 3.9 ms | 7.7 ms |
| Client artifact JS/CSS, gzip | 125.2 KiB | 92.0 KiB | 43.0 KiB |
| Server artifact JS/CSS, gzip | 49.1 KiB | 47.8 KiB | 34.5 KiB |

All three produced the same normalized visible text and hydrated `Count: 0` to
`Count: 1`. Browser JavaScript counts only unique `.js` responses requested
by a cold page load; gzip is calculated per requested file.

Next.js and Vinext used their local Node production servers. Nextane used
local workerd. Throughput therefore compares the current product stacks, not
isolated renderer speed. Server artifact layouts are also not equivalent.

## Versions

- Next.js 16.2.12
- React 19.2.8
- Vinext 1.0.0-beta.4 (npm package)
- Octane 0.1.21
- Nextane source b98e895+dirty
