# Official Next.js TypeScript example, migrated to Nextane

This is an Octane-native migration of Next.js's official
[`examples/with-typescript`](https://github.com/vercel/next.js/tree/52faae3d94641584e13691238df5be158d0f00fb/examples/with-typescript)
Pages Router application. The source snapshot came from Next.js `v16.2.2`
at commit `52faae3d94641584e13691238df5be158d0f00fb`.

The migration followed the repository's `MIGRATION_PROMPT.md`:

- `.tsx` components became Octane `.tsrx` components;
- React imports and React type packages were removed;
- `next/link`, `next/head`, and Next.js data/API types moved to `nextane/*`;
- `getStaticProps`, `getStaticPaths`, the dynamic user route, and the callback
  API route retained their original API shapes;
- Next/Vercel scripts and configuration became Vite, Nextane, and Workers
  configuration with `nodejs_compat`;
- the `@/*` API-route alias became an explicit relative import.

No React compatibility shim or third-party UI replacement was needed.

## Verify

```bash
npm install
npm run typecheck
npm run build
```

From the Nextane repository root, `npm run test:example` also exercises direct
SSR, head output, static props, dynamic static paths, the API route, soft Link
navigation without a document reload, and browser back.

The upstream source is MIT licensed. See `UPSTREAM_LICENSE.md`.
