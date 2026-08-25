import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: process.env.SMOKE_BASE_URL || 'https://www.anchordropscdo.com',
    trace: 'retain-on-failure',
  },
});
