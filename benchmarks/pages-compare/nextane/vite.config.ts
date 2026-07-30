import { cloudflare } from "@cloudflare/vite-plugin";
import { octane } from "@octanejs/vite-plugin";
import { defineConfig } from "vite";
import { nextane } from "../../../src/plugin";

export default defineConfig({
  plugins: [...octane(), nextane(), cloudflare()],
  build: {
    sourcemap: false,
  },
});
