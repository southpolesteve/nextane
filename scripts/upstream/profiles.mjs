export const upstreamSmokeSuites = [
  {
    id: "hello-world",
    testFile: "test/e2e/hello-world/hello-world.test.ts",
    signatures: ["pages/index.tsx"],
  },
  {
    id: "404-page-router",
    testFile: "test/e2e/404-page-router/index.test.ts",
    signatures: ["pages/404.js", "components/debug-error.js"],
  },
  {
    id: "dynamic-route-interpolation",
    testFile: "test/e2e/dynamic-route-interpolation/index.test.ts",
    signatures: ["pages/blog/[slug].js", "pages/api/dynamic/[slug].js"],
  },
  {
    id: "getserversideprops",
    testFile: "test/e2e/getserversideprops/test/index.test.ts",
    signatures: ["pages/early-request-end.js", "pages/not-found/[slug].js", "world.txt"],
  },
  {
    id: "app-document-rendering",
    testFiles: [
      "test/e2e/app-document/rendering.test.ts",
      "test/e2e/app-document/csp.test.ts",
      "test/e2e/app-document/index.test.ts",
      "test/e2e/app-document/client.test.ts",
    ],
    signatures: ["pages/_document.js", "shared-module.js"],
  },
  {
    id: "api-resolver-query-writeable",
    testFile:
      "test/e2e/api-resolver-query-writeable/api-resolver-query-writeable.test.ts",
    signatures: ["pages/api/index.js", "server.js"],
  },
  {
    id: "async-modules",
    testFile: "test/e2e/async-modules/index.test.ts",
    signatures: ["pages/config.jsx", "pages/make-error.jsx", "pages/api/hello.js"],
  },
  {
    id: "edge-pages-support",
    testFile: "test/e2e/edge-pages-support/index.test.ts",
    signatures: ["pages/[id].js", "pages/api/[id].js", "my-adapter.js"],
  },
  {
    id: "new-link-behavior",
    testFile: "test/e2e/new-link-behavior/index.test.ts",
    signatures: [
      "pages/onclick-prevent-default.js",
      "pages/multiple-children.js",
      "pages/id-pass-through.js",
    ],
  },
  {
    id: "next-head",
    testFile: "test/e2e/next-head/index.test.ts",
    signatures: ["pages/_document.js", "components/meta.js"],
    componentRoots: ["components"],
  },
  {
    id: "with-router",
    testFile: "test/e2e/with-router/index.test.ts",
    signatures: ["pages/router-method-ssr.js", "components/header-nav.js"],
    componentRoots: ["components"],
  },
  {
    id: "use-router-with-rewrites",
    testFile:
      "test/e2e/use-router-with-rewrites/use-router-with-rewrites.test.ts",
    signatures: [
      "pages/foo.tsx",
      "pages/rewrite-to-another-segment/[id]/foo.tsx",
      "pages/rewrite-to-same-segment/[id]/index.tsx",
    ],
  },
  {
    id: "legacy-link-behavior-pages",
    testFile: "test/e2e/legacy-link-behavior-pages/index.test.ts",
    signatures: [
      "pages/child-is-a-number/index.tsx",
      "pages/invalid-onclick/index.tsx",
      "pages/passHref/index.tsx",
    ],
  },
  {
    id: "edge-api-endpoints-can-receive-body",
    testFile: "test/e2e/edge-api-endpoints-can-receive-body/index.test.ts",
    signatures: ["pages/api/edge.js", "pages/api/index.js"],
  },
  {
    id: "edge-runtime-pages-api-route",
    testFile:
      "test/e2e/edge-runtime-pages-api-route/edge-runtime-pages-api-route.test.ts",
    signatures: ["pages/api/edge.js", "pages/api/node.js"],
  },
  {
    id: "error-handler-not-found-req-url",
    testFile:
      "test/e2e/error-handler-not-found-req-url/error-handler-not-found-req-url.test.ts",
    signatures: ["pages/[slug].tsx", "pages/_error.tsx", "pages/index.tsx"],
  },
  {
    id: "trailing-slashes",
    testFiles: [
      "test/e2e/trailing-slashes/with-trailing-slash.test.ts",
      "test/e2e/trailing-slashes/without-trailing-slash.test.ts",
    ],
    signatures: [
      "pages/catch-all/[...slug].js",
      "pages/external-linker.js",
      "pages/linker.js",
    ],
  },
  {
    id: "ssr-react-context",
    testFile: "test/e2e/ssr-react-context/index.test.ts",
    signatures: ["context.js", "pages/consumer.js"],
  },
  {
    id: "optimized-loading",
    testFile: "test/e2e/optimized-loading/test/index.test.ts",
    signatures: [
      "pages/page1.js",
      "pages/index.js",
      "next.config.js",
      "test/index.test.ts",
    ],
  },
  {
    id: "disable-js-preload",
    testFile: "test/e2e/disable-js-preload/test/index.test.ts",
    signatures: ["next.config.js", "pages/index.js", "test/index.test.ts"],
  },
  {
    id: "invalid-static-asset-404-pages",
    testFiles: [
      "test/e2e/invalid-static-asset-404-pages/invalid-static-asset-404-pages.test.ts",
      "test/e2e/invalid-static-asset-404-pages/invalid-static-asset-404-pages-base-path.test.ts",
      "test/e2e/invalid-static-asset-404-pages/invalid-static-asset-404-pages-asset-prefix.test.ts",
    ],
    signatures: [
      "invalid-static-asset-404-pages.test.ts",
      "pages/404.tsx",
      "pages/index.tsx",
    ],
  },
  {
    id: "prerender-crawler",
    testFile: "test/e2e/prerender-crawler.test.ts",
    signatures: ["pages/index.js", "pages/blog/[slug].js"],
    warmupPaths: ["/blog/first"],
  },
  {
    id: "streaming-ssr",
    testFile: "test/e2e/streaming-ssr/index.test.ts",
    signatures: ["pages/multi-byte.js", "pages/api/user/login.js"],
  },
  {
    id: "link-with-api-rewrite",
    testFile: "test/e2e/link-with-api-rewrite/index.test.ts",
    signatures: ["pages/api/json.js", "pages/index.js"],
  },
  {
    id: "basepath",
    testFiles: [
      "test/e2e/basepath/error-pages.test.ts",
      "test/e2e/basepath/redirect-and-rewrite.test.ts",
      "test/e2e/basepath/router-events.test.ts",
      "test/e2e/basepath/trailing-slash.test.ts",
      "test/e2e/basepath/query-hash.test.ts",
    ],
    signatures: [
      "pages/invalid-manual-basepath.js",
      "pages/absolute-url-basepath.js",
      "pages/external-and-back.js",
    ],
    warmupPaths: ["/docs"],
  },
  {
    id: "i18n-api-support",
    testFile: "test/e2e/i18n-api-support/index.test.ts",
    signatures: ["pages/api/hello.js", "pages/api/blog/[slug].js"],
  },
  {
    id: "i18n-ignore-rewrite-source-locale",
    testFile: "test/e2e/i18n-ignore-rewrite-source-locale/rewrites.test.ts",
    signatures: ["pages/api/hello.js", "public/file.txt"],
  },
  {
    id: "i18n-fallback-collision",
    testFile: "test/e2e/i18n-fallback-collision/i18n-fallback-collision.test.ts",
    signatures: [
      "pages/[first]/[second]/[third]/[fourth]/index.js",
      "pages/index.tsx",
    ],
    warmupPaths: ["/first", "/first/second/third/fourth"],
  },
  {
    id: "i18n-ignore-redirect-source-locale",
    testFiles: [
      "test/e2e/i18n-ignore-redirect-source-locale/redirects.test.ts",
      "test/e2e/i18n-ignore-redirect-source-locale/redirects-with-basepath.test.ts",
    ],
    signatures: ["pages/newpage.js"],
    warmupPaths: ["/newpage", "/sv/newpage"],
  },
  {
    id: "prerender",
    testFile: "test/e2e/prerender.test.ts",
    signatures: [
      "pages/blocking-fallback-once/[slug].js",
      "pages/fallback-only/[slug].js",
      "pages/api/manual-revalidate.js",
    ],
    stripSideEffectImports: ["firebase/firestore"],
    warmupPaths: [
      "/large-page-data",
      "/blocking-fallback/lots-of-data",
    ],
  },
];

export const upstreamSmokeTestFiles = upstreamSmokeSuites.flatMap(
  (suite) => suite.testFiles ?? [suite.testFile],
);
