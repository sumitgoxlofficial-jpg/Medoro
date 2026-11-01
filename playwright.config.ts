import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite. Runs against a production build (`next build` + `next start`) on one database,
 * so tests run serially. The "setup" project drives the real first-run wizard once and saves the
 * owner's signed-in state; every other spec depends on it. Use ../wsl-e2e.sh to run it on the VM.
 */
const PORT = Number(process.env.E2E_PORT ?? 3310);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
    actionTimeout: 15_000,
    // Use a browser that's already installed (e.g. a CI image) instead of Playwright's download.
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "setup", testMatch: /setup\.e2e\.ts$/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "app",
      testMatch: /\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/owner.json" },
    },
    // Website screenshots (e2e/screenshots.capture.ts), only with CAPTURE=1.
    ...(process.env.CAPTURE ? [{
      name: "capture",
      testMatch: /\.capture\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/owner.json" },
    }] : []),
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `node node_modules/next/dist/bin/next start -p ${PORT}`,
    url: `${baseURL}/legal`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
