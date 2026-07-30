# Agent migration prompt

Paste this prompt into a coding agent to migrate a Pages Router application to
Octane-native Nextane.

The prompt assumes the agent can install the `nextane` package from npm and
access this repository for its documentation and examples.

```text
Migrate this Next.js Pages Router application to Nextane, an Octane-native
implementation of the Pages Router for Cloudflare Workers.

Your goal is behavioral parity, not merely a successful build. Work through the
repository, make the migration, run the application, and test the important
flows. Do not introduce React compatibility shims.

First, inventory the application:
- Confirm it uses pages/ and identify any app/ routes. Do not silently migrate
  App Router or React Server Components; list them as blockers.
- Inventory pages, dynamic/catch-all routes, pages/api routes, _app, _document,
  _error, 404/500 pages, data functions, next.config behavior, middleware, and
  imports from next/*.
- Inventory React-only third-party components. Prefer small Octane-native
  replacements; list substantial libraries as blockers.

Then migrate it:
1. Add nextane, octane, @octanejs/vite-plugin,
   @cloudflare/vite-plugin, vite, wrangler, and
   TypeScript as appropriate.
2. Replace Next.js scripts with Vite/Nextane dev and build scripts plus a
   Cloudflare Workers deploy script.
3. Add a Vite config using the Octane plugins, nextane(), and the Cloudflare
   Vite plugin. Add the Nextane HTML shell and a client entry that imports
   `nextane/client`. Add a Worker entry that re-exports `default` and
   `IsrArtifact` from `nextane/worker`, plus Wrangler config with
   `nodejs_compat` and the named cached export enabled.
4. Rename component-bearing .tsx/.jsx files under pages/ to .tsrx. Leave plain
   non-component .ts/.js utilities alone.
5. Convert React imports and hooks to their Octane equivalents. Remove React,
   react-dom, next, and React-only compatibility layers once no longer used.
6. Rewrite framework imports:
   - next/link -> nextane/link
   - next/head -> nextane/head
   - next/router -> nextane/router
   - Next data/API types -> nextane or nextane/types
   Rewrite next/image, next/script, and next/font to native web equivalents for
   now, preserving layout, loading, and accessibility behavior.
7. Preserve getStaticProps, getStaticPaths, and getServerSideProps shapes where
   supported. Preserve fallback: false, true, and "blocking" behavior rather
   than converting static routes to server rendering. Keep compatible Pages
   request/response usage; rewrite only unsupported Node-specific behavior to
   Web Request APIs.
8. Preserve pages/api callback handlers where they fit Nextane's supported
   request/response surface. Rewrite unsupported Node streaming or middleware
   behavior to Web APIs.
9. Preserve CSS and assets through Vite. Translate aliases and environment
   variables deliberately; never expose a server secret to the client.
10. Nextane refuses to build while Next.js middleware/proxy files or
    `headers`, `redirects`, or `i18n` config remain, because silently dropping
    them can remove security policy or routing behavior. Explicitly migrate
    each behavior to a supported equivalent, then remove the unsupported file
    or config key. Preserve supported rewrites; report other gaps such as
    `basePath` rather than pretending they work.

Verify the result:
- Run typechecking, unit tests, a production build, and browser tests.
- Test direct document loads and client Link navigation for index, static,
  dynamic, and catch-all routes.
- Test browser back/forward, titles/head output, _app, custom 404/500 behavior,
  every data-function family in the app, and representative API routes.
- Prove soft navigation did not reload the document.
- For ISR, prove HTML and /_next/data consume the same generated artifact and
  preserve the configured revalidation interval.
- Report React or next imports that remain, unsupported APIs, tests changed,
  and any behavior you could not preserve.

Finish with a concise migration report containing:
- changed files and architectural decisions;
- passing verification commands;
- supported behavior exercised;
- unresolved compatibility gaps;
- exact manual review steps.

Do not publish, deploy, delete data, or change external services unless I
explicitly authorize it.
```
