# Next.js vs. Vinext vs. Nextane

On July 30, 2026, the local benchmark rendered the same small Pages Router
page through:

- Next.js 16.2.12 and React 19.2.7;
- Vinext 1.0.0-beta.4 from npm and React 19.2.7; and
- the current local Nextane checkout and Octane 0.1.19.

The page uses `getServerSideProps`, renders a heading, deterministic timestamp,
hydrated counter, and 20 deterministic rows. The normalized visible content
matched across all three, and every counter hydrated from `Count: 0` to
`Count: 1`.

## Results

| Metric | Next.js | Vinext | Nextane |
| --- | ---: | ---: | ---: |
| Production build, median of 7 | 1,120.6 ms | **468.8 ms** | 1,187.8 ms |
| Cold-page JavaScript, raw | 353.9 KiB | 247.3 KiB | **124.8 KiB** |
| Cold-page JavaScript, gzip | 109.9 KiB | 77.8 KiB | **41.0 KiB** |
| SSR HTML, raw | 2.2 KiB | 2.2 KiB | **1.8 KiB** |
| SSR HTML, gzip | 0.7 KiB | 0.8 KiB | **0.7 KiB** |
| Local SSR requests/sec, median | **3,058.4** | 2,615.7 | 1,631.8 |
| Local SSR p50 | 4.3 ms | **4.2 ms** | 8.0 ms |

For this deliberately small hydrated page, Nextane requested:

- **62.7% less gzipped JavaScript than Next.js**; and
- **47.3% less gzipped JavaScript than Vinext**.

The compatibility and security work since the first measurement added 1.7 KiB
of requested gzipped client JavaScript, a 4.3% increase. Nextane's median build
was 6.0% slower than Next.js and 153.4% slower than Vinext. Its sustained local
SSR throughput was 46.6% below Next.js and 37.6% below Vinext.

## What the numbers mean

The client result is the clearest signal. It counts only unique JavaScript
responses requested by a cold Chromium page load, then applies the same
per-file gzip calculation to all three. It does not sum unused chunks sitting
in an output directory.

The server result is a product-stack comparison, not an isolated renderer
microbenchmark:

- Next.js and Vinext ran their local Node production servers;
- Nextane ran through local workerd; and
- each request performed the framework's normal Pages SSR and serialization.

That makes the result relevant to the prototype as it exists, but it does not
tell us whether the difference comes from Octane rendering, Nextane glue,
workerd, or their interaction. Profiling those layers is the next performance
task.

Server output directories are also structurally different, so they are kept
out of the headline. The raw result file reports them for diagnosis, not as a
portable deployment-size claim.

## Reproduce it

The fixture and harness live in `benchmarks/pages-compare`:

```sh
cd /path/to/nextane/benchmarks/pages-compare
npm ci
NEXTANE_BENCH_REQUESTS=1000 \
NEXTANE_BENCH_WARM_REQUESTS=3000 \
  npm run benchmark
```

To compare an alternate Vinext checkout without changing the benchmark's
installed dependency, set `NEXTANE_BENCH_VINEXT_REPO` to its repository root
and `NEXTANE_BENCH_VINEXT_CLI` to its built `packages/vinext/dist/cli.js`.

The full run performs two build warmups, seven rotated build samples, a cold
browser correctness/asset pass, 3,000 request warmups per framework, and five
rotated 1,000-request rounds at concurrency 16.

Machine-readable samples, requested chunk URLs, resource timing, and artifact
inventories are in
`benchmarks/pages-compare/results/latest.json`; the generated summary is in
`benchmarks/pages-compare/results/latest.md`.
