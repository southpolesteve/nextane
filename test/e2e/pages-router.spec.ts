import { expect, test } from "@playwright/test";

function buildIdFromHtml(html: string): string {
  const source =
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(
      html,
    )?.[1];
  expect(source).toBeTruthy();
  return (JSON.parse(source!) as { buildId: string }).buildId;
}

test("static props render, Octane hydrates, and Head owns the title", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-powered-by"]).toBe("Nextane");
  await expect(page).toHaveTitle("Nextane — Pages Router on Octane");
  await expect(page.getByRole("heading", { name: "Same pages. Different engine." })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-nextane-hydrated",
    "true",
  );
  await expect(page.getByRole("button", { name: "Octane state: 0" })).toBeVisible();
  expect(await page.locator("main.page").count()).toBe(1);
  await page.getByRole("button", { name: "Octane state: 0" }).click();
  await expect(page.getByRole("button", { name: "Octane state: 1" })).toBeVisible();

  const navText = await page.locator("nav a").allTextContents();
  expect(navText).toEqual(["Static props", "Server props", "Dynamic route", "ISR"]);
});

test("Link performs a Pages-style soft navigation and browser back works", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-nextane-hydrated",
    "true",
  );
  await page.getByRole("button", { name: "Octane state: 0" }).click();
  await expect(page.getByRole("button", { name: "Octane state: 1" })).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { __nextaneSentinel?: string }).__nextaneSentinel = "survived";
  });

  await page.getByRole("link", { name: "Navigate without a reload →" }).click();
  await expect(page).toHaveURL(/\/ssr\?from=home$/);
  await expect(page.getByRole("heading", { name: "Fresh on every request." })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as Window & { __nextaneSentinel?: string }).__nextaneSentinel,
    ),
  ).toBe("survived");

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Same pages. Different engine." })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as Window & { __nextaneSentinel?: string }).__nextaneSentinel,
    ),
  ).toBe("survived");
});

test("dynamic routes interpolate params through getServerSideProps", async ({ page }) => {
  const response = await page.goto("/posts/compiler-native");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Compiler Native — Nextane dynamic route");
  await expect(page.getByRole("heading", { name: "Compiler Native" })).toBeVisible();
  await expect(page.locator("main")).toContainText("pages/posts/[slug].tsrx");
});

test("custom 404 and classic API routes retain their familiar contracts", async ({
  page,
  request,
}) => {
  const notFound = await page.goto("/definitely-not-a-page");
  expect(notFound?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "That page ran out of fuel." })).toBeVisible();

  const api = await request.get("/api/hello?name=Steve");
  expect(api.status()).toBe(200);
  expect(await api.json()).toEqual({
    message: "Hello from a Next-shaped API route on Octane",
    method: "GET",
    query: { name: "Steve" },
    runtime: "Cloudflare Workers",
  });
});

test("ISR HTML and page-data requests share one rendered artifact", async ({ request }) => {
  let matchedArtifact = false;
  let dataPayload: unknown;

  // A production request can land exactly as stale-while-revalidate starts.
  // Retrying proves both public shapes converge on the newly cached artifact.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const html = await request.get("/isr");
    const htmlSource = await html.text();
    const data = await request.get(
      `/_next/data/${encodeURIComponent(buildIdFromHtml(htmlSource))}/isr.json`,
    );

    expect(html.status()).toBe(200);
    expect(data.status()).toBe(200);
    dataPayload = await data.json();
    if (
      html.headers()["x-nextane-generated-at"] ===
      data.headers()["x-nextane-generated-at"]
    ) {
      matchedArtifact = true;
      break;
    }
  }

  expect(matchedArtifact).toBe(true);
  expect(dataPayload).toMatchObject({
    __N_SSG: true,
    pageProps: { revalidate: 10 },
  });
});

test("security boundaries hold through the public runtime", async ({
  page,
  request,
}) => {
  const navigation = await page.goto("/");
  expect(navigation?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute(
    "data-nextane-hydrated",
    "true",
  );

  const unsafeNavigation = await page.evaluate(async () => {
    const runtimeWindow = window as Window & {
      __nextaneXssProbe?: number;
      next: {
        router: {
          push: (url: string) => Promise<boolean>;
        };
      };
    };
    runtimeWindow.__nextaneXssProbe = 0;
    const result = await runtimeWindow.next.router.push(
      "java\nscript:globalThis.__nextaneXssProbe=1",
    );
    return {
      href: window.location.href,
      probe: runtimeWindow.__nextaneXssProbe,
      result,
    };
  });
  expect(unsafeNavigation).toEqual({
    href: `${new URL("/", page.url())}`,
    probe: 0,
    result: false,
  });

  const home = await request.get("/");
  const homeHtml = await home.text();
  const buildId = buildIdFromHtml(homeHtml);
  expect(home.headers()["x-content-type-options"]).toBe("nosniff");
  expect(home.headers()["referrer-policy"]).toBe(
    "strict-origin-when-cross-origin",
  );

  const dataPath = `/_next/data/${encodeURIComponent(buildId)}/index.json`;
  expect((await request.fetch(dataPath, { method: "HEAD" })).status()).toBe(200);
  for (const method of ["POST", "PUT", "DELETE"]) {
    const response = await request.fetch(dataPath, { method });
    expect(response.status()).toBe(405);
    expect(response.headers().allow).toBe("GET, HEAD");
  }
  expect(
    (
      await request.get(
        `/_next/data/${encodeURIComponent(`${buildId}-wrong`)}/index.json`,
      )
    ).status(),
  ).toBe(404);

  const malformedCookie = await request.get("/ssr?cookie=malformed", {
    headers: { cookie: "broken=%E0%A4%A" },
  });
  expect(malformedCookie.status()).toBe(200);

  const hostileReplacement = "$&$`$'";
  const hostileResponse = await request.get(
    `/posts/${encodeURIComponent(hostileReplacement)}`,
  );
  expect(hostileResponse.status()).toBe(200);
  expect((await hostileResponse.body()).byteLength).toBeLessThan(100_000);

  const attackerCanary = `attacker-${Date.now()}`;
  await request.get(`/?cacheProbe=${attackerCanary}`, {
    headers: {
      authorization: `Bearer ${attackerCanary}`,
      cookie: `session=${attackerCanary}`,
    },
  });
  const victim = await request.get("/?cacheProbe=victim");
  expect(await victim.text()).not.toContain(attackerCanary);

  if (process.env.NEXTANE_BASE_URL) {
    const scriptSources = [
      ...homeHtml.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"/g),
    ].map((match) => match[1]);
    expect(scriptSources.length).toBeGreaterThan(0);
    for (const source of scriptSources) {
      expect((await request.get(`${source}.map`)).status()).toBe(404);
    }
  }
});
