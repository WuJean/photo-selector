import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "test/browser",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:4174",
    viewport: { width: 1512, height: 982 },
    headless: true,
    channel: process.env.CI ? undefined : "chrome",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "PORT=4174 PHOTO_SELECTOR_DATA_DIR=.local/e2e node server/index.mjs",
    url: "http://127.0.0.1:4174/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
