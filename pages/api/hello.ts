import type { NextApiRequest, NextApiResponse } from "nextane";

interface HelloResponse {
  message: string;
  method?: string;
  query: NextApiRequest["query"];
  runtime: string;
}

export default function handler(
  request: NextApiRequest,
  response: NextApiResponse<HelloResponse>,
) {
  response.status(200).json({
    message: "Hello from a Next-shaped API route on Octane",
    method: request.method,
    query: request.query,
    runtime: "Cloudflare Workers",
  });
}
