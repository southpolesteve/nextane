import type {
  NextaneRequest,
  NextaneServerResponse,
} from "../types";

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [name, ...value] = part.trim().split("=");
      return [name, decodeURIComponent(value.join("="))];
    }),
  );
}

function requestHeaders(headers: Headers) {
  const values = Object.fromEntries(headers) as Headers &
    Record<string, string | string[] | undefined>;

  Object.defineProperties(values, {
    get: { value: headers.get.bind(headers), enumerable: false },
    has: { value: headers.has.bind(headers), enumerable: false },
    entries: { value: headers.entries.bind(headers), enumerable: false },
    keys: { value: headers.keys.bind(headers), enumerable: false },
    values: { value: headers.values.bind(headers), enumerable: false },
    forEach: { value: headers.forEach.bind(headers), enumerable: false },
    [Symbol.iterator]: { value: headers[Symbol.iterator].bind(headers), enumerable: false },
  });

  return values;
}

export function createPageRequest(
  request: Request,
  url = new URL(request.url),
): NextaneRequest {
  return {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers: requestHeaders(request.headers),
    cookies: parseCookies(request.headers.get("cookie")),
    raw: request,
  };
}

export interface ResponseSnapshot {
  status: number;
  statusMessage?: string;
  headers: [string, string][];
  body?: string;
  ended: boolean;
}

export class PageResponse implements NextaneServerResponse {
  statusCode = 200;
  statusMessage?: string;
  readonly #headers = new Headers();
  readonly #body: Uint8Array[] = [];
  #ended = false;
  #headersSent = false;

  get headersSent() {
    return this.#headersSent;
  }

  get finished() {
    return this.#ended;
  }

  setHeader(name: string, value: string | string[]) {
    this.#headers.delete(name);
    for (const item of Array.isArray(value) ? value : [value]) {
      this.#headers.append(name, item);
    }
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
    const headerValues =
      typeof statusMessageOrHeaders === "string" ? headers : statusMessageOrHeaders;
    if (typeof statusMessageOrHeaders === "string") {
      this.statusMessage = statusMessageOrHeaders;
    }
    for (const [name, value] of Object.entries(headerValues ?? {})) {
      this.setHeader(name, value);
    }
    this.#headersSent = true;
    return this;
  }

  write(data: string | Uint8Array) {
    if (this.#ended) return false;
    this.#headersSent = true;
    this.#body.push(
      typeof data === "string" ? new TextEncoder().encode(data) : data,
    );
    return true;
  }

  end(data?: string | Uint8Array) {
    if (data !== undefined) this.write(data);
    this.#headersSent = true;
    this.#ended = true;
  }

  snapshot(): ResponseSnapshot {
    const length = this.#body.reduce((total, chunk) => total + chunk.byteLength, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.#body) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      status: this.statusCode,
      statusMessage: this.statusMessage,
      headers: [...this.#headers.entries()],
      body: length > 0 ? new TextDecoder().decode(bytes) : undefined,
      ended: this.#ended,
    };
  }
}
