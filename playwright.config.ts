import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.ts',
  outputDir: 'temp/e2e-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:32106',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node --import tsx src/server.ts',
    url: 'http://127.0.0.1:32106/readyz',
    reuseExistingServer: false,
    env: {
      HOST: '127.0.0.1',
      PORT: '32106',
      VITEST: '1',
      TACTICAL_GAME_STATE_FILE: '',
      TACTICAL_GAME_TOKEN_PEPPER: 'isolated-browser-tests',
      AUTO_CONTROL_TOKEN: 'isolated-browser-control',
      TRUST_PROXY: 'false',
    },
  },
});
