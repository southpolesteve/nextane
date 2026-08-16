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

The 43 selected test files are:

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
- `test/e2e/app-document/csp.test.ts`
- `test/e2e/app-document/index.test.ts`
- `test/e2e/app-document/client.test.ts`
- `test/e2e/ssr-react-context/index.test.ts`
- `test/e2e/optimized-loading/test/index.test.ts`
- `test/e2e/disable-js-preload/test/index.test.ts`
- `test/e2e/invalid-static-asset-404-pages/invalid-static-asset-404-pages.test.ts`
- `test/e2e/invalid-static-asset-404-pages/invalid-static-asset-404-pages-base-path.test.ts`
- `test/e2e/invalid-static-asset-404-pages/invalid-static-asset-404-pages-asset-prefix.test.ts`
- `test/e2e/prerender-crawler.test.ts`
- `test/e2e/streaming-ssr/index.test.ts`
- `test/e2e/link-with-api-rewrite/index.test.ts`
- `test/e2e/basepath/error-pages.test.ts`
- `test/e2e/basepath/redirect-and-rewrite.test.ts`
- `test/e2e/basepath/router-events.test.ts`
- `test/e2e/basepath/trailing-slash.test.ts`
- `test/e2e/basepath/query-hash.test.ts`
- `test/e2e/i18n-api-support/index.test.ts`
- `test/e2e/i18n-ignore-rewrite-source-locale/rewrites.test.ts`
- `test/e2e/i18n-fallback-collision/i18n-fallback-collision.test.ts`
- `test/e2e/i18n-ignore-redirect-source-locale/redirects.test.ts`
- `test/e2e/i18n-ignore-redirect-source-locale/redirects-with-basepath.test.ts`
- `test/e2e/i18n-default-locale-redirect/i18n-default-locale-redirect.test.ts`
- `test/e2e/useselectedlayoutsegment-s-in-pages-router/useselectedlayoutsegment-s-in-pages-router.test.ts`
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
The ssr-react-context profile replaces the legacy `Context.Consumer` render
prop with `useContext`, the streaming-ssr profile replaces one styled-jsx
block with a plain string `style`, the basepath profile replaces a
`next/error` import and rewrites the event-log `_app` without its
optional-function-parameter custom hook (octane's compiled hook calls append
a slot sentinel that would land in that parameter), and the
i18n-fallback-collision profile translates the fixture's `next.config.ts` to a
`next.config.js` overlay because the build-time config loader cannot require
TypeScript. Each fixture also gets a `node_modules/octane` symlink so
environment-aware runtime resolution applies instead of a static alias. The
upstream test cases themselves remain unchanged.

The upstream Next.js runner requires the Node version supported by the
checkout (Node 20/22); set `NEXTANE_NODE_BIN` to Nextane's own Node binary so
the fixture build and Wrangler use it while `run-tests.js` runs on the
upstream-supported version.

Unknown fixtures fail closed. The adapter builds locally and starts Wrangler;
it never deploys or publishes anything.

## Current result

Against the local Next.js `v16.2.2` baseline, the 43-file run produced
**373/374 substantive upstream deploy test cases passing**:

- original rendering/data/link/head/router/API/trailing-slash baseline: 189/189;
- prerendering, `getStaticPaths` fallback modes, page-data caching, ISR,
  on-demand revalidation, and Preview Mode cookies: 63/63 (the previously
  expected Preview Mode failure now passes with signed preview cookies);
- the additional `_app`/`_document` files (CSP hash/nonce documents and log
  hygiene): 3/3;
- SSR React context: 2/2; script loading (`optimized-loading`,
  `disable-js-preload`): 8/8; invalid static asset 404s across the plain,
  `basePath`, and `assetPrefix` variants: 9/9; crawler-aware fallback
  prerendering: 3/3; streaming SSR: 5/5; `has`-conditional rewrites to API
  routes: 2/2;
- i18n (locale-prefixed routing with an unprefixed default locale):
  `i18n-api-support` 2/2, `i18n-ignore-rewrite-source-locale` (`locale:false`
  rewrites) 8/8, `i18n-fallback-collision` (locale-strip before multi-level
  dynamic matching) 11/11, and `i18n-ignore-redirect-source-locale`
  (`locale:false` redirects with the destination locale reflected in
  `router.locale`, plain and under `basePath`) 32/32, and
  `i18n-default-locale-redirect` (the `Link` `locale` prop; the default
  locale link is unprefixed, a non-default one is prefixed) 2/2;
- `next/navigation` hooks in a Pages Router page
  (`useselectedlayoutsegment-s-in-pages-router`, driven through a real
  Playwright browser): 1/1;
- `basePath` (error pages, redirects/rewrites, router events, trailing
  slash, query/hash): 33/34. The one failure, `should rewrite without
  basePath when set to false`, server-proxies `https://example.vercel.sh`;
  this sandbox's egress policy answers 403 for that host, so the case cannot
  pass here. The proxy implementation itself is exercised by unit tests.
- **12 deploy-mode skip sentinels passed and are reported separately**: five
  from `404-page-router`, one from `api-resolver-query-writeable`, one from
  `app-document/client`, one from `i18n-api-support` (external fallback
  rewrite), and four from `i18n-ignore-rewrite-source-locale` (production
  `_next/static` chunk assertions).
- **3 pending tests**: two production-only routes-manifest assertions and one
  upstream `it.skip` in `basepath/error-pages`.

The runner therefore reports 385 passing test cases, one environment-limited
failure, and three pending tests, but **385 must not be described as
substantive compatibility coverage**. The honest result is 373/374
substantive cases in this environment, with the sentinels, the egress-limited
external-rewrite case, and the skips reported separately.
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
