import { fileURLToPath } from "node:url";

export default {
  poweredByHeader: false,
  experimental: {
    useTypeScriptCli: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: fileURLToPath(new URL("../", import.meta.url)),
  },
};
