import { defineConfig, devices } from "@playwright/test";
const remote = process.env.E2E_BASE_URL;
const mock = process.env.E2E_USE_MOCK_AUTH === "1";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: remote || "http://127.0.0.1:3101",
    trace: remote ? "off" : "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: remote
    ? undefined
    : [
        ...(mock
          ? [
              {
                command: "node tests/fixtures/auth-server.cjs",
                url: "http://127.0.0.1:3102",
                reuseExistingServer: false,
              },
            ]
          : []),
        {
          command: "npm run start -- -p 3101",
          env: {
            NEXT_DIST_DIR: ".next-test",
            ...(mock
              ? {
                  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:3102",
                  NEXT_PUBLIC_SUPABASE_ANON_KEY: "offline-test-anon-key",
                }
              : {}),
          },
          url: "http://127.0.0.1:3101",
          reuseExistingServer: false,
          timeout: 30000,
        },
      ],
});
