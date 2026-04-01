import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 180000,
  retries: 1,         // ← Retry 1 allow karna zaroori hai flaky network issues se bachne ke liye

  use: {
    headless: true,   // ← GitHub cloud runner ke liye isko TRUE hona zaroori hai (Display Error bachane ke liye)
    // slowMo hata diya gaya hai taaki test time out na ho! (Speed fast rahegi)
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  // ← JSON Reporter Zaroori hai, taaki 'notify-slack.js' error list ko padh (read) sake
  reporter: [
    ['list'],
    ['json', { outputFile: 'results.json' }] 
  ],
});