import type { ClientRoute, RouteParam } from "./types";
import type { ParsedUrlQuery } from "../types";

export interface MatchedRoute<Route extends ClientRoute = ClientRoute> {
  route: Route;
  params: ParsedUrlQuery;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function paramsFromMatch(match: RegExpExecArray, params: RouteParam[]): ParsedUrlQuery {
  const query: ParsedUrlQuery = {};
  for (let index = 0; index < params.length; index += 1) {
    const definition = params[index];
    const value = match[index + 1];
    if (value === undefined) continue;
    query[definition.name] =
      definition.kind === "single" ? decode(value) : value.split("/").map(decode);
  }
  return query;
}

export function matchRoute<Route extends ClientRoute>(
  routes: readonly Route[],
  pathname: string,
): MatchedRoute<Route> | null {
  const normalized = pathname !== "/" ? pathname.replace(/\/+$/, "") : pathname;
  for (const route of routes) {
    const match = new RegExp(route.regexSource).exec(normalized);
    if (match) {
      return { route, params: paramsFromMatch(match, route.params) };
    }
  }
  return null;
}
