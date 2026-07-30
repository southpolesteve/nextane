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
> The cost of making software like this is approaching zero. You can have an
> idea, talk to an agent for a few hours, and end up with something real enough
> to test.
>
> If you need a Next.js alternative, start with
> [Vinext](https://vinext.dev/). It passes
> [more than 97% of the supported Next.js deploy test suite](https://vinext.dev/compatibility),
> supports substantial Next.js applications today, and is much more mature.
> Nextane is newer, narrower, and built on alpha software.

[Vinext](https://github.com/cloudflare/vinext) reimplements the Next.js API on
Vite. It began as a slop fork of Next.js. Nextane is me doing it again, this
time without React.

Nextane keeps the familiar parts of the Pages Router—filesystem routes, data
functions, API routes, `Link`, `Head`, and client navigation—but runs them on
Octane, Vite, and a smaller runtime.

## Benchmarks

On the same small hydrated `getServerSideProps` page, the current production
builds ship:

| Runtime | Client JavaScript (gzip) | Compared with Next.js |
| --- | ---: | ---: |
| Next.js 16.2.12 | 109.9 KiB | — |
| Vinext 1.0.0-beta.4 | 77.8 KiB | 29.2% less |
| Nextane + Octane 0.1.19 | **41.0 KiB** | **62.7% less** |

Nextane ships 47.3% less client JavaScript than Vinext in this fixture. Its
production build is slower than Vinext's, and its measured SSR throughput
trails both Vinext and Next.js. See the
[full methodology and results](./docs/benchmark.md).

## Should I use this?

Probably not.

Start with Vinext if you need a more mature alternative to Next.js. Try
Nextane if:

- you have an existing Pages Router application;
- you want to see how far Octane can replace React while keeping the same APIs;
- you are comfortable having an AI agent migrate it and debugging what breaks.

Octane describes itself as alpha software. Nextane is even more experimental.

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

## What doesn't work

- App Router. Octane does not support React Server Components, so Nextane
  probably never will.
- most React ecosystem packages. Octane has its own library bindings, but React
  packages are not drop-in compatible.
- class components or React's synthetic event system
- the complete Next.js configuration and middleware surface
- every Node-specific request, response, or streaming behavior
- Preview and Draft Mode. `setPreviewData()` fails closed until preview cookies
  can be signed and validated
- deployment targets other than Cloudflare Workers today. This is a shortcut
  in Nextane, not an Octane limitation.

See the [compatibility ledger](./docs/compatibility.md) for details.

## Migrate a Pages Router app

Give your coding agent this repository and your application, then paste:

```text
Migrate this Next.js Pages Router application to Nextane. Preserve its behavior,
not just its ability to build. Follow MIGRATION_PROMPT.md in the Nextane
repository, run the app, test direct loads and client navigation, and report
every unsupported API or React-only dependency instead of hiding it behind a
compatibility shim.
```

The full [migration prompt](./MIGRATION_PROMPT.md) covers the framework
changes, Vite and Workers setup, and verification.

## Run this repository

```sh
npm install
npm run dev
```

Then open `http://127.0.0.1:5173`.

```sh
npm run check
```

The check runs typechecking, 56 unit and security tests, release-workflow
checks, six real-browser Pages Router flows, and a production build.

See [architecture](./docs/architecture.md) for implementation details. Nextane
is not affiliated with Vercel, Next.js, Vinext, Cloudflare, or Octane.

## License

MIT. Octane, Vinext, and Next.js are also MIT licensed; copied or adapted source
retains its provenance and license notices.
