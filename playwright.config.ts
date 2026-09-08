import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  maxFailures: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:47831",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run dev -w server",
      url: "http://localhost:47832/api/auth/session",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -w client",
      url: "http://localhost:47831",
      reuseExistingServer: false,
    },
  ],
});
