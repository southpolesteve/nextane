# Pages rendering comparison

This benchmark renders the same small Pages Router workload in:

- Next.js 16.2.12 with React 19.2.7;
- Vinext 1.0.0-beta.4 with React 19.2.7; and
- the current local Nextane checkout with Octane 0.1.19.

Each page uses server-side props, renders the same heading, timestamp, counter,
and 20 list rows, then hydrates the counter in the browser.

The harness measures repeated production build wall time, browser-requested
JavaScript, HTML size, build artifact size, hydration correctness, and local
production request throughput. Results are written to `results/latest.json`
and summarized in the project documentation.

The checked-in result uses two build warmups, seven rotated build samples,
3,000 request warmups per framework, and five rotated 1,000-request rounds at
concurrency 16. Set the `NEXTANE_BENCH_*` environment variables in `run.mjs` to
change the sample sizes.

The default comparison installs Vinext from npm. To benchmark a different
built checkout, set `NEXTANE_BENCH_VINEXT_REPO` to its root and
`NEXTANE_BENCH_VINEXT_CLI` to `packages/vinext/dist/cli.js` within that
checkout.

These are framework-shaped local measurements, not a universal performance
claim. Next.js and Vinext run their Node production servers in this comparison;
Nextane runs through local workerd. Server artifact layouts are reported but
are not directly equivalent.
