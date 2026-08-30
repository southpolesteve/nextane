import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { octane } from "@octanejs/vite-plugin";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import {
  assertNoUnsupportedRoutingFiles,
  createClientPageSource,
  javascriptStringLiteral,
  loadRoutingConfig,
  nextane,
  validatedAssetPrefix,
} from "../../src/plugin";

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const absolute = path.join(directory, entry.name);
        return entry.isDirectory() ? filesBelow(absolute) : [absolute];
      }),
    )
  ).flat();
}

describe("client build security", () => {
  it("encodes virtual-module strings without executable source characters", () => {
    const value = "\";globalThis.pwned=true;//\n</script>\u2028😀";
    const literal = javascriptStringLiteral(value);

    expect(literal).toMatch(/^"(?:\\u[0-9a-f]{4})*"$/);
    expect(JSON.parse(literal)).toBe(value);
    expect(literal).not.toContain("globalThis");
    expect(literal).not.toContain("</script>");
  });

  it("removes server exports, dependency branches, and static initializers", async () => {
    const transformed = await createClientPageSource(
      `
        import { visible, serverSecret } from "./mixed";
        import { invokeServer } from "./server-only";
        const serverCanary = invokeServer(serverSecret, "LOCAL_CANARY");
        export const getStaticProps = async () => ({
          props: { secret: serverCanary },
        });
        export const clientHelper = () => visible;
        export default function Page() {
          return <p>{clientHelper()}</p>;
        }
      `,
      "security-page.tsrx",
    );

    expect(transformed).toContain("default function Page");
    expect(transformed).toContain("visible");
    expect(transformed).not.toContain("getStaticProps");
    expect(transformed).not.toContain("serverSecret");
    expect(transformed).not.toContain("server-only");
    expect(transformed).not.toContain("LOCAL_CANARY");
    expect(transformed).not.toContain("serverCanary");
  });

  it("strips a server-only import shadowed by a same-named client local", async () => {
    const transformed = await createClientPageSource(
      `
        import { formatSecret } from "./server-only";
        export const getServerSideProps = async () => ({
          props: { s: formatSecret("SERVER_SEED") },
        });
        export default function Page({ items }) {
          // A client local reuses the import's name; the component only ever
          // calls this local, never the server-only import.
          const formatSecret = (value) => value.toUpperCase();
          return <p>{formatSecret(items[0])}</p>;
        }
      `,
      "shadowed-import.tsrx",
    );
    // The server-only module must not leak in just because a client local
    // happens to share the imported binding's name.
    expect(transformed).not.toContain("./server-only");
    expect(transformed).not.toContain("getServerSideProps");
    expect(transformed).not.toContain("SERVER_SEED");
    // The shadowing client local must survive so the component still works.
    expect(transformed).toContain("value.toUpperCase()");
    expect(transformed).toContain("default function Page");
  });

  it("keeps an import the client genuinely uses (shared with server code)", async () => {
    const transformed = await createClientPageSource(
      `
        import { sharedFormat } from "./shared";
        export const getServerSideProps = async () => ({
          props: { s: sharedFormat("SEED") },
        });
        export default function Page({ items }) {
          return <p>{sharedFormat(items[0])}</p>;
        }
      `,
      "shared-import.tsrx",
    );
    // The client references the import at module scope (no shadow), so it must
    // be preserved even though server code also uses it.
    expect(transformed).toContain('from "./shared"');
    expect(transformed).toContain("sharedFormat");
    expect(transformed).not.toContain("getServerSideProps");
  });

  it("keeps an import used unshadowed in one scope even when shadowed in another", async () => {
    const transformed = await createClientPageSource(
      `
        import { helper } from "./shared";
        export const getServerSideProps = async () => ({
          props: { s: helper("A") },
        });
        export default function Page() {
          const outer = helper("B");
          function inner() {
            const helper = () => "local";
            return helper();
          }
          return <p>{outer}{inner()}</p>;
        }
      `,
      "mixed-shadow.tsrx",
    );
    // `helper("B")` is a real, unshadowed use of the import; a nested shadow in
    // `inner` must not cause the import to be dropped.
    expect(transformed).toContain('from "./shared"');
    expect(transformed).toContain('helper("B")');
  });

  it("keeps a non-exported local that shares a reserved server-export name", async () => {
    const transformed = await createClientPageSource(
      `
        const config = { pageSize: 20 };
        export default function Page({ items }) {
          return <ul>{items.slice(0, config.pageSize)}</ul>;
        }
      `,
      "reserved-local.tsrx",
    );
    // The local `config` (not an export) must survive so the component works.
    expect(transformed).toContain("const config = { pageSize: 20 }");
    expect(transformed).toContain("config.pageSize");
  });

  it("still strips an exported config from the client bundle", async () => {
    const transformed = await createClientPageSource(
      `
        export const config = { runtime: "edge", secretFlag: "SERVER_ONLY" };
        export default function Page() {
          return <p>hi</p>;
        }
      `,
      "exported-config.tsrx",
    );
    expect(transformed).not.toContain("SERVER_ONLY");
    expect(transformed).not.toContain("runtime");
    expect(transformed).toContain("default function Page");
  });

  it("preserves a default re-export while dropping a server re-export", async () => {
    const transformed = await createClientPageSource(
      `
        export { default } from "./client-page";
        export { getServerSideProps } from "./server-only";
      `,
      "reexport-page.tsrx",
    );

    expect(transformed).toContain(
      'export { default } from "./client-page"',
    );
    expect(transformed).not.toContain("getServerSideProps");
    expect(transformed).not.toContain("./server-only");
  });

  it("keeps server-only source and source maps out of a production browser build", async () => {
    const fixture = path.resolve("test/fixtures/client-security");
    const output = await mkdtemp(path.join(os.tmpdir(), "nextane-client-build-"));

    await build({
      root: fixture,
      logLevel: "silent",
      plugins: [...octane(), nextane()],
      build: {
        outDir: output,
        emptyOutDir: true,
        sourcemap: true,
      },
    });

    const files = await filesBelow(output);
    const browserSource = (
      await Promise.all(
        files
          .filter((file) => /\.(?:js|map)$/.test(file))
          .map((file) => readFile(file, "utf8")),
      )
    ).join("\n");
    expect(files.some((file) => file.endsWith(".map"))).toBe(false);
    expect(browserSource).toContain("client fixture rendered");
    expect(browserSource).toContain("mixed client binding rendered");
    expect(browserSource).not.toMatch(
      /SERVER_(?:DEPENDENCY|LOCAL|EXPORT|MIXED|SIDE_EFFECT|TOP_LEVEL)_CANARY/,
    );
    expect(browserSource).not.toContain("mixed module server secret");
    expect(browserSource).not.toContain("getServerSideProps");
  });

  it("fails closed for middleware and security-sensitive Next config", async () => {
    for (const fileName of ["middleware.ts", "proxy.ts"]) {
      const routingRoot = await mkdtemp(
        path.join(os.tmpdir(), "nextane-routing-file-"),
      );
      await writeFile(
        path.join(routingRoot, fileName),
        "export default function unsupportedRoutingFile() {}",
      );
      expect(() => assertNoUnsupportedRoutingFiles(routingRoot)).toThrow(
        new RegExp(`${fileName}.*explicitly migrate`),
      );
    }

    const domainsRoot = await mkdtemp(path.join(os.tmpdir(), "nextane-config-"));
    await writeFile(
      path.join(domainsRoot, "next.config.js"),
      `module.exports = { i18n: { locales: ["en"], defaultLocale: "en", domains: [{ domain: "example.com", defaultLocale: "en" }] } };`,
    );
    await expect(loadRoutingConfig(domainsRoot)).rejects.toThrow(
      /i18n\.domains routing is not supported/,
    );
  });

  it("parses supported i18n config", async () => {
    const configRoot = await mkdtemp(path.join(os.tmpdir(), "nextane-config-"));
    await writeFile(
      path.join(configRoot, "next.config.js"),
      `module.exports = { i18n: { locales: ["en", "fr"], defaultLocale: "en" } };`,
    );
    const config = await loadRoutingConfig(configRoot);
    expect(config.i18n).toEqual({ locales: ["en", "fr"], defaultLocale: "en" });
  });

  it("parses redirects, headers, and conditional rewrites from next.config", async () => {
    const configRoot = await mkdtemp(path.join(os.tmpdir(), "nextane-config-"));
    await writeFile(
      path.join(configRoot, "next.config.js"),
      `module.exports = {
        async rewrites() {
          return {
            beforeFiles: [
              {
                source: "/:path(.*)",
                has: [{ type: "query", key: "json", value: "true" }],
                destination: "/api/json?from=/:path",
              },
            ],
          };
        },
        async redirects() {
          return [
            { source: "/redirect-1", destination: "/somewhere-else", permanent: false },
            { source: "/redirect-no-basepath", destination: "/another", permanent: false, basePath: false },
          ];
        },
        async headers() {
          return [
            { source: "/add-header", headers: [{ key: "x-hello", value: "world" }] },
          ];
        },
      };`,
    );
    const config = await loadRoutingConfig(configRoot);
    expect(config.rewrites).toEqual([
      {
        source: "/:path(.*)",
        destination: "/api/json?from=/:path",
        phase: "beforeFiles",
        has: [{ type: "query", key: "json", value: "true" }],
      },
    ]);
    expect(config.redirects).toEqual([
      { source: "/redirect-1", destination: "/somewhere-else", phase: "afterFiles" },
      {
        source: "/redirect-no-basepath",
        destination: "/another",
        phase: "afterFiles",
        basePath: false,
      },
    ]);
    expect(config.headers).toEqual([
      { source: "/add-header", headers: [{ key: "x-hello", value: "world" }] },
    ]);
  });
});

describe("assetPrefix validation", () => {
  it("normalizes path prefixes and treats empty/'/' as no prefix", () => {
    expect(validatedAssetPrefix(undefined)).toBe("");
    expect(validatedAssetPrefix("")).toBe("");
    // Next.js accepts "/" as an effectively empty prefix rather than erroring.
    expect(validatedAssetPrefix("/")).toBe("");
    expect(validatedAssetPrefix("/assets")).toBe("/assets");
    expect(validatedAssetPrefix("/assets/")).toBe("/assets");
  });

  it("rejects full-URL prefixes and non-slash paths", () => {
    expect(() => validatedAssetPrefix("https://cdn.example.com")).toThrow(
      /full-URL assetPrefix/,
    );
    expect(() => validatedAssetPrefix("assets")).toThrow(/must start with a slash/);
  });
});
