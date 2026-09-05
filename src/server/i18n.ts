/**
 * Minimal Next.js Pages Router i18n: locale-prefixed routing with an
 * unprefixed default locale, locale context for the data functions, and the
 * root-path `localeDetection` redirect (NEXT_LOCALE cookie / Accept-Language).
 *
 * Not implemented: `domains` routing.
 */

export interface I18nConfig {
  locales: string[];
  defaultLocale: string;
  /**
   * `false` disables the root-path locale-detection redirect. Next.js enables
   * detection by default, so the field is only recorded when explicitly off.
   */
  localeDetection?: false;
}

export function normalizeI18nConfig(value: unknown): I18nConfig | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const locales = candidate.locales;
  const defaultLocale = candidate.defaultLocale;
  if (
    !Array.isArray(locales) ||
    locales.length === 0 ||
    !locales.every((locale) => typeof locale === "string" && locale !== "") ||
    typeof defaultLocale !== "string" ||
    !locales.includes(defaultLocale)
  ) {
    throw new Error(
      "[nextane] i18n config must set a non-empty string `locales` array and a `defaultLocale` contained in it",
    );
  }
  // Next.js (config.ts assignDefaults) moves the default locale to the front.
  // The order is observable through `router.locales` and decides the
  // Accept-Language tie-break, so mirror it here.
  const ordered = [
    defaultLocale,
    ...(locales as string[]).filter((locale) => locale !== defaultLocale),
  ];
  const detection = candidate.localeDetection;
  if (detection !== undefined && typeof detection !== "boolean") {
    throw new Error(
      "[nextane] i18n.localeDetection must be a boolean when specified",
    );
  }
  const config: I18nConfig = { locales: ordered, defaultLocale };
  if (detection === false) config.localeDetection = false;
  return config;
}

export interface LocaleResolution {
  locale: string;
  pathname: string;
  hadLocalePrefix: boolean;
}

/**
 * Split a leading locale segment off a (basePath-stripped) pathname. When the
 * first segment is a configured locale it is removed and reported; otherwise
 * the default locale applies and the path is unchanged.
 */
export function resolveLocale(
  pathname: string,
  i18n: I18nConfig,
): LocaleResolution {
  const firstSlash = pathname.indexOf("/", 1);
  const firstSegment =
    firstSlash === -1 ? pathname.slice(1) : pathname.slice(1, firstSlash);
  const match = i18n.locales.find(
    (locale) => locale.toLowerCase() === firstSegment.toLowerCase(),
  );
  if (match) {
    const rest = firstSlash === -1 ? "/" : pathname.slice(firstSlash);
    return { locale: match, pathname: rest, hadLocalePrefix: true };
  }
  return {
    locale: i18n.defaultLocale,
    pathname,
    hadLocalePrefix: false,
  };
}

/** Prepend `/{locale}` to a locale-stripped pathname. */
export function addLocalePrefix(pathname: string, locale: string): string {
  if (pathname === "/") return `/${locale}`;
  return `/${locale}${pathname}`;
}

interface AcceptSelection {
  pos: number;
  pref?: number;
  q: number;
  token: string;
}

/**
 * Faithful port of Next.js's dependency-free Accept-Language negotiator
 * (`packages/next/src/server/accept-header.ts`, prefix matching enabled):
 * entries are ranked by q-value, then by configured-locale order, then by
 * header position; a language-only entry ("en") matches a regional locale
 * ("en-CA"). Throws on a malformed header, exactly like Next.
 */
