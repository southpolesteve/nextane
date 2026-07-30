import type {
  NextaneRouter,
  TransitionOptions,
  UrlObject,
} from "../types";

type RouterEventHandler = (...args: unknown[]) => void;

export interface RouterState {
  route: string;
  pathname: string;
  query: import("../types").ParsedUrlQuery;
  asPath: string;
  basePath: string;
  isReady: boolean;
  isPreview: boolean;
  isFallback: boolean;
  trailingSlash?: boolean;
}

export declare const events: {
  on(event: string, handler: RouterEventHandler): void;
  off(event: string, handler: RouterEventHandler): void;
  emit(event: string, ...args: unknown[]): void;
};
export declare function formatRouterHref(value: UrlObject | string): string;
export declare function setRouterState(nextState: RouterState): void;
/** @internal */
export declare function configureServerRouterStateProvider(
  provider: () => RouterState | undefined,
): void;
export declare function configureClientRouter(options: {
  navigate(
    url: string,
    mode: "push" | "replace",
    options?: TransitionOptions,
    sourceUrl?: string,
  ): Promise<boolean>;
  prefetch(url: string): Promise<void>;
}): void;
export declare function useRouter(): NextaneRouter;
export declare function withRouter<Props extends Record<string, unknown>>(
  Component: (props: Props & { router: NextaneRouter }) => unknown,
): (props: Props) => unknown;

declare const Router: NextaneRouter & {
  events: typeof events;
  onRouteChangeComplete: RouterEventHandler | null;
};

export default Router;
