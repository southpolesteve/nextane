import { octane } from "@octanejs/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: octane(),
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts"],
  },
});
