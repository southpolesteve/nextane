import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { adaptFixture } from "../../scripts/upstream/adapt-fixture.mjs";

const nextaneRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const temporaryDirectories: string[] = [];

async function fixture(files: Record<string, string | Uint8Array>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nextane-adapter-test-"));
  temporaryDirectories.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const destination = path.join(root, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("upstream fixture adaptation", () => {
  it("migrates hello-world to a deterministic Octane/Workers fixture", async () => {
    const root = await fixture({
      "pages/index.tsx": "export default () => <p>hello world</p>\n",
    });

    const report = await adaptFixture({ root, nextaneRoot });

    expect(report.profile).toBe("hello-world");
    expect(report.renamed).toEqual([
      { from: "pages/index.tsx", to: "pages/index.tsrx" },
    ]);
    expect(await fs.readFile(path.join(root, "pages/index.tsrx"), "utf8")).toBe(
      "export default () => <p>hello world</p>\n",
    );
    expect(
      await fs.readFile(
        path.join(root, "nextane-upstream.vite.config.mjs"),
        "utf8",
      ),
    ).toContain('configPath: "nextane-upstream.wrangler.jsonc"');
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(root, ".nextane-upstream-adaptation.json"),
          "utf8",
        ),
      ),
    ).toEqual(report);
  });

  it("rewrites dynamic page imports without changing API route extensions", async () => {
    const root = await fixture({
      "pages/blog/[slug].js": [
        "import Link from 'next/link'",
        "import { useRouter } from 'next/router'",
        "export default () => <Link href={useRouter().asPath}>post</Link>",
        "",
      ].join("\n"),
      "pages/api/dynamic/[slug].js":
        "export default (req, res) => res.end(String(req.query.slug))\n",
    });

    const report = await adaptFixture({ root, nextaneRoot });
    const page = await fs.readFile(
      path.join(root, "pages/blog/[slug].tsrx"),
      "utf8",
    );

    expect(report.profile).toBe("dynamic-route-interpolation");
    expect(page).toContain('from "nextane/link"');
    expect(page).toContain('from "nextane/router"');
    await expect(
      fs.access(path.join(root, "pages/api/dynamic/[slug].js")),
    ).resolves.toBeUndefined();
  });

  it("applies the checked-in custom App/Document migration", async () => {
    const root = await fixture({
      "pages/_document.js":
        "import Document from 'next/document'; export default class D extends Document {}\n",
      "pages/_app.js":
        "import App from 'next/app'; export default class A extends App { render() { return <main /> } }\n",
      "pages/index.js": "export default () => <p>page</p>\n",
      "shared-module.js": "export default function state() { return 'UPDATED' }\n",
    });

    const report = await adaptFixture({ root, nextaneRoot });

    expect(report.profile).toBe("app-document-rendering");
    expect(report.overlays).toEqual([
      "pages/_app.tsrx",
      "pages/_document.tsrx",
    ]);
    expect(
      await fs.readFile(path.join(root, "pages/_document.tsrx"), "utf8"),
    ).toContain('from "nextane/document"');
    const html = await fs.readFile(path.join(root, "index.html"), "utf8");
    expect(html).not.toContain('class="test-html-props"');
    expect(html).toContain('<div id="__next"></div>');
  });

  it("fails closed for a fixture outside the smoke allowlist", async () => {
    const root = await fixture({
      "pages/index.js": "export default () => <p>unknown</p>\n",
    });

    await expect(adaptFixture({ root, nextaneRoot })).rejects.toThrow(
      "no supported profile matched",
    );
  });
});
