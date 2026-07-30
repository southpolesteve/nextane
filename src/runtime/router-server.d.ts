import type { RouterState } from "./router";

export declare function runWithServerRouterState<Result>(
  state: RouterState,
  callback: () => Result,
): Result;
