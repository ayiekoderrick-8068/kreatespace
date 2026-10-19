import { defineConfig, devices } from "@playwright/test";
import {
  API_PORT,
  API_URL,
  DATABASE_URL,
  JWT_SECRET,
  SUPABASE_URL,
  STORAGE_BUCKET,
  WEB_PORT,
  WEB_URL,
} from "./support/env.ts";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./support/global-setup.ts",
  // The journeys share one database, so they run one after another.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "android-phone", use: { ...devices["Pixel 5"] } },
    { name: "iphone", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "pnpm exec tsx server/api.ts",
      url: `${API_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DATABASE_URL, E2E_JWT_SECRET: JWT_SECRET, PORT: String(API_PORT) },
    },
    {
      command: `pnpm --dir ../apps/web exec vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        VITE_SUPABASE_URL: SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY: "e2e-anon-key",
        VITE_SUPABASE_STORAGE_BUCKET: STORAGE_BUCKET,
        API_PROXY_TARGET: API_URL,
      },
    },
  ],
});
