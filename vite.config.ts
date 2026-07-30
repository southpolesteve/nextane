import { cloudflare } from "@cloudflare/vite-plugin";
import { octane } from "@octanejs/vite-plugin";
import { defineConfig } from "vite";
import { nextane } from "./src/plugin";

export default defineConfig({
  plugins: [...octane(), nextane(), cloudflare()],
  server: {
    watch: {
      ignored: [
        "**/benchmarks/**/.next/**",
        "**/benchmarks/**/dist/**",
        "**/benchmarks/**/results/**",
      ],
    },
  },
  build: {
    sourcemap: true,
  },
});
