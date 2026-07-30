# Nextane

The Next.js Pages Router, rebuilt on [Octane](https://octanejs.dev/).

**Next.js without React.**

[Live kitchen sink](https://nextane.southpolesteve.workers.dev/) ·
[Compatibility](./docs/compatibility.md) ·
[Benchmarks](./docs/benchmark.md) ·
[Migration prompt](./MIGRATION_PROMPT.md)

> [!IMPORTANT]
> Nextane is a fun experiment, not a serious framework. I made it in a couple
> of hours, entirely by voice-prompting an AI agent from my phone.
>
> I think software is becoming ephemeral. The cost of making something like
> this has basically gone to zero, so you can just make weird software because
> you feel like it. That is really the point here.
>
> If you actually need a Next.js alternative, use
> [Vinext](https://vinext.dev/). It passes
> [more than 97% of the supported Next.js deploy test suite](https://vinext.dev/compatibility),
> real applications run on it in production, and a lot of serious work has
> gone into making it reliable. Nextane is for seeing what happens when you
> point an AI agent at the absolute bleeding edge.

[Vinext](https://github.com/cloudflare/vinext) reimplements the Next.js API on
Vite. Nextane is its spiritual successor in the least responsible sense: it
asks the unnecessary follow-up question, “What if we did it again, but removed
React?”

Vinext began life as a slop fork of Next.js. Nextane is a slop fork of that
idea: preserve the productive shape of the Pages Router—filesystem routes,
familiar data functions, API routes, `Link`, `Head`, and client
navigation—while replacing React and the Next.js runtime with Octane, Vite,
and a much smaller runtime.

## The interesting result

On the same small hydrated `getServerSideProps` page, the current production
builds ship:

| Runtime | Client JavaScript (gzip) | Compared with Next.js |
| --- | ---: | ---: |
| Next.js 16.2.12 | 109.9 KiB | — |
| Vinext 1.0.0-beta.4 | 77.8 KiB | 29.2% less |
| Nextane + Octane 0.1.19 | **40.8 KiB** | **62.9% less** |

Nextane ships 47.6% less client JavaScript than Vinext in this fixture. That is
the headline—not that Nextane wins every benchmark. Its current production
build is slower than Vinext's, and its measured SSR throughput trails both
comparisons. See the [full methodology and results](./docs/benchmark.md).

## Should I use this?

Probably not.

Use Vinext if you are seriously evaluating a production-ready alternative to
Next.js. Try Nextane if all of these sound appealing:

- you have an existing Pages Router application;
- you want to see how far Octane can replace React without replacing the API
  shape of your application;
- you are comfortable handing the migration to an AI agent and debugging the
  sharp edges.

Even Octane itself is currently described as alpha software. Nextane is built
on top of Octane.

## What works

- `pages/` filesystem routing, including dynamic and catch-all routes
- Octane-native `.tsrx` components, SSR, and hydration
- `getStaticProps`, `getStaticPaths`, `getServerSideProps`, and basic page
  `getInitialProps`
- `fallback: false`, `true`, and `"blocking"` behavior for dynamic static pages
- ISR with stale-while-revalidate behavior
- callback-style `pages/api` routes and Web `Request`/`Response` handlers
- `nextane/head`, `nextane/document`, `nextane/link`, `nextane/router`,
  `useRouter`, and `withRouter`
- custom `_app`, `_document`, `_error`, `404`, and `500` pages
- Next-style `/_next/data/:buildId/*.json` client navigation
- local Vite development and production deployment

The [live kitchen sink](https://nextane.southpolesteve.workers.dev/) exercises
static props, server props, dynamic routes, client state, soft navigation, API
routes, custom errors, and ISR without pulling React into the runtime.

## What does not

- App Router. Octane intentionally does not support React Server Components,
  so Nextane is unlikely ever to support it.
- most third-party community React libraries. Octane has its own library
  bindings, but arbitrary React packages are not drop-in compatible.
- class components or React's synthetic event system
- the complete Next.js configuration and middleware surface
- every Node-specific request, response, or streaming behavior
- deployment targets other than Cloudflare Workers today. That is a shortcut
  in this experiment, not a fundamental Octane limitation: Octane already has
  Cloudflare and Vercel adapters.

See the [compatibility ledger](./docs/compatibility.md) for the less funny
version.

## Migrate a Pages Router app

Give your coding agent this repository and your application, then paste:

```text
Migrate this Next.js Pages Router application to Nextane. Preserve its behavior,
not just its ability to build. Follow MIGRATION_PROMPT.md in the Nextane
repository, run the app, test direct loads and client navigation, and report
every unsupported API or React-only dependency instead of hiding it behind a
compatibility shim.
```

The full [migration prompt](./MIGRATION_PROMPT.md) inventories the application,
rewrites the framework boundary, configures Vite and Workers, and gives the
agent a concrete verification checklist.

## Run this repository

```sh
npm install
npm run dev
```

Then open `http://127.0.0.1:5173`.

```sh
npm run check
```

The check runs typechecking, 21 low-level routing/API contract tests, five
real-browser Pages Router flows, and a production build.

For implementation details, see the
[architecture](./docs/architecture.md). Nextane is not affiliated with Vercel,
Next.js, Vinext, Cloudflare, or Octane.

## License

MIT. Octane, Vinext, and Next.js are also MIT licensed; copied or adapted source
retains its provenance and license notices.
