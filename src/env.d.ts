declare module "*.tsrx" {
  import type { ComponentBody } from "octane";

  const Component: ComponentBody<Record<string, unknown>>;
  export const DefaultNotFound: ComponentBody<Record<string, unknown>>;
  export const DefaultServerError: ComponentBody<Record<string, unknown>>;
  export default Component;
}

declare module "virtual:nextane-client-manifest" {
  import type { ClientRoute } from "./routing/types";

  export const routes: ClientRoute[];
  export const pageLoaders: Record<string, () => Promise<Record<string, unknown>>>;
  export const appLoader: null | (() => Promise<Record<string, unknown>>);
  export const errorLoader: null | (() => Promise<Record<string, unknown>>);
  export const basePath: string;
}

declare module "virtual:nextane-server-manifest" {
  export interface ServerRoute {
    route: string;
    regexSource: string;
    params: Array<{
      name: string;
      kind: "single" | "catchAll" | "optionalCatchAll";
    }>;
    id: number;
    kind: "page" | "api";
    load(): Promise<Record<string, unknown>>;
  }

  export const buildId: string;
  export const routes: ServerRoute[];
  export const loadApp: null | (() => Promise<Record<string, unknown>>);
  export const loadDocument: null | (() => Promise<Record<string, unknown>>);
  export const loadError: null | (() => Promise<Record<string, unknown>>);
  export interface RouteHas {
    type: "header" | "cookie" | "query" | "host";
    key: string;
    value?: string;
  }

  export interface RouteRule {
    source: string;
    has?: RouteHas[];
    missing?: RouteHas[];
    basePath?: false;
  }

  export const config: {
    rewrites: Array<RouteRule & { destination: string }>;
    redirects?: Array<
      RouteRule & {
        destination: string;
        permanent?: boolean;
        statusCode?: number;
      }
    >;
    headers?: Array<
      RouteRule & { headers: Array<{ key: string; value: string }> }
    >;
    crossOrigin?: string;
    trailingSlash?: boolean;
    basePath?: string;
    assetPrefix?: string;
  };
  export const preview: {
    previewModeId: string;
    encryptionKey: string;
    signingKey: string;
  };
}

interface Window {
  __NEXT_DATA__?: import("./types").NextaneData;
  __NEXT_HYDRATED?: boolean;
  __NEXT_HYDRATED_CB?: () => void;
  next: {
    router: import("./types").NextaneRouter;
  };
}

declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("../worker");
  }
}
