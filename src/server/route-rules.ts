/**
 * next.config route rules: rewrites, redirects, and headers.
 *
 * Sources use the path-to-regexp subset Next.js documents — `:param`,
 * `:param+`, `:param*`, `:param?`, and `:param(pattern)` with a conservative
 * inline pattern alphabet — matched case-insensitively. Rules may carry
 * `has`/`missing` conditions over headers, cookies, query values, and host.
 */

export interface RouteHas {
  type: "header" | "cookie" | "query" | "host";
  key: string;
  value?: string;
}

export interface RewriteRule {
  source: string;
  destination: string;
  has?: RouteHas[];
  missing?: RouteHas[];
  basePath?: false;
}

export interface RedirectRule extends RewriteRule {
  permanent?: boolean;
  statusCode?: number;
}

export interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
  has?: RouteHas[];
  missing?: RouteHas[];
  basePath?: false;
}

interface SourceParameter {
  name: string;
  pattern?: string;
  modifier?: string;
  index: number;
  length: number;
}

const PARAMETER_PATTERN = /:([A-Za-z0-9_]+)(?:\(([^()]*)\))?([+*?])?/g;
const INLINE_PATTERN_ALLOWED = /^[A-Za-z0-9_\-|.^$\\/[\]*+?=!]*$/;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, (character) => `\\${character}`);
}

function sourceParameters(source: string): SourceParameter[] {
  return [...source.matchAll(PARAMETER_PATTERN)].map((match) => ({
    name: match[1],
    pattern: match[2],
    modifier: match[3],
    index: match.index ?? 0,
    length: match[0].length,
  }));
}

function isGreedy(parameter: SourceParameter): boolean {
  if (parameter.modifier === "+" || parameter.modifier === "*") return true;
  return (
    parameter.pattern !== undefined &&
    /[*+]/.test(parameter.pattern.replace(/\\./g, ""))
  );
}

export function validateRuleSource(source: string, kind: string): void {
  const parameters = sourceParameters(source);
  for (const parameter of parameters) {
    if (
      parameter.pattern !== undefined &&
      !INLINE_PATTERN_ALLOWED.test(parameter.pattern)
    ) {
      throw new Error(
        `Unsupported ${kind} source "${source}": parameter pattern ` +
          `"${parameter.pattern}" uses unsupported syntax`,
      );
    }
  }
  const greedyParameters = parameters.filter(isGreedy);
  if (greedyParameters.length > 1) {
    throw new Error(
      `Unsupported ambiguous ${kind} source "${source}": only one greedy parameter is allowed`,
    );
  }
  for (let index = 1; index < parameters.length; index += 1) {
    const previous = parameters[index - 1];
    if (parameters[index].index === previous.index + previous.length) {
      throw new Error(
        `Unsupported ambiguous ${kind} source "${source}": parameters must be separated by literal text`,
      );
    }
  }
}

const compiledSources = new Map<
  string,
  { pattern: RegExp; names: string[] }
>();

function compileSource(source: string): { pattern: RegExp; names: string[] } {
  let compiled = compiledSources.get(source);
  if (compiled) return compiled;

  const names: string[] = [];
  let pattern = "^";
  let cursor = 0;
  for (const parameter of sourceParameters(source)) {
    pattern += escapeRegex(source.slice(cursor, parameter.index));
    names.push(parameter.name);
    if (parameter.pattern !== undefined) pattern += `(${parameter.pattern})`;
    else if (parameter.modifier === "+") pattern += "(.+)";
    else if (parameter.modifier === "*") pattern += "(.*)";
    else if (parameter.modifier === "?") pattern += "([^/]*)";
    else pattern += "([^/]+)";
    cursor = parameter.index + parameter.length;
  }
  pattern += `${escapeRegex(source.slice(cursor))}/?$`;
  // Case-insensitive to match path-to-regexp's sensitive: false default.
  compiled = { pattern: new RegExp(pattern, "i"), names };
  compiledSources.set(source, compiled);
  return compiled;
}

export function matchRuleSource(
  source: string,
  pathname: string,
): Record<string, string> | null {
  const { pattern, names } = compileSource(source);
  const matched = pattern.exec(pathname);
  if (!matched) return null;
  const values: Record<string, string> = {};
  names.forEach((name, index) => {
    const value = matched[index + 1] ?? "";
    try {
      values[name] = decodeURIComponent(value);
    } catch {
      values[name] = value;
    }
  });
  return values;
}

