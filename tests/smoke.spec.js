import { test, expect } from '@playwright/test';

test('landing page loads and shows the brand', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Anchor Drops/i);
});

test('canonical points at the real domain', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(href).toContain('anchordropscdo.com');
  expect(href).not.toContain('vercel.app');
});

test('og:image points at the real domain and resolves', async ({ page, request }) => {
  await page.goto('/');
  const src = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(src).toContain('anchordropscdo.com');
  const res = await request.get(src);
  expect(res.status()).toBe(200);
});

test('order form renders its required fields', async ({ page }) => {
  await page.goto('/order');
  await expect(page.locator('input[name="phone"], input[type="tel"]').first()).toBeVisible();
});

test('track page loads', async ({ page }) => {
  await page.goto('/track');
  await expect(page.locator('body')).toContainText(/track/i);
});

test('products page lists at least one product', async ({ page }) => {
  await page.goto('/products');
  await expect(page.locator('body')).not.toContainText(/no products/i);
});
