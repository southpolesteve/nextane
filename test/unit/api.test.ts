import { describe, expect, it } from "vitest";
import { runApiRoute } from "../../src/server/api";

describe("Pages Router API routes", () => {
  it("adapts Request data to the classic request/response callback shape", async () => {
    const response = await runApiRoute(
      {
        default(request: {
          method?: string;
          query: Record<string, unknown>;
          cookies: Record<string, string>;
          body: unknown;
        }, reply: {
          status(code: number): unknown;
          setHeader(name: string, value: string): unknown;
          json(value: unknown): void;
        }) {
          reply.status(201);
          reply.setHeader("x-api-shape", "next");
          reply.json({
            method: request.method,
            query: request.query,
            cookies: request.cookies,
            body: request.body,
          });
        },
      },
      new Request("https://nextane.test/api/echo", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "session=octane%20powered",
        },
        body: JSON.stringify({ hello: "world" }),
      }),
      { name: "Steve" },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("x-api-shape")).toBe("next");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      method: "POST",
      query: { name: "Steve" },
      cookies: { session: "octane powered" },
      body: { hello: "world" },
    });
  });

  it("isolates overlapping API request bodies, cookies, headers, query, and response state", async () => {
    const requestCount = 24;
    let entered = 0;
    let releaseAll!: () => void;
    const allEntered = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });
    const route = {
      async default(
        request: {
          body: { token: string };
          cookies: Record<string, string>;
          headers: { get(name: string): string | null };
          query: Record<string, unknown>;
        },
        reply: {
          setHeader(name: string, value: string): void;
          json(value: unknown): void;
        },
      ) {
        const token = request.body.token;
        entered += 1;
        if (entered === requestCount) releaseAll();
        await allEntered;
        reply.setHeader("x-request-canary", token);
        reply.setHeader(
          "set-cookie",
          `api-canary=${token}; Path=/; HttpOnly`,
        );
        reply.json({
          token,
          cookie: request.cookies.session,
          authorization: request.headers.get("authorization"),
          query: request.query.token,
        });
      },
    };
    const tokens = Array.from(
      { length: requestCount },
      (_, index) => `api-${String(index).padStart(2, "0")}-canary`,
    );
    const responses = await Promise.all(
      tokens.map((token) =>
        runApiRoute(
          route,
          new Request(`https://nextane.test/api/isolation?token=${token}`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              cookie: `session=${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ token }),
          }),
          { token },
        ),
      ),
    );
    const bodies = await Promise.all(responses.map((response) => response.text()));

    for (let index = 0; index < requestCount; index += 1) {
      const token = tokens[index];
      expect(responses[index].headers.get("cache-control")).toBe(
        "private, no-store",
      );
      expect(responses[index].headers.get("x-request-canary")).toBe(token);
      expect(responses[index].headers.get("set-cookie")).toContain(token);
      expect(bodies[index]).toContain(token);
      expect(bodies[index]).toContain(`Bearer ${token}`);
      for (const other of tokens) {
        if (other !== token) expect(bodies[index]).not.toContain(other);
      }
    }
  });

  it("parses JSON, form, and text bodies with Pages-style semantics", async () => {
    const echoBody = {
      default(
        request: { body: unknown },
        reply: { json(value: unknown): void },
      ) {
        reply.json(request.body);
      },
    };
    const json = await runApiRoute(
      echoBody,
      new Request("https://nextane.test/api/body", {
        method: "POST",
        headers: { "content-type": "application/ld+json; charset=utf-8" },
        body: '{"kind":"json"}',
      }),
      {},
    );
    const form = await runApiRoute(
      echoBody,
      new Request("https://nextane.test/api/body", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body: "name=Octane&tag=fast&tag=small",
      }),
      {},
    );
    const text = await runApiRoute(
      echoBody,
      new Request("https://nextane.test/api/body", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "plain text",
      }),
      {},
    );

    expect(await json.json()).toEqual({ kind: "json" });
    expect(await form.json()).toEqual({
      name: "Octane",
      tag: ["fast", "small"],
    });
    expect(await text.json()).toBe("plain text");
  });

  it("rejects a declared body larger than the default 1 MiB before invoking the handler", async () => {
    let invoked = false;
    const response = await runApiRoute(
      {
        default() {
          invoked = true;
        },
      },
      new Request("https://nextane.test/api/limited", {
        method: "POST",
        headers: { "content-length": String(1024 * 1024 + 1) },
        body: "small",
      }),
      {},
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toContain("1048576 byte limit");
    expect(invoked).toBe(false);
  });

  it("counts streamed bytes when Content-Length is missing or dishonest", async () => {
    const route = {
      config: { api: { bodyParser: { sizeLimit: "5b" } } },
      default(
        request: { body: unknown },
        reply: { json(value: unknown): void },
      ) {
        reply.json(request.body);
      },
    };
    const unknownLength = await runApiRoute(
      route,
      new Request("https://nextane.test/api/limited", {
        method: "POST",
        body: "123456",
      }),
      {},
    );
    const dishonestLength = await runApiRoute(
      route,
      new Request("https://nextane.test/api/limited", {
        method: "POST",
        headers: { "content-length": "1" },
        body: "123456",
      }),
      {},
    );

    expect(unknownLength.status).toBe(413);
    expect(dishonestLength.status).toBe(413);
  });

  it("enforces the default limit when Content-Length is missing", async () => {
    let invoked = false;
    const response = await runApiRoute(
      {
        default() {
          invoked = true;
        },
      },
      new Request("https://nextane.test/api/limited", {
        method: "POST",
        body: new Uint8Array(1024 * 1024 + 1),
      }),
      {},
    );

    expect(response.status).toBe(413);
    expect(invoked).toBe(false);
  });

  it("supports a configured body limit and disabling automatic parsing", async () => {
    const configured = await runApiRoute(
      {
        config: { api: { bodyParser: { sizeLimit: "32b" } } },
        default(
          request: { body: unknown },
          reply: { json(value: unknown): void },
        ) {
          reply.json(request.body);
        },
      },
      new Request("https://nextane.test/api/configured", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"within":"limit"}',
      }),
      {},
    );
    const disabled = await runApiRoute(
      {
        config: { api: { bodyParser: false } },
        async default(
          request: { body: unknown; raw: Request },
          reply: { json(value: unknown): void },
        ) {
          reply.json({
            parsed: request.body,
            raw: await request.raw.text(),
          });
        },
      },
      new Request("https://nextane.test/api/raw", {
        method: "POST",
        body: "read the raw request",
      }),
      {},
    );

    expect(await configured.json()).toEqual({ within: "limit" });
    expect(await disabled.json()).toEqual({
      raw: "read the raw request",
    });
  });

  it("fails closed when an API route attempts to enable Preview Mode", async () => {
    await expect(
      runApiRoute(
        {
          default(
            _request: unknown,
            reply: { setPreviewData(data: unknown): void },
          ) {
            reply.setPreviewData({ user: "attacker" });
          },
        },
        new Request("https://nextane.test/api/preview"),
        {},
      ),
    ).rejects.toThrow(
      "Nextane does not support Preview Mode; setPreviewData() cannot issue secure preview cookies",
    );
  });

  it("supports Next-style redirects", async () => {
    const response = await runApiRoute(
      {
        default(_request: unknown, reply: { redirect(url: string): void }) {
          reply.redirect("/destination");
        },
      },
      new Request("https://nextane.test/api/redirect"),
      {},
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/destination");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps req.query writable and exposes a relative req.url", async () => {
    const response = await runApiRoute(
      {
        default(
          request: {
            url?: string;
            query: Record<string, unknown>;
          },
          reply: { json(value: unknown): void },
        ) {
          request.query.changed = "yes";
          reply.json({
            url: request.url,
            query: request.query,
          });
        },
      },
      new Request("https://nextane.test/api/example?hello=yes"),
      { hello: "yes" },
    );

    expect(await response.json()).toEqual({
      url: "/api/example?hello=yes",
      query: { hello: "yes", changed: "yes" },
    });
  });

  it("accepts Web-style API handlers that return a Response", async () => {
    const response = await runApiRoute(
      {
        config: { runtime: "edge" },
        async default(request: Request & { nextUrl: URL }) {
          return Response.json({
            query: Object.fromEntries(request.nextUrl.searchParams),
            body: await request.text(),
          });
        },
      },
      new Request("https://nextane.test/api/edge?hello=octane", {
        method: "POST",
        body: "edge body",
      }),
      { hello: "octane", id: "dynamic" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      query: { hello: "octane", id: "dynamic" },
      body: "edge body",
    });
  });

  it("preserves an explicit API cache policy", async () => {
    const response = await runApiRoute(
      {
        default(
          _request: unknown,
          reply: {
            setHeader(name: string, value: string): void;
            json(value: unknown): void;
          },
        ) {
          reply.setHeader("cache-control", "public, max-age=60");
          reply.json({ public: true });
        },
      },
      new Request("https://nextane.test/api/public"),
      {},
    );

    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });
});
