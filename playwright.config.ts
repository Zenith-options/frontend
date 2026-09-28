import { defineConfig, devices } from "@playwright/test";

import { API_URLS } from "./e2e/urls";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled" } },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    video: process.env.RECORD ? "on" : "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec/ },
    { name: "iphone-13", use: { ...devices["iPhone 13"] }, testMatch: /mobile\.spec/ },
    { name: "pixel-7", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec/ },
  ],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_API_URL: API_URLS.paper,
      NEXT_PUBLIC_TESTNET_API_URL: API_URLS.testnet,
      NEXT_PUBLIC_MAINNET_API_URL: API_URLS.mainnet,
    },
  },
});
