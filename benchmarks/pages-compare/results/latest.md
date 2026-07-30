# Pages rendering benchmark

Generated 2026-07-30T18:03:22.433Z on Apple M4.

## Results

| Metric | Next.js | Vinext | Nextane |
| --- | ---: | ---: | ---: |
| Production build, median | 1120.6 ms | 468.8 ms | 1187.8 ms |
| Cold-page JS, raw | 353.9 KiB | 247.3 KiB | 124.8 KiB |
| Cold-page JS, gzip | 109.9 KiB | 77.8 KiB | 41.0 KiB |
| SSR HTML, raw | 2.2 KiB | 2.2 KiB | 1.8 KiB |
| SSR HTML, gzip | 0.7 KiB | 0.8 KiB | 0.7 KiB |
| Local SSR requests/sec, median | 3058.4 | 2615.7 | 1631.8 |
| Local SSR p50 | 4.3 ms | 4.2 ms | 8.0 ms |
| Client artifact JS/CSS, gzip | 125.2 KiB | 92.1 KiB | 41.0 KiB |
| Server artifact JS/CSS, gzip | 48.9 KiB | 48.5 KiB | 34.4 KiB |

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
- Nextane source 678940d+dirty
