import type { ParsedUrlQuery, Redirect } from "../types";

export interface NextaneEnvironment {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

export interface NextaneManifest {
  buildId?: string;
  routes: Array<{
    route: string;
    regexSource: string;
    params: unknown[];
    id: number;
    kind: "page" | "api";
    load(): Promise<Record<string, unknown>>;
  }>;
  loadApp: null | (() => Promise<Record<string, unknown>>);
  loadDocument: null | (() => Promise<Record<string, unknown>>);
  loadError: null | (() => Promise<Record<string, unknown>>);
  config?: {
    rewrites?: Array<{
      source: string;
      destination: string;
      has?: Array<{ type: string; key: string; value?: string }>;
      missing?: Array<{ type: string; key: string; value?: string }>;
      basePath?: false;
    }>;
    redirects?: Array<{
      source: string;
      destination: string;
      permanent?: boolean;
      statusCode?: number;
      has?: Array<{ type: string; key: string; value?: string }>;
      missing?: Array<{ type: string; key: string; value?: string }>;
      basePath?: false;
    }>;
    headers?: Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
      has?: Array<{ type: string; key: string; value?: string }>;
      missing?: Array<{ type: string; key: string; value?: string }>;
      basePath?: false;
    }>;
    crossOrigin?: string;
    trailingSlash?: boolean;
    basePath?: string;
  };
  preview?: {
    previewModeId: string;
    encryptionKey: string;
    signingKey: string;
  };
}

export interface RenderArtifact {
  buildId?: string;
  route: string;
  pageProps: Record<string, unknown>;
  appProps?: Record<string, unknown>;
  query: ParsedUrlQuery;
  gsp: boolean;
  gssp: boolean;
  isFallback?: boolean;
  resolvedPath?: string;
  revalidate?: number | boolean;
  notFound?: boolean;
  redirect?: Redirect;
  cacheable?: boolean;
  generatedAt: number;
  [key: string]: unknown;
}

export declare function cacheTagForPath(pathname: string): string;
export declare function createIsrArtifactHandler(
  manifest: NextaneManifest,
): (request: Request) => Promise<Response>;
export declare function createNextaneHandler(
  manifest: NextaneManifest,
  options?: {
    loadCachedArtifact?: (
      request: Request,
      route: NextaneManifest["routes"][number],
    ) => Promise<Response>;
    revalidatePath?: (
      pathname: string,
      options?: { unstable_onlyGenerated?: boolean },
    ) => Promise<boolean> | boolean;
  },
): (request: Request, env: NextaneEnvironment) => Promise<Response>;
