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
    expect(await response.json()).toEqual({
      method: "POST",
      query: { name: "Steve" },
      cookies: { session: "octane powered" },
      body: { hello: "world" },
    });
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
    expect(await response.json()).toEqual({
      query: { hello: "octane", id: "dynamic" },
      body: "edge body",
    });
  });
});
