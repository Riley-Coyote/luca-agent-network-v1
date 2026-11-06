import { defineConfig, devices } from "@playwright/test";

// Match the focused browser suite: use an already-running threaded server when
// the coordinator supplies a port; never start a second server over that dist.
const port = process.env.LUCA_PLAYWRIGHT_PORT ?? "4173";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
  throw new Error("LUCA_PLAYWRIGHT_PORT must be a valid port number");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [
    {
      name: "perf",
      testMatch: ["**/*.perf.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.LUCA_PLAYWRIGHT_PORT
    ? undefined
    : {
        command: `python3 -m http.server ${port} -d dist`,
        cwd: ".",
        reuseExistingServer: true,
        url: `http://127.0.0.1:${port}`,
      },
});
