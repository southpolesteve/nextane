export type RouteParamKind = "single" | "catchAll" | "optionalCatchAll";

export interface RouteParam {
  name: string;
  kind: RouteParamKind;
}

export interface ScannedRoute {
  kind: "page" | "api";
  route: string;
  filePath: string;
  regexSource: string;
  params: RouteParam[];
  score: number[];
}

export interface ClientRoute {
  route: string;
  regexSource: string;
  params: RouteParam[];
}
