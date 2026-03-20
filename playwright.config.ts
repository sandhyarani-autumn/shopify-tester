import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 180000,
  retries: 0,         // ← Retry band karo — fail hone pe turant pata chale

  use: {
    headless: false,  // ← Browser screen pe dikhega
    slowMo:   800,    // ← Sab slowly hoga — clearly dikh sake
    video: 'on',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  reporter: [['list']],
});