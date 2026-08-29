import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Next.js-compatible Preview Mode cookies.
 *
 * `__prerender_bypass` carries an opaque per-build bypass id and
 * `__next_preview_data` carries the preview payload encrypted with
 * AES-256-GCM and authenticated with an HMAC-SHA256 signature, so preview
 * cookies cannot be minted or altered without the build's server-only keys.
 */

export const PREVIEW_BYPASS_COOKIE = "__prerender_bypass";
export const PREVIEW_DATA_COOKIE = "__next_preview_data";
export const PREVIEW_CACHE_CONTROL =
  "private, no-cache, no-store, max-age=0, must-revalidate";
const PREVIEW_DATA_LIMIT = 2048;
const KEY_PATTERN = /^[0-9a-f]{64}$/i;
const ID_PATTERN = /^[0-9a-f]{16,64}$/i;

export interface PreviewCredentials {
  previewModeId: string;
  encryptionKey: string;
  signingKey: string;
}

export interface PreviewCookieOptions {
  maxAge?: number;
  path?: string;
}

export type PreviewState =
  | { enabled: false; shouldClear: boolean }
  | { enabled: true; previewData: unknown; shouldClear: false };

export const DISABLED_PREVIEW: PreviewState = {
  enabled: false,
  shouldClear: false,
};

export function generatePreviewCredentials(): PreviewCredentials {
  return {
    previewModeId: randomBytes(16).toString("hex"),
    encryptionKey: randomBytes(32).toString("hex"),
    signingKey: randomBytes(32).toString("hex"),
  };
}

export function validatePreviewCredentials(
  value: unknown,
): PreviewCredentials | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.previewModeId !== "string" ||
    typeof candidate.encryptionKey !== "string" ||
    typeof candidate.signingKey !== "string" ||
    !ID_PATTERN.test(candidate.previewModeId) ||
    !KEY_PATTERN.test(candidate.encryptionKey) ||
    !KEY_PATTERN.test(candidate.signingKey)
  ) {
    return null;
  }
  return {
    previewModeId: candidate.previewModeId,
    encryptionKey: candidate.encryptionKey,
    signingKey: candidate.signingKey,
  };
}

function signPayload(credentials: PreviewCredentials, token: string): string {
  return createHmac("sha256", Buffer.from(credentials.signingKey, "hex"))
    .update(token)
    .digest("base64url");
}

export function encodePreviewData(
  credentials: PreviewCredentials,
  data: unknown,
  maxAge?: number,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(credentials.encryptionKey, "hex"),
    iv,
  );
  const plaintext = JSON.stringify({
    data,
    ...(maxAge === undefined
      ? {}
      : { expiresAt: Date.now() + Math.trunc(maxAge) * 1000 }),
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const token = [iv, encrypted, cipher.getAuthTag()]
    .map((part) => part.toString("base64url"))
    .join(".");
  const encoded = `${token}.${signPayload(credentials, token)}`;
  if (encoded.length > PREVIEW_DATA_LIMIT) {
    throw new Error(
      "Preview data is limited to 2KB currently, reduce how much data you are storing as preview data to continue",
    );
  }
  return encoded;
}

export function decodePreviewData(
  credentials: PreviewCredentials,
  value: string,
): { valid: boolean; data?: unknown } {
  const segments = value.split(".");
  if (segments.length !== 4) return { valid: false };
  const token = segments.slice(0, 3).join(".");
  const expected = Buffer.from(signPayload(credentials, token), "utf8");
  const provided = Buffer.from(segments[3], "utf8");
  if (
    expected.byteLength !== provided.byteLength ||
    !timingSafeEqual(expected, provided)
  ) {
    return { valid: false };
  }

  try {
    const [iv, encrypted, authTag] = segments
      .slice(0, 3)
      .map((segment) => Buffer.from(segment, "base64url"));
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(credentials.encryptionKey, "hex"),
      iv,
    );
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(plaintext) as {
      data?: unknown;
      expiresAt?: number;
    };
    if (
      typeof payload.expiresAt === "number" &&
      Date.now() > payload.expiresAt
    ) {
      return { valid: false };
    }
    return { valid: true, data: payload.data };
  } catch {
    return { valid: false };
  }
}

