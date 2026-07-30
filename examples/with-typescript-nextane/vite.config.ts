import { cloudflare } from "@cloudflare/vite-plugin";
import { octane } from "@octanejs/vite-plugin";
import { defineConfig } from "vite";
import { nextane } from "nextane";

export default defineConfig({
  plugins: [...octane(), nextane(), cloudflare()],
});
