import { defineConfig } from "@playwright/test";

const liveBaseUrl = process.env.NEXTANE_BASE_URL;

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: true,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: liveBaseUrl ?? "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  webServer: liveBaseUrl
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
