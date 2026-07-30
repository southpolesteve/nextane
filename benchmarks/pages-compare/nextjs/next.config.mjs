import { fileURLToPath } from "node:url";

export default {
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: fileURLToPath(new URL("../", import.meta.url)),
  },
};
