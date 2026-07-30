import type {
  NextApiRequest,
  NextApiResponse,
  ParsedUrlQuery,
} from "../types";
import { createPageRequest } from "./http";

async function parseBody(request: Request): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return request.json();
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(await request.formData());
  }
  return request.text();
}

interface ApiRuntimeOptions {
  revalidatePath?: (
    pathname: string,
    options?: { unstable_onlyGenerated?: boolean },
  ) => Promise<boolean> | boolean;
}

class ApiResponse<Data = unknown> implements NextApiResponse<Data> {
  statusCode = 200;
  statusMessage?: string;
  #headers = new Headers();
  #response: Response | null = null;
  #chunks: Uint8Array[] = [];

  constructor(private readonly options: ApiRuntimeOptions = {}) {}

  get headersSent() {
    return this.#response !== null || this.#chunks.length > 0;
  }

  get writableEnded() {
    return this.#response !== null;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string | string[]) {
    this.#headers.delete(name);
    for (const item of Array.isArray(value) ? value : [value]) this.#headers.append(name, item);
    return this;
  }

  getHeader(name: string) {
    return this.#headers.get(name);
  }

  getHeaders() {
    return Object.fromEntries(this.#headers);
  }

  hasHeader(name: string) {
    return this.#headers.has(name);
  }

  removeHeader(name: string) {
    this.#headers.delete(name);
  }

  writeHead(
    statusCode: number,
    statusMessageOrHeaders?: string | Record<string, string | string[]>,
    headers?: Record<string, string | string[]>,
  ) {
    this.statusCode = statusCode;
    const values =
      typeof statusMessageOrHeaders === "string"
        ? headers
        : statusMessageOrHeaders;
    if (typeof statusMessageOrHeaders === "string") {
      this.statusMessage = statusMessageOrHeaders;
    }
    for (const [name, value] of Object.entries(values ?? {})) {
      this.setHeader(name, value);
    }
    return this;
  }

  write(data: string | Uint8Array) {
    if (this.#response) return false;
    this.#chunks.push(
      typeof data === "string" ? new TextEncoder().encode(data) : data,
    );
    return true;
  }

  json(data: Data) {
    this.#headers.set("content-type", "application/json; charset=utf-8");
    this.end(JSON.stringify(data));
  }

  send(data: Data | string | Uint8Array) {
    if (typeof data === "object" && !(data instanceof Uint8Array)) {
      this.json(data);
      return;
    }
    this.end(data as string | Uint8Array);
  }

  redirect(statusOrUrl: number | string, url?: string) {
    const status = typeof statusOrUrl === "number" ? statusOrUrl : 307;
    const location = typeof statusOrUrl === "string" ? statusOrUrl : url;
    this.#headers.set("location", location ?? "/");
    this.#response = new Response(null, { status, headers: this.#headers });
  }

  setPreviewData(data: unknown) {
    const bypass = crypto.randomUUID();
    const encoded = btoa(
      encodeURIComponent(JSON.stringify(data)),
    );
    this.#headers.append(
      "set-cookie",
      `__prerender_bypass=${bypass}; Path=/; HttpOnly; SameSite=Lax`,
    );
    this.#headers.append(
      "set-cookie",
      `__next_preview_data=${encoded}; Path=/; HttpOnly; SameSite=Lax`,
    );
    return this;
  }

  async revalidate(
    pathname: string,
    options?: { unstable_onlyGenerated?: boolean },
  ) {
    if (!this.options.revalidatePath) {
      throw new Error("On-demand revalidation is not configured");
    }
    const revalidated = await this.options.revalidatePath(pathname, options);
    if (!revalidated) {
      throw new Error(`Unable to revalidate ${pathname}`);
    }
  }

  end(data?: string | Uint8Array) {
    if (data !== undefined) this.write(data);
    const size = this.#chunks.reduce(
      (total, chunk) => total + chunk.byteLength,
      0,
    );
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of this.#chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.#response = new Response(size > 0 ? body : null, {
      status: this.statusCode,
      statusText: this.statusMessage,
      headers: this.#headers,
    });
  }

  toResponse() {
    return (
      this.#response ??
      new Response(null, {
        status: this.statusCode === 200 ? 204 : this.statusCode,
        statusText: this.statusMessage,
        headers: this.#headers,
      })
    );
  }
}

export async function runApiRoute(
  module: Record<string, unknown>,
  request: Request,
  query: ParsedUrlQuery,
  options: ApiRuntimeOptions = {},
): Promise<Response> {
  const handler = module.default;
  if (typeof handler !== "function") {
    return new Response("API route must export a default function", { status: 500 });
  }

  const nextUrl = new URL(request.url);
  nextUrl.search = "";
  for (const [name, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) nextUrl.searchParams.append(name, item);
    }
  }
  const runtime =
    module.config &&
    typeof module.config === "object" &&
    "runtime" in module.config
      ? (module.config as { runtime?: unknown }).runtime
      : undefined;
  if (runtime === "edge" || runtime === "experimental-edge") {
    Object.defineProperty(request, "nextUrl", {
      value: nextUrl,
      configurable: true,
    });
    const returned = await handler(request);
    return returned instanceof Response
      ? returned
      : new Response(null, { status: 204 });
  }

  const pageRequest = createPageRequest(request);
  const apiRequest: NextApiRequest = {
    method: pageRequest.method,
    url: pageRequest.url,
    headers: pageRequest.headers,
    query,
    cookies: pageRequest.cookies,
    body: await parseBody(request),
    raw: request,
    nextUrl,
  };
  const apiResponse = new ApiResponse(options);
  const returned = await handler(apiRequest, apiResponse);
  return returned instanceof Response ? returned : apiResponse.toResponse();
}
