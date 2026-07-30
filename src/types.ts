export type ParsedUrlQuery = Record<string, string | string[] | undefined>;
export type SizeLimit =
  | number
  | `${number}`
  | `${number}${"b" | "B" | "kb" | "KB" | "mb" | "MB" | "gb" | "GB"}`;

export interface PageConfig {
  api?: {
    bodyParser?:
      | {
          sizeLimit?: SizeLimit;
        }
      | false;
  };
  runtime?: "nodejs" | "edge" | "experimental-edge";
}

export interface NextaneRequest {
  readonly method?: string;
  readonly url: string;
  readonly headers: Headers & Record<string, string | string[] | undefined>;
  readonly cookies: Record<string, string>;
  readonly raw: Request;
}

export interface NextaneServerResponse {
  statusCode: number;
  statusMessage?: string;
  readonly headersSent: boolean;
  readonly finished: boolean;
  setHeader(name: string, value: string | string[]): NextaneServerResponse;
  getHeader(name: string): string | null;
  getHeaders(): Record<string, string>;
  hasHeader(name: string): boolean;
  removeHeader(name: string): void;
  writeHead(
    statusCode: number,
    statusMessageOrHeaders?: string | Record<string, string | string[]>,
    headers?: Record<string, string | string[]>,
  ): NextaneServerResponse;
  write(data: string | Uint8Array): boolean;
  end(data?: string | Uint8Array): void;
}

export interface Redirect {
  destination: string;
  permanent?: boolean;
  statusCode?: 301 | 302 | 303 | 307 | 308;
}

export interface GetServerSidePropsContext {
  req: NextaneRequest;
  res: NextaneServerResponse;
  params?: ParsedUrlQuery;
  query: ParsedUrlQuery;
  resolvedUrl: string;
  preview?: boolean;
  previewData?: unknown;
  draftMode?: boolean;
  locale?: string;
  locales?: string[];
  defaultLocale?: string;
}

export type GetServerSidePropsResult<Props extends Record<string, unknown>> =
  | { props: Props | Promise<Props>; notFound?: false }
  | { redirect: Redirect }
  | { notFound: true };

export type GetServerSideProps<Props extends Record<string, unknown> = Record<string, unknown>> = (
  context: GetServerSidePropsContext,
) => GetServerSidePropsResult<Props> | Promise<GetServerSidePropsResult<Props>>;

export interface GetStaticPropsContext {
  params?: ParsedUrlQuery;
  preview?: boolean;
  previewData?: unknown;
  revalidateReason?: "build" | "stale" | "on-demand";
}

export interface GetStaticPathsContext {
  locales?: string[];
  defaultLocale?: string;
}

export type GetStaticPathsResult = {
  paths: Array<
    | string
    | {
        params: ParsedUrlQuery;
        locale?: string;
      }
  >;
  fallback: boolean | "blocking";
};

export type GetStaticPaths = (
  context: GetStaticPathsContext,
) => GetStaticPathsResult | Promise<GetStaticPathsResult>;

export type GetStaticPropsResult<Props extends Record<string, unknown>> =
  | {
      props: Props | Promise<Props>;
      revalidate?: number | boolean;
      notFound?: false;
    }
  | { redirect: Redirect; revalidate?: number | boolean }
  | { notFound: true; revalidate?: number | boolean };

export type GetStaticProps<Props extends Record<string, unknown> = Record<string, unknown>> = (
  context: GetStaticPropsContext,
) => GetStaticPropsResult<Props> | Promise<GetStaticPropsResult<Props>>;

export interface NextaneData {
  props: {
    pageProps: Record<string, unknown>;
    [key: string]: unknown;
  };
  page: string;
  query: ParsedUrlQuery;
  buildId: string;
  isFallback: boolean;
  resolvedPath?: string;
  gsp?: boolean;
  gssp?: boolean;
  customServer?: boolean;
  err?: { name: string; message: string; stack?: string };
  trailingSlash?: boolean;
}

export interface NextaneRouter {
  route: string;
  pathname: string;
  query: ParsedUrlQuery;
  asPath: string;
  basePath: string;
  isReady: boolean;
  isPreview: boolean;
  isFallback: boolean;
  push(url: UrlObject | string, as?: UrlObject | string, options?: TransitionOptions): Promise<boolean>;
  replace(url: UrlObject | string, as?: UrlObject | string, options?: TransitionOptions): Promise<boolean>;
  prefetch(url: UrlObject | string): Promise<void>;
  back(): void;
  reload(): void;
}

export interface UrlObject {
  pathname?: string;
  query?: Record<string, string | number | boolean | Array<string | number | boolean> | undefined>;
  hash?: string;
}

export interface TransitionOptions {
  shallow?: boolean;
  scroll?: boolean;
  locale?: string | false;
}

export interface NextApiRequest {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Headers;
  query: ParsedUrlQuery;
  readonly cookies: Record<string, string>;
  readonly body: unknown;
  readonly raw: Request;
  readonly nextUrl: URL;
}

export interface NextApiResponse<Data = unknown> {
  statusCode: number;
  statusMessage?: string;
  readonly headersSent: boolean;
  readonly writableEnded: boolean;
  status(code: number): NextApiResponse<Data>;
  json(data: Data): void;
  send(data: Data | string | Uint8Array): void;
  setHeader(name: string, value: string | string[]): NextApiResponse<Data>;
  getHeader(name: string): string | null;
  getHeaders(): Record<string, string>;
  hasHeader(name: string): boolean;
  removeHeader(name: string): void;
  writeHead(
    statusCode: number,
    statusMessageOrHeaders?: string | Record<string, string | string[]>,
    headers?: Record<string, string | string[]>,
  ): NextApiResponse<Data>;
  write(data: string | Uint8Array): boolean;
  redirect(statusOrUrl: number | string, url?: string): void;
  setPreviewData(data: unknown): NextApiResponse<Data>;
  revalidate(
    pathname: string,
    options?: { unstable_onlyGenerated?: boolean },
  ): Promise<void>;
  end(data?: string | Uint8Array): void;
}
