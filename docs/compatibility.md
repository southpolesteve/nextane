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
| Client runtime | Working slice | modern and legacy `Link` (including the i18n `locale` prop), URL objects, singleton router, `useRouter`, `withRouter`, push/replace/back, route events |
| `next/navigation` | Working slice | Pages Router-compatible `useSelectedLayoutSegment`/`useSelectedLayoutSegments` (empty constants), `usePathname`, `useSearchParams`, `useParams`, and an App Router-shaped `useRouter` adapter over the singleton |
| Head | Working slice | title/head output across SSR and soft navigation |
| API routes | Working slice | classic callbacks plus Edge/Web `Request`/`Response`; method, URL, headers, query, cookies, parsed body, a 1 MiB default body limit with `config.api.bodyParser` controls, status, JSON, send, redirect |
| Preview Mode | Working slice | signed `__prerender_bypass`/`__next_preview_data` cookies (AES-256-GCM + HMAC-SHA256, per-build server-only keys), `setPreviewData`/`clearPreviewData`/`setDraftMode`, preview context in `getStaticProps`/`getServerSideProps`, per-request preview renders that bypass the shared ISR path, stale-cookie clearing |
| Routing config | Working slice | `redirects()`/`headers()`/`rewrites()` with `has`/`missing` conditions, `:param(pattern)` sources, case-insensitive matching, external rewrite proxying, `beforeFiles`/`afterFiles`/`fallback` phase order, `basePath: false`/`locale: false` variants |
| basePath | Working slice | prefixed pages/assets/data routes, outside-prefix 404s, prefixed router events and history, `router.basePath`, Link prefixing, trailing-slash interplay |
| assetPrefix | Working slice | prefixed `_next` and hashed chunk serving, prefixed build manifest, plain-text asset 404s |
| i18n | Working slice | locale-prefixed routing with an unprefixed default locale, locale-strip before dynamic matching, `locale: false` rewrites/redirects with default-locale insertion, active-locale preservation on internal redirects, header rules applied across locales, per-locale static/ISR artifact caching, locale-prefixed `/_next/data` routes, `router.locale`/`locales`/`defaultLocale` and locale in `getStaticProps`/`getServerSideProps`, `/api` served unprefixed |
| Page data | Working slice | `/_next/data/:buildId/*.json` for static and server props |
| ISR | Working slice | shared render artifact, numeric revalidation, Workers Cache SWR |
| URL policy | Working slice | `trailingSlash` redirects, SSR links, client navigation, dotted paths, and query strings |
| Workers deployment | Working | Vite build, assets binding, Node compatibility, named cached export |

## Known gaps

- build-time materialization of static HTML/data artifacts; current static and
  fallback routes are generated through the shared runtime artifact cache
- broader Node `IncomingMessage`/`ServerResponse` compatibility beyond the
  exercised Pages data and API surfaces
- middleware, i18n `domains` routing, and Accept-Language/`NEXT_LOCALE`
  locale-detection redirects (`localeDetection`)
- `next/image`, `next/script`, `next/font`, and other framework components
- exact shallow-routing semantics and scroll restoration
- advanced API behavior such as response-size warnings, streaming, and external
  resolvers
- third-party React component libraries
- React Server Components and the App Router, intentionally out of scope

## Tests run

The prototype-owned suite currently has:

- **103/103 unit and security tests** covering route discovery/matching, classic
  and Edge API request/response adaptation, URL normalization, cache isolation,
  Preview Mode signing and bypass semantics, redirects/headers/conditional
  rewrites and their phase order (a real page beats an `afterFiles` rewrite),
  basePath/assetPrefix routing, i18n locale resolution and render context,
  per-locale static/ISR artifact caching, locale-preserving redirects, header
  rules across locales, locale-prefixed data routes, the `next/navigation`
  hook adapters, and the expanded Pages server contract;
- **6/6 browser flows locally** covering SSR, hydration, state, duplicate-free
  links, soft navigation, browser back, dynamic params, API routes, custom
  404s, shared ISR artifacts, and public security boundaries; and
- **6/6 of those browser flows against the deployed Worker**.

These are prototype-owned tests, not upstream Next.js tests.

## Upstream deploy-test result

Nextane now has a deterministic checked-in adapter that recognizes an
allowlisted upstream fixture, renames JSX-bearing page modules to `.tsrx`,
rewrites supported framework imports, applies reviewable Octane overlays where
class components or Worker filesystem assumptions require migration, builds
with Vite, and runs the result locally in Wrangler. The original upstream test
cases are not rewritten.

Against the local Next.js `v16.2.2` baseline, the current 43-file run
produced:

- **373/374 substantive upstream deploy test cases passed**:
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
    on-demand revalidation, and Preview Mode cookies: 63/63 (the previously
    expected Preview Mode failure now passes with signed preview cookies);
  - `_app`/`_document` CSP hash/nonce documents and log hygiene: 3/3;
  - SSR React context: 2/2;
  - script loading (`optimized-loading`, `disable-js-preload`): 8/8;
  - invalid static asset 404s (plain, `basePath`, and `assetPrefix`
    variants): 9/9;
  - crawler-aware fallback prerendering: 3/3;
  - streaming SSR (edge pages, styled output, multi-byte, API specificity):
    5/5;
  - `has`-conditional rewrites into API routes: 2/2;
  - i18n locale-prefixed routing (`i18n-api-support` 2/2,
    `i18n-ignore-rewrite-source-locale` 8/8, `i18n-fallback-collision`
    11/11, and `i18n-ignore-redirect-source-locale` — `locale:false`
    redirects with the destination locale reflected in `router.locale`,
    plain and under `basePath` — 32/32, and `i18n-default-locale-redirect` — the `Link` `locale` prop — 2/2): 55/55;
  - `basePath` (error pages, redirects/rewrites, router events, trailing
    slash, query/hash handling): 33/34. The one failure server-proxies
    `https://example.vercel.sh`; the development sandbox's egress policy
    answers 403 for that host, so the case cannot pass in this environment.
    The external-rewrite proxy itself is covered by prototype tests.
  - `next/navigation` hooks in a Pages Router page
    (`useSelectedLayoutSegment`/`useSelectedLayoutSegments`, exercised
    through a real Playwright browser): 1/1.
- **12 deploy-mode skip sentinels passed and are reported separately**:
  five from `404-page-router`, one from `api-resolver-query-writeable`, one
  from `app-document/client`, one from `i18n-api-support`, and four from
  `i18n-ignore-rewrite-source-locale`.
- **3 pending tests**: two production-only routes-manifest assertions and one
  upstream `it.skip` in `basepath/error-pages`.

The upstream runner therefore reports 385 passing cases in total, but the
twelve sentinels do not exercise their suites' behavior. The compatibility
result is **373/374 substantive test cases, plus twelve deploy-mode
sentinels, one environment-limited external-rewrite failure, and three
skips** — not 385 substantive test cases.

The selected files are the 43 listed in
[`scripts/upstream/README.md`](../scripts/upstream/README.md).

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

The next high-value batches are i18n/locales, `assetPrefix`, and framework
components such as `next/image`.

Nightly infrastructure can be adapted from Vinext's MIT-licensed deploy suite,
but Nextane needs a deterministic checked-in source migration step. An AI
prompt can be the user-facing migration experience; it should not be part of
the benchmark itself.
