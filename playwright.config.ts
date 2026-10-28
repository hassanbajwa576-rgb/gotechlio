import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const PORT = 3200;
const dataDir = path.join(os.tmpdir(), "gotechlio-e2e-db");

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, channel: "msedge", headless: true, trace: "retain-on-failure", screenshot: "only-on-failure" },
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { DATABASE_URL: `pglite://${dataDir}`, AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-12" },
  },
});
