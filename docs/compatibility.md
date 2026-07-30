# Compatibility

This document separates behavior already exercised by the prototype from the
larger Next.js Pages Router compatibility claim.

## Current vertical slice

| Area | Status | Exercised behavior |
| --- | --- | --- |
| Filesystem pages | Working | index, static, dynamic, catch-all ordering, API classification |
| Rendering | Working | Octane server render, hydration, client state |
| Data functions | Working slice | `getStaticProps`, `getServerSideProps`, `getStaticPaths`, and page `getInitialProps` |
| Special pages | Working slice | `_app` and `_app.getInitialProps`, `_document` and `renderPage` enhancement, `_error`, `404`, and `500` |
| Client runtime | Working slice | modern and legacy `Link`, URL objects, singleton router, `useRouter`, `withRouter`, push/replace/back, route events |
| Head | Working slice | title/head output across SSR and soft navigation |
| API routes | Working slice | classic callbacks plus Edge/Web `Request`/`Response`; method, URL, headers, query, cookies, parsed body, status, JSON, send, redirect |
| Page data | Working slice | `/_next/data/:buildId/*.json` for static and server props |
| ISR | Working slice | shared render artifact, numeric revalidation, Workers Cache SWR |
| URL policy | Working slice | `trailingSlash` redirects, SSR links, client navigation, dotted paths, and query strings |
| Workers deployment | Working | Vite build, assets binding, Node compatibility, named cached export |

## Known gaps

- build-time materialization of static HTML/data artifacts; current static and
  fallback routes are generated through the shared runtime artifact cache
- broader Node `IncomingMessage`/`ServerResponse` compatibility beyond the
  exercised Pages data and API surfaces
- full preview/draft mode parity beyond preview cookies and the exercised
  on-demand revalidation surface
- the broader redirects/rewrites matrix, middleware, headers config, locales,
  and `basePath`
- `next/image`, `next/script`, `next/font`, and other framework components
- exact shallow-routing semantics and scroll restoration
- advanced API behavior such as body limits, response-size warnings, streaming,
  and external resolvers
- third-party React component libraries
- React Server Components and the App Router, intentionally out of scope

## Tests run

The prototype-owned suite currently has:

- **21/21 unit tests** covering route discovery/matching, classic and Edge API
  request/response adaptation, URL normalization, and the expanded Pages
  server contract;
- **5/5 browser flows locally** covering SSR, hydration, state, duplicate-free
  links, soft navigation, browser back, dynamic params, API routes, custom
  404s, and shared ISR artifacts; and
- **5/5 of those browser flows against the deployed Worker**.

These are prototype-owned tests, not upstream Next.js tests.

## Upstream deploy-test result

Nextane now has a deterministic checked-in adapter that recognizes an
allowlisted upstream fixture, renames JSX-bearing page modules to `.tsrx`,
rewrites supported framework imports, applies reviewable Octane overlays where
class components or Worker filesystem assumptions require migration, builds
with Vite, and runs the result locally in Wrangler. The original upstream test
cases are not rewritten.

Against the local Next.js `v16.2.2` baseline, the current 19-file set
produced:

- **252/252 substantive upstream deploy test cases passed**:
  - original rendering/data baseline: 69/69;
  - async modules: 7/7;
  - Edge Pages support: 8/8;
  - modern Link behavior: 7/7;
  - legacy Link behavior: 8/8;
  - `next/head`: 5/5;
  - `withRouter`: 3/3;
  - router behavior with rewrites: 9/9;
  - Edge API request bodies: 2/2;
  - Edge and Node Pages API runtimes: 2/2;
  - custom error `req.url`: 1/1;
  - trailing-slash behavior, enabled and disabled: 68/68;
  - prerendering, `getStaticPaths` fallback modes, page-data caching, ISR,
    preview cookies, and on-demand revalidation: 63/63.
- **6 deploy-mode skip sentinels passed and are reported separately**:
  five from `404-page-router` and one from
  `api-resolver-query-writeable`.
- **2 production-only routes-manifest assertions were skipped** because this
  harness runs the upstream suites in deploy mode.

The upstream runner therefore has 258 passing cases in total, but the six
sentinels do not exercise their suites' behavior. The compatibility result is
**252/252 substantive test cases, plus six deploy-mode sentinels and two
production-only skips**—not 258 substantive test cases.

The selected files are:

1. `test/e2e/hello-world/hello-world.test.ts`
2. `test/e2e/404-page-router/index.test.ts`
3. `test/e2e/dynamic-route-interpolation/index.test.ts`
4. `test/e2e/getserversideprops/test/index.test.ts`
5. `test/e2e/app-document/rendering.test.ts`
6. `test/e2e/api-resolver-query-writeable/api-resolver-query-writeable.test.ts`
7. `test/e2e/async-modules/index.test.ts`
8. `test/e2e/edge-pages-support/index.test.ts`
9. `test/e2e/new-link-behavior/index.test.ts`
10. `test/e2e/next-head/index.test.ts`
11. `test/e2e/with-router/index.test.ts`
12. `test/e2e/use-router-with-rewrites/use-router-with-rewrites.test.ts`
13. `test/e2e/legacy-link-behavior-pages/index.test.ts`
14. `test/e2e/edge-api-endpoints-can-receive-body/index.test.ts`
15. `test/e2e/edge-runtime-pages-api-route/edge-runtime-pages-api-route.test.ts`
16. `test/e2e/error-handler-not-found-req-url/error-handler-not-found-req-url.test.ts`
17. `test/e2e/trailing-slashes/with-trailing-slash.test.ts`
18. `test/e2e/trailing-slashes/without-trailing-slash.test.ts`
19. `test/e2e/prerender.test.ts`

Run the exact filtered harness with a prepared v16.2.2 checkout:

```sh
NEXTANE_NEXT_VERSION=16.2.2 \
  npm run test:upstream -- /absolute/path/to/next.js
```

Run the adapter's deterministic unit/conformance checks with:

```sh
npm run test:upstream:harness
```

This is a useful smoke result, not a broad Pages Router compatibility
percentage. A future percentage needs the full Pages Router/both suite set,
with the denominator defined as `passed + failed` and skips reported
separately. Suite selection should use Vinext's router classifier; a
path-based `--filter pages` is not equivalent.

The next high-value batches are `basePath`, the broader redirects/rewrites
matrix, and framework components such as `next/image`.

Nightly infrastructure can be adapted from Vinext's MIT-licensed deploy suite,
but Nextane needs a deterministic checked-in source migration step. An AI
prompt can be the user-facing migration experience; it should not be part of
the benchmark itself.
