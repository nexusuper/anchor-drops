import { expect, test } from '@playwright/test';

const bottle = {
  id: 'bottle_500',
  name: '500 mL Bottle',
  description: 'Purified water',
  size: '500 mL',
  refill: 11,
  container: 0,
  kind: 'bottle',
};
const vendo = {
  id: 'vendo_refill',
  name: 'Self-service Vendo',
  description: 'Available 24/7',
  refill: 20,
  kind: 'info',
};
const pack = {
  ...bottle,
  id: 'bottle_1l_pack',
  name: '1 L Bottle Pack (12 pieces)',
  size: '1 L × 12',
  refill: 180,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/ordering-status', (route) => route.fulfill({
    json: { enabled: true, products: [bottle, pack, vendo] },
  }));
});

test('storefront displays live prices and keeps vendo informational', async ({ page }) => {
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: bottle.name })).toBeVisible();
  await expect(page.getByText('₱11', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: vendo.name })).toBeVisible();
  await expect(page.locator('a[href="/order?product=vendo_refill"]')).toHaveCount(0);
});

test('bottle order lets the customer switch pickup to delivery', async ({ page }) => {
  await page.goto('/order?product=bottle_500');
  await expect(page.getByRole('radio', { name: 'Store pickup', exact: true })).toBeChecked();
  await expect(page.getByLabel('Street Address')).toHaveCount(0);
  await expect(page.getByLabel('Quantity (bottles)')).toHaveValue('1');
  await expect(page.getByText('Need a new round container?')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /Self-service Vendo/i })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Delivery', exact: true }).check();
  await expect(page.getByLabel('Street Address')).toBeVisible();
  await expect(page.getByText('Pin your delivery location (required)')).toBeVisible();
  await expect(page.getByLabel('Quantity (bottles)')).toHaveValue('1');
  await expect(page.getByText(/Do you have empty containers/i)).toHaveCount(0);
});

test('checkout asks the customer to confirm a changed bottle price', async ({ page }) => {
  const quote = (price) => ({
    lines: [{ sku: bottle.id, refill_price: price, container_price: 0 }],
    subtotal: price,
    delivery_fee: 0,
  });
  await page.route('**/api/order-quote', (route) => route.fulfill({ json: quote(11) }));
  let orderId;
  let submissions = 0;
  await page.route('**/api/orders', (route) => {
    const order = route.request().postDataJSON();
    expect(order).toMatchObject({ product_type: bottle.id, fulfillment: 'pickup', delivery_fee: 0, quantity: 1 });
    expect(order.address).toBeNull();
    expect(order.has_empty_containers).toBe(false);
    expect(order.reward_requested).toBe(0);
    submissions += 1;
    if (submissions === 1) {
      orderId = order.client_order_id;
      expect(order.total_amount).toBe(11);
      return route.fulfill({ status: 409, json: { error: 'The price changed.', quote: quote(12) } });
    }
    expect(order.client_order_id).toBe(orderId);
    expect(order.total_amount).toBe(12);
    return route.fulfill({ status: 201, json: { id: orderId } });
  });
  await page.route('**/api/orders/*', (route) => route.fulfill({
    json: { status: 'pending', quantity: 1, product_type: bottle.id, product_name: bottle.name, product_kind: 'bottle' },
  }));

  await page.goto('/order?product=bottle_500');
  await page.getByLabel(/full name/i).fill('Sample Customer');
  await page.getByLabel(/phone number/i).fill('09171234567');
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  await page.getByLabel('Store pickup date').fill(tomorrow);
  await page.getByLabel('Store pickup time').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Place Order →' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The price changed.' })).toBeVisible();
  expect(submissions).toBe(1);
  await page.getByRole('button', { name: 'Confirm New Total →' }).click();
  await expect(page).toHaveURL(/\/order\/confirmation/);
  expect(submissions).toBe(2);
});

test('pickup confirmation shows packs and pickup schedule', async ({ page }) => {
  await page.route('**/api/orders/*', (route) => route.fulfill({
    json: {
      status: 'pending', product_type: pack.id, product_name: pack.name, product_kind: 'bottle',
      fulfillment: 'pickup', quantity: 2, total_amount: 360, payment_method: 'cod',
      delivery_date: '2027-02-15', delivery_time: '08:00',
    },
  }));
  await page.goto('/order/confirmation?id=test');
  await expect(page.getByText(pack.name, { exact: true })).toBeVisible();
  await expect(page.getByText('2 packs', { exact: true })).toBeVisible();
  await expect(page.getByText('Cash at the store')).toBeVisible();
  await expect(page.getByText('Scheduled store pickup', { exact: true })).toBeVisible();
});