function serializePreviewCookie(
  name: string,
  value: string,
  options: PreviewCookieOptions & { expire?: boolean } = {},
): string {
  const secure =
    typeof import.meta.env === "undefined" || !import.meta.env.DEV;
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "HttpOnly",
    `Path=${options.path ?? "/"}`,
    secure ? "SameSite=None" : "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  if (options.expire) {
    parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  } else if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.trunc(options.maxAge)}`);
  }
  return parts.join("; ");
}

export function previewCookies(
  credentials: PreviewCredentials,
  data: unknown,
  options: PreviewCookieOptions = {},
): string[] {
  return [
    serializePreviewCookie(
      PREVIEW_BYPASS_COOKIE,
      credentials.previewModeId,
      options,
    ),
    serializePreviewCookie(
      PREVIEW_DATA_COOKIE,
      encodePreviewData(credentials, data, options.maxAge),
      options,
    ),
  ];
}

export function draftModeCookies(
  credentials: PreviewCredentials,
  enable: boolean,
  options: PreviewCookieOptions = {},
): string[] {
  return [
    serializePreviewCookie(
      PREVIEW_BYPASS_COOKIE,
      enable ? credentials.previewModeId : "",
      { ...options, expire: !enable },
    ),
  ];
}

export function clearPreviewCookies(
  options: PreviewCookieOptions = {},
): string[] {
  return [
    serializePreviewCookie(PREVIEW_BYPASS_COOKIE, "", {
      ...options,
      expire: true,
    }),
    serializePreviewCookie(PREVIEW_DATA_COOKIE, "", {
      ...options,
      expire: true,
    }),
  ];
}

export function resolvePreviewState(
  cookies: Record<string, string>,
  credentials: PreviewCredentials,
): PreviewState {
  const bypass = cookies[PREVIEW_BYPASS_COOKIE];
  const data = cookies[PREVIEW_DATA_COOKIE];
  if (bypass === undefined && data === undefined) return DISABLED_PREVIEW;
  if (bypass !== credentials.previewModeId) {
    return { enabled: false, shouldClear: true };
  }
  if (data === undefined) {
    // Draft Mode: a valid bypass cookie with no preview data payload.
    return { enabled: true, previewData: {}, shouldClear: false };
  }
  const decoded = decodePreviewData(credentials, data);
  if (!decoded.valid) return { enabled: false, shouldClear: true };
  return { enabled: true, previewData: decoded.data, shouldClear: false };
}

interface PreviewResponseTarget {
  setHeader(name: string, value: string | string[]): unknown;
  getHeader(name: string): string | null;
}

function appendSetCookies(
  response: PreviewResponseTarget & {
    appendCookies?: (cookies: string[]) => void;
  },
  cookies: string[],
): void {
  if (typeof response.appendCookies === "function") {
    response.appendCookies(cookies);
    return;
  }
  const existing = response.getHeader("set-cookie");
  response.setHeader(
    "set-cookie",
    existing ? [existing, ...cookies] : cookies,
  );
}

export interface PreviewApi {
  setPreviewData(data: unknown, options?: PreviewCookieOptions): unknown;
  clearPreviewData(options?: PreviewCookieOptions): unknown;
  setDraftMode(options?: { enable?: boolean }): unknown;
}

export function attachPreviewApi<Target extends PreviewResponseTarget>(
  response: Target,
  credentials: PreviewCredentials,
): Target & PreviewApi {
  const target = response as Target & PreviewApi;
  target.setPreviewData = (data, options = {}) => {
    appendSetCookies(response, previewCookies(credentials, data, options));
    return response;
  };
  target.clearPreviewData = (options = {}) => {
    appendSetCookies(response, clearPreviewCookies(options));
    return response;
  };
  target.setDraftMode = (options = { enable: true }) => {
    appendSetCookies(
      response,
      draftModeCookies(credentials, options.enable !== false),
    );
    return response;
  };
  return target;
}
