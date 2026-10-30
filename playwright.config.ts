import { defineConfig, devices } from '@playwright/test';
import { env } from './config/env';

console.log(`▶ Running against TEST_ENV="${env.name}" (client: ${env.client.baseUrl})`);

export default defineConfig({
  testDir: './tests',
  workers: 1,

  // Persistent HTML report (regenerated every run) at playwright-report/,
  // open it with `npm run report`. `open: 'never'` so headed/background
  // runs don't spawn a browser tab on completion. `list` keeps the live
  // terminal output.
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  // A retry re-runs a test from scratch — for flows that create real
  // records (a magazine, a project, a job) that means duplicate data on
  // every crash. Retry manually (targeting the same record) instead of
  // automatically, same reasoning as the Image Retouching framework.
  retries: 0,

  use: {
    headless: false,
    // Default fixed 1280x720 viewport renders noticeably smaller/squeezed
    // than a real window — launch maximized with the OS-reported window
    // size instead (viewport: null defers sizing to the actual window).
    viewport: null,
    launchOptions: {
      args: ['--start-maximized'],
    },
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      // devices['Desktop Chrome'] carries its own fixed viewport and a
      // deviceScaleFactor, and Playwright rejects deviceScaleFactor
      // combined with a null viewport — clear both so the window's real
      // (maximized) size is used instead.
      use: { ...devices['Desktop Chrome'], viewport: null, deviceScaleFactor: undefined },
    },
  ],
});
