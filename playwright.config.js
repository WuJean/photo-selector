import { defineConfig } from "@playwright/test";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
    command: "node server/index.mjs",
    env: {
      PORT: "4174",
      PHOTO_SELECTOR_DATA_DIR: path.resolve(".local/e2e", randomUUID()),
    },
    url: "http://127.0.0.1:4174/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
