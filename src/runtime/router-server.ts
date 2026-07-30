import { AsyncLocalStorage } from "node:async_hooks";
import {
  configureServerRouterStateProvider,
  type RouterState,
} from "./router";

const routerStateStorage = new AsyncLocalStorage<RouterState>();

configureServerRouterStateProvider(() => routerStateStorage.getStore());

export function runWithServerRouterState<Result>(
  state: RouterState,
  callback: () => Result,
): Result {
  return routerStateStorage.run(state, callback);
}
