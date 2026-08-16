/**
 * Minimal Next.js Pages Router i18n: locale-prefixed routing with an
 * unprefixed default locale, and locale context for the data functions.
 *
 * Not implemented: `domains` routing and Accept-Language/`NEXT_LOCALE`-cookie
 * detection redirects (`localeDetection`). Those are separate features no
 * currently-exercised suite depends on.
 */

export interface I18nConfig {
  locales: string[];
  defaultLocale: string;
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
  return {
    locales: locales as string[],
    defaultLocale,
  };
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
