import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { octane } from "@octanejs/vite-plugin";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import {
  assertNoUnsupportedRoutingFiles,
  createClientPageSource,
  loadRoutingConfig,
  nextane,
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

    for (const configName of ["headers", "redirects", "i18n"]) {
      const configRoot = await mkdtemp(
        path.join(os.tmpdir(), "nextane-config-"),
      );
      const value =
        configName === "i18n"
          ? `{ locales: ["en"], defaultLocale: "en" }`
          : "async () => []";
      await writeFile(
        path.join(configRoot, "next.config.ts"),
        `export default { ${configName}: ${value} };`,
      );
      await expect(loadRoutingConfig(configRoot)).rejects.toThrow(
        new RegExp(`security policy: ${configName}`),
      );
    }
  });
});
