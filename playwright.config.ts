import { defineConfig } from '@playwright/test';

// Set DMAPS_CHROMIUM to use a pre-installed Chromium instead of Playwright's own download
// (e.g. DMAPS_CHROMIUM=/opt/pw-browsers/chromium in the build sandbox). Unset on a normal machine.
const executablePath = process.env.DMAPS_CHROMIUM || undefined;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'allow',
    launchOptions: { executablePath, args: ['--no-sandbox'] },
    trace: 'retain-on-failure',
  },
  // Production build + preview: the service worker only exists in the built app.
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
