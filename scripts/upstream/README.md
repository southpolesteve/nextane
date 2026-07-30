# Next.js deploy-test smoke harness

This is a deliberately narrow first adapter for running selected upstream
Next.js Pages Router tests against an Octane-native Nextane build. It does not
modify Nextane's runtime and it refuses fixtures outside the checked-in
allowlist.

The first completed local baseline is Next.js `v16.2.2`. Prepare that checkout
using the normal Next.js repository instructions, then run:

```sh
NEXTANE_NEXT_VERSION=16.2.2 \
  npm run test:upstream -- /absolute/path/to/next.js
```

The runner's default target remains Next.js `v16.2.6`, so a prepared v16.2.6
checkout can omit `NEXTANE_NEXT_VERSION`:

```sh
npm run test:upstream -- /absolute/path/to/next.js
```

The 19 selected test files are:

- `test/e2e/hello-world/hello-world.test.ts`
- `test/e2e/404-page-router/index.test.ts`
- `test/e2e/dynamic-route-interpolation/index.test.ts`
- `test/e2e/getserversideprops/test/index.test.ts`
- `test/e2e/app-document/rendering.test.ts`
- `test/e2e/api-resolver-query-writeable/api-resolver-query-writeable.test.ts`
- `test/e2e/async-modules/index.test.ts`
- `test/e2e/edge-pages-support/index.test.ts`
- `test/e2e/new-link-behavior/index.test.ts`
- `test/e2e/next-head/index.test.ts`
- `test/e2e/with-router/index.test.ts`
- `test/e2e/use-router-with-rewrites/use-router-with-rewrites.test.ts`
- `test/e2e/legacy-link-behavior-pages/index.test.ts`
- `test/e2e/edge-api-endpoints-can-receive-body/index.test.ts`
- `test/e2e/edge-runtime-pages-api-route/edge-runtime-pages-api-route.test.ts`
- `test/e2e/error-handler-not-found-req-url/error-handler-not-found-req-url.test.ts`
- `test/e2e/trailing-slashes/with-trailing-slash.test.ts`
- `test/e2e/trailing-slashes/without-trailing-slash.test.ts`
- `test/e2e/prerender.test.ts`

For each isolated fixture, `adapt-fixture.mjs`:

1. identifies the fixture from stable file signatures;
2. renames JSX-bearing Pages Router and explicitly allowlisted component
   modules to `.tsrx`;
3. rewrites `next/head`, `next/link`, `next/router`, `next/document`, and React
   hook imports;
4. applies small, reviewable functional-Octane overlays for class-based `_app`
   and `_document` code while exercising Nextane's real Document runtime;
5. writes a Vite, Cloudflare Worker, HTML-shell, and Wrangler configuration;
6. records the exact changes in `.nextane-upstream-adaptation.json`.

The prerender profile also strips an unused production-tracing-only Firebase
import, replaces one Worker-incompatible filesystem read with Vite `?raw`,
and warms the two large-data pages before the deploy adapter snapshots logs.
The upstream test cases themselves remain unchanged.

Unknown fixtures fail closed. The adapter builds locally and starts Wrangler;
it never deploys or publishes anything.

## Current result

Against the local Next.js `v16.2.2` baseline:

- **252/252 substantive upstream deploy test cases passed** across server
  rendering/data, async modules, modern and legacy Link, Head, router rewrites
  and events, `withRouter`, classic and Edge API routes, custom error handling,
  both trailing-slash configurations, and all 63 prerendering/revalidation
  deploy cases.
- **6 additional deploy-mode skip sentinels passed but are excluded from the
  substantive denominator**:
  - `404-page-router`: five `should skip for deploy` cases;
  - `api-resolver-query-writeable`: one `should skip next deploy` case.
- **2 production-only routes-manifest assertions are skipped** in deploy mode.

The full runner therefore has 258 passing test cases, but **258 must not be
described as substantive compatibility coverage**. The honest smoke result is
252/252 with six sentinels and two production-only skips reported separately.
Nextane's own upstream conformance test covers writable API `req.query`
because that upstream suite skips deploy mode.

Run the harness unit/conformance tests with:

```sh
npm run test:upstream:harness
```

## Provenance

The deploy/log/cleanup lifecycle and manifest shape were adapted from Vinext's
MIT-licensed scripts:

- `scripts/e2e-deploy.sh`
- `scripts/e2e-logs.sh`
- `scripts/e2e-cleanup.sh`
- `scripts/run-nextjs-deploy-suite.sh`
- `scripts/nextjs-deploy-manifest.mjs`

Source checkout used while creating this harness:
[`cloudflare/vinext@e4aa03ac`](https://github.com/cloudflare/vinext/tree/e4aa03ac5c95992a73f9c15bb4f395fb6730fa5f).