export interface RuleRequestContext {
  url: URL;
  headers: Headers;
  cookies: Record<string, string>;
}

function conditionValues(
  condition: RouteHas,
  context: RuleRequestContext,
): string[] {
  switch (condition.type) {
    case "header":
      return context.headers.has(condition.key)
        ? [context.headers.get(condition.key) ?? ""]
        : [];
    case "cookie":
      return condition.key in context.cookies
        ? [context.cookies[condition.key]]
        : [];
    case "query":
      return context.url.searchParams.getAll(condition.key);
    case "host":
      return [context.url.hostname];
    default:
      return [];
  }
}

function matchCondition(
  condition: RouteHas,
  context: RuleRequestContext,
  captured: Record<string, string>,
): boolean {
  const values = conditionValues(condition, context);
  if (condition.type === "host" && condition.value === undefined) {
    return false;
  }
  if (condition.value === undefined) return values.length > 0;

  let pattern: RegExp | null = null;
  try {
    pattern = new RegExp(`^(?:${condition.value})$`);
  } catch {
    pattern = null;
  }
  for (const value of values) {
    if (pattern) {
      const matched = pattern.exec(value);
      if (matched) {
        for (const [name, groupValue] of Object.entries(
          matched.groups ?? {},
        )) {
          if (groupValue !== undefined) captured[name] = groupValue;
        }
        return true;
      }
    } else if (value === condition.value) {
      return true;
    }
  }
  return false;
}

export function evaluateRuleConditions(
  rule: { has?: RouteHas[]; missing?: RouteHas[] },
  context: RuleRequestContext,
): Record<string, string> | null {
  const captured: Record<string, string> = {};
  for (const condition of rule.has ?? []) {
    if (!matchCondition(condition, context, captured)) return null;
  }
  for (const condition of rule.missing ?? []) {
    if (matchCondition(condition, context, {})) return null;
  }
  return captured;
}

export function substituteRuleParams(
  template: string,
  values: Record<string, string>,
  encode: (value: string) => string,
): string {
  return template.replace(
    /:([A-Za-z0-9_]+)/g,
    (token, name: string) =>
      name in values ? encode(values[name]) : token,
  );
}

export function consumedDestinationParams(destination: string): Set<string> {
  return new Set(
    [...destination.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]),
  );
}

export function isExternalDestination(destination: string): boolean {
  return /^https?:\/\//i.test(destination);
}

export function redirectStatusFor(rule: RedirectRule): number {
  if (typeof rule.statusCode === "number") return rule.statusCode;
  return rule.permanent === true ? 308 : 307;
}

export function matchRedirectRule(
  rules: RedirectRule[],
  pathname: string,
  context: RuleRequestContext,
): { rule: RedirectRule; location: URL } | null {
  for (const rule of rules) {
    const values = matchRuleSource(rule.source, pathname);
    if (!values) continue;
    const captured = evaluateRuleConditions(rule, context);
    if (!captured) continue;
    const merged = { ...values, ...captured };

    const external = isExternalDestination(rule.destination);
    const destination = substituteRuleParams(
      rule.destination,
      merged,
      external ? (value) => value : encodeURIComponent,
    );
    const location = new URL(destination, context.url);
    if (!external) {
      // Preserve the incoming query; destination-set parameters win.
      for (const [name, value] of context.url.searchParams) {
        if (!location.searchParams.has(name)) {
          location.searchParams.append(name, value);
        }
      }
    }
    return { rule, location };
  }
  return null;
}

export function matchHeaderRules(
  rules: HeaderRule[],
  pathname: string,
  context: RuleRequestContext,
): Array<{ key: string; value: string }> {
  const applied: Array<{ key: string; value: string }> = [];
  for (const rule of rules) {
    const values = matchRuleSource(rule.source, pathname);
    if (!values) continue;
    const captured = evaluateRuleConditions(rule, context);
    if (!captured) continue;
    const merged = { ...values, ...captured };
    for (const header of rule.headers) {
      applied.push({
        key: substituteRuleParams(header.key, merged, (value) => value),
        value: substituteRuleParams(header.value, merged, (value) => value),
      });
    }
  }
  return applied;
}