function parseAcceptLanguage(
  raw: string,
  locales: readonly string[],
): string[] {
  const lowers = new Map<string, { orig: string; pos: number }>();
  const header = raw.replace(/[ \t]/g, "");

  let position = 0;
  for (const locale of locales) {
    const lower = locale.toLowerCase();
    lowers.set(lower, { orig: locale, pos: position++ });
    const parts = lower.split("-");
    while ((parts.pop(), parts.length > 0)) {
      const joined = parts.join("-");
      if (!lowers.has(joined)) {
        lowers.set(joined, { orig: locale, pos: position++ });
      }
    }
  }

  const parts = header.split(",");
  const selections: AcceptSelection[] = [];
  const listed = new Set<string>();

  for (let index = 0; index < parts.length; ++index) {
    const part = parts[index];
    if (!part) continue;

    const params = part.split(";");
    if (params.length > 2) {
      throw new Error("Invalid accept-language header");
    }

    const token = params[0].toLowerCase();
    if (!token) {
      throw new Error("Invalid accept-language header");
    }

    const selection: AcceptSelection = { token, pos: index, q: 1 };
    const known = lowers.get(token);
    if (known) selection.pref = known.pos;
    listed.add(token);

    if (params.length === 2) {
      const [key, value] = params[1].split("=");
      if (!value || (key !== "q" && key !== "Q")) {
        throw new Error("Invalid accept-language header");
      }
      const score = parseFloat(value);
      if (score === 0) continue;
      if (Number.isFinite(score) && score <= 1 && score >= 0.001) {
        selection.q = score;
      }
    }

    selections.push(selection);
  }

  selections.sort((a, b) => {
    if (b.q !== a.q) return b.q - a.q;
    if (b.pref !== a.pref) {
      if (a.pref === undefined) return 1;
      if (b.pref === undefined) return -1;
      return a.pref - b.pref;
    }
    return a.pos - b.pos;
  });

  const preferred: string[] = [];
  for (const { token } of selections) {
    if (token === "*") {
      for (const [candidate, value] of lowers) {
        if (!listed.has(candidate)) preferred.push(value.orig);
      }
    } else {
      const known = lowers.get(token);
      if (known) preferred.push(known.orig);
    }
  }
  return preferred;
}

/**
 * Best configured locale for an Accept-Language header, or "" when nothing
 * matches. Mirrors Next's `acceptLanguage(header, locales)`.
 */
export function acceptLanguage(
  header = "",
  locales: readonly string[],
): string {
  return parseAcceptLanguage(header, locales)[0] ?? "";
}

/** Next swallows a malformed Accept-Language header and falls through. */
function preferredLocaleFromHeader(
  header: string | null | undefined,
  locales: readonly string[],
): string | undefined {
  if (!header) return undefined;
  try {
    return acceptLanguage(header, locales) || undefined;
  } catch {
    return undefined;
  }
}

/** `NEXT_LOCALE` cookie value matched case-insensitively against the locales. */
function localeFromCookie(
  value: string | undefined,
  i18n: I18nConfig,
): string | undefined {
  if (!value) return undefined;
  // Next parses cookies with the `cookie` package, which unquotes values.
  const lower = value.replace(/^"(.*)"$/, "$1").toLowerCase();
  return i18n.locales.find((locale) => locale.toLowerCase() === lower);
}

export interface LocaleDetectionInput {
  /** Routing pathname after basePath and locale stripping. */
  pathname: string;
  /** Whether the request path carried an explicit locale prefix. */
  hadLocalePrefix: boolean;
  nextLocaleCookie: string | undefined;
  acceptLanguageHeader: string | null | undefined;
  i18n: I18nConfig;
  basePath: string;
  trailingSlash: boolean;
  /** The request's `?query` (empty string when absent); preserved on redirect. */
  search: string;
}

/**
 * Next.js root-path locale detection (`getLocaleRedirect`): for a request to
 * the bare "/" (no locale prefix), choose NEXT_LOCALE cookie, then the
 * Accept-Language preference, then the default locale, and redirect to
 * `/{locale}` only when the choice differs from the default. Returns the
 * Location (pathname + search) or null when no redirect applies. A prefixed
 * root like "/fr" never re-triggers, so the redirect cannot loop.
 */
export function localeDetectionRedirect(
  input: LocaleDetectionInput,
): string | null {
  const { i18n } = input;
  if (i18n.localeDetection === false) return null;
  // Next denormalizes "/index" and "/index/" to the root before this check.
  const isRoot =
    input.pathname === "/" ||
    input.pathname === "/index" ||
    input.pathname === "/index/";
  if (input.hadLocalePrefix || !isRoot) return null;

  // Negotiate against a default-first list, as Next's normalized config is;
  // this settles "*" and equal-q ties on the default locale (no redirect).
  const negotiable = [
    i18n.defaultLocale,
    ...i18n.locales.filter((locale) => locale !== i18n.defaultLocale),
  ];
  const detected =
    localeFromCookie(input.nextLocaleCookie, i18n) ||
    preferredLocaleFromHeader(input.acceptLanguageHeader, negotiable) ||
    i18n.defaultLocale;
  if (detected.toLowerCase() === i18n.defaultLocale.toLowerCase()) return null;

  return `${input.basePath}/${detected}${input.trailingSlash ? "/" : ""}${input.search}`;
}
