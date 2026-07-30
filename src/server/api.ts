import type {
  NextApiRequest,
  NextApiResponse,
  ParsedUrlQuery,
} from "../types";
import { createPageRequest } from "./http";

const DEFAULT_BODY_LIMIT = 1024 * 1024;

class ApiBodyTooLargeError extends Error {
  readonly statusCode = 413;

  constructor(readonly limit: number) {
    super(`Body exceeded ${limit} byte limit`);
    this.name = "ApiBodyTooLargeError";
  }
}

function parseSizeLimit(value: unknown): number {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) return value;
    throw new TypeError("API body sizeLimit must be a non-negative safe integer");
  }
  if (typeof value !== "string") {
    throw new TypeError("API body sizeLimit must be a number or size string");
  }

  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(value);
  if (!match) {
    throw new TypeError(`Invalid API body sizeLimit: ${value}`);
  }
  const multiplier = {
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
  }[(match[2] ?? "b").toLowerCase()]!;
  const bytes = Math.floor(Number(match[1]) * multiplier);
  if (!Number.isSafeInteger(bytes)) {
    throw new TypeError(`API body sizeLimit is too large: ${value}`);
  }
  return bytes;
}

function configuredBodyParser(
  module: Record<string, unknown>,
): false | { sizeLimit: number } {
  const config =
    module.config && typeof module.config === "object"
      ? (module.config as Record<string, unknown>)
      : {};
  const api =
    config.api && typeof config.api === "object"
      ? (config.api as Record<string, unknown>)
      : {};
  if (api.bodyParser === false) return false;
  const bodyParser =
    api.bodyParser && typeof api.bodyParser === "object"
      ? (api.bodyParser as Record<string, unknown>)
      : {};
  return {
    sizeLimit:
      bodyParser.sizeLimit === undefined
        ? DEFAULT_BODY_LIMIT
        : parseSizeLimit(bodyParser.sizeLimit),
  };
}

function declaredContentLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (!value || !/^\d+$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

async function readLimitedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  const declared = declaredContentLength(request);
  if (declared !== null && declared > limit) {
    throw new ApiBodyTooLargeError(limit);
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        try {
          await reader.cancel();
        } catch {
          // A failing stream cancellation must not turn a deterministic 413
          // into an application-visible stream error.
        }
        throw new ApiBodyTooLargeError(limit);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseFormBody(body: string): Record<string, string | string[]> {
  const parsed: Record<string, string | string[]> = Object.create(null);
  for (const [name, value] of new URLSearchParams(body)) {
    const previous = parsed[name];
    if (previous === undefined) parsed[name] = value;
    else if (Array.isArray(previous)) previous.push(value);
    else parsed[name] = [previous, value];
  }
  return parsed;
}

async function parseBody(request: Request, limit: number): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const bytes = await readLimitedBody(request, limit);
  const body = new TextDecoder().decode(bytes);
  const contentType = (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType === "application/json" || contentType === "application/ld+json") {
    return body.length === 0 ? {} : JSON.parse(body);
  }
  if (contentType === "application/x-www-form-urlencoded") {
    return parseFormBody(body);
  }
  return body;
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

  setPreviewData(data: unknown): never {
    void data;
    throw new Error(
      "Nextane does not support Preview Mode; setPreviewData() cannot issue secure preview cookies",
    );
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

function withDefaultApiCachePolicy(response: Response): Response {
  if (response.status === 101 || response.headers.has("cache-control")) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
    return withDefaultApiCachePolicy(
      returned instanceof Response
        ? returned
        : new Response(null, { status: 204 }),
    );
  }

  const pageRequest = createPageRequest(request);
  const bodyParser = configuredBodyParser(module);
  let body: unknown;
  if (bodyParser !== false) {
    try {
      body = await parseBody(request, bodyParser.sizeLimit);
    } catch (error) {
      if (error instanceof ApiBodyTooLargeError) {
        return new Response(error.message, {
          status: error.statusCode,
          headers: {
            "cache-control": "private, no-store",
            "content-type": "text/plain; charset=utf-8",
          },
        });
      }
      throw error;
    }
  }
  const apiRequest: NextApiRequest = {
    method: pageRequest.method,
    url: pageRequest.url,
    headers: pageRequest.headers,
    query,
    cookies: pageRequest.cookies,
    body,
    raw: request,
    nextUrl,
  };
  const apiResponse = new ApiResponse(options);
  const returned = await handler(apiRequest, apiResponse);
  return withDefaultApiCachePolicy(
    returned instanceof Response ? returned : apiResponse.toResponse(),
  );
}
