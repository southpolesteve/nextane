import { expect, it } from "vitest";
import { runApiRoute } from "../../src/server/api";

it("preserves the upstream writable req.query API assertion", async () => {
  const response = await runApiRoute(
    {
      default(req: any, res: any) {
        req.query = { ...req.query, changed: "yes" };
        res.status(200).json({ query: req.query });
      },
    },
    new Request("https://example.test/api?hello=yes"),
    { hello: "yes" },
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    query: { hello: "yes", changed: "yes" },
  });
});
