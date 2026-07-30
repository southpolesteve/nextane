import {
  loadApp,
  loadDocument,
  loadError,
  routes,
} from "virtual:nextane-server-manifest";
import {
  createNextaneHandler,
  type NextaneEnvironment,
} from "../../../src/server/handler";

const handle = createNextaneHandler({
  routes,
  loadApp,
  loadDocument,
  loadError,
});

export default {
  fetch(request: Request, env: NextaneEnvironment) {
    return handle(request, env);
  },
};
