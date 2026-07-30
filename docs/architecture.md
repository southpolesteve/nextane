# Nextane architecture

Nextane keeps the Pages Router programming model but replaces both React and
the Next.js server with Octane-native rendering on Cloudflare Workers.

```text
pages/*.tsrx
    │
    ├── Vite + Octane compiler
    └── Nextane route scanner
             │
             ├── client manifest ──> hydrateRoot + Router + /_next/data
             └── server manifest ──> data lifecycle + Octane prerender
                                            │
                       ┌────────────────────┴────────────────────┐
                       │                                         │
                default Worker                           IsrArtifact export
             routing, SSR, API routes              Workers Cache enabled
             cache disabled                        combined render artifact
                       │                                         │
                       └──────── HTML or page-data ──────────────┘
```

## Build and routing

The `nextane()` Vite plugin scans `pages/` and creates separate virtual
manifests for the browser and Worker builds. A static segment outranks a
dynamic segment, followed by catch-all and optional catch-all segments.
`_app`, `_document`, and `_error` are discovered separately from normal routes.

The Octane compiler handles `.tsrx` source. Nextane does not translate JSX into
React calls and does not ship React.

## Request lifecycle

For a page request, the Worker:

1. matches the pathname to the generated manifest;
2. runs `getServerSideProps`, `getStaticProps`, or page `getInitialProps`;
3. renders the page through Octane, wrapped by `_app` when present;
4. injects Octane HTML, CSS, head output, and `__NEXT_DATA__` into the Vite HTML
   shell; and
5. returns an HTML response with a familiar serialized data contract.

Client navigation matches the same route manifest, loads the route chunk and
`/_next/data/:buildId/*.json` concurrently, then renders through the existing
Octane root. `Link` and the singleton router expose familiar Pages Router
shapes and route events.

API routes adapt the Fetch `Request` to a deliberately small
`NextApiRequest`/`NextApiResponse` callback surface. Classic API bodies are
counted while streaming and limited to 1 MiB by default. Pages can change the
limit with `config.api.bodyParser.sizeLimit` or disable automatic parsing with
`config.api.bodyParser: false`.

Preview Mode is not implemented. `setPreviewData()` throws instead of issuing
unsigned cookies that would look valid without providing authentication.

## ISR and Workers Cache

The default export is an uncached router. Routes with `getStaticProps` call the
named `IsrArtifact` entrypoint, whose response is cached by the new Workers
Cache before the entrypoint runs.

That inner entrypoint returns one JSON render artifact containing props,
Octane HTML, head output, and generation metadata. Both an HTML document
request and its `/_next/data` request consume that same artifact. Numeric
`revalidate` becomes:

```text
public, max-age=<revalidate>,
stale-while-revalidate=31536000,
stale-if-error=31536000
```

Production verification on July 29, 2026 observed `MISS`, then `UPDATING`
during stale-while-revalidate, then `HIT`. The final HTML and page-data
responses carried the identical generation timestamp.

Local workerd does not yet emulate this new cache layer, so development uses a
small in-memory substitute with the same artifact boundary.

## Intentional boundaries

The runtime is Workers-first and enables `nodejs_compat`, but its public server
contract should prefer Web APIs. React library compatibility, React Server
Components, and the App Router are not goals for this package.
