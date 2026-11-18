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
const refill = {
  ...bottle,
  id: 'round5_pickup',
  name: 'Round Refill (Store Pickup)',
  size: '5-Gal',
  refill: 25,
  kind: 'refill',
  fulfillment: 'pickup',
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
  await expect(page.locator('[data-product-image="bottle_500"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: vendo.name })).toBeVisible();
  await expect(page.locator('[data-product-image="vendo_refill"]')).toBeVisible();
  await expect(page.locator('a[href="/order?product=vendo_refill"]')).toHaveCount(0);
});

test('late-loaded catalog content becomes visible on home and order pages', async ({ page }) => {
  await page.goto('/');
  const homePrice = page.getByRole('heading', { name: bottle.name }).locator('..');
  await homePrice.scrollIntoViewIfNeeded();
  await expect(homePrice.getByText('₱11', { exact: true })).toBeVisible();
  await expect(homePrice).toHaveCSS('opacity', '1');

  await page.goto('/order?product=bottle_500');
  await expect(page.locator('[data-product-image="bottle_500"]')).toBeVisible();
  const orderHeading = page.getByRole('heading', { name: 'Place Your Order.' });
  await expect(orderHeading).toBeVisible();
  await expect(orderHeading.locator('..')).toHaveCSS('opacity', '1');
});

test('saved mobile reorder reviews next-day refill schedule before submission', async ({ page }) => {
  const deliveryRefill = { ...refill, id: 'round5', name: 'Round Refill (Delivery)', fulfillment: 'delivery' };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('anchor-drops:identity', JSON.stringify({
    saved_at: Date.now(), customer_name: 'Sample Customer', phone: '09171234567',
    address: 'Villa Trinitas', barangay: 'Bugo', lat: null, lng: null,
    lastOrder: { product_type: 'round5', quantity: 2, fulfillment: 'delivery' },
  })));
  await page.route('**/api/ordering-status', (route) => route.fulfill({ json: { enabled: true, products: [deliveryRefill] } }));
  await page.route('**/api/order-quote', (route) => route.fulfill({ json: {
    lines: [{ sku: 'round5', refill_price: 25, container_price: 0 }], subtotal: 50, delivery_fee: 0,
  } }));
  await page.route('**/api/rewards?phone=*', (route) => route.fulfill({ json: { deliveredGallons: 3, available: 0 } }));
  let submitted;
  await page.route('**/api/orders', (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { id: submitted.client_order_id } });
  });
  await page.route('**/api/orders/*', (route) => route.fulfill({ json: { status: 'pending', product_type: 'round5' } }));

  await page.goto('/');
  await page.getByRole('link', { name: 'REORDER WATER' }).click();
  const review = await page.getByRole('link', { name: 'Review order' }).boundingBox();
  const messenger = await page.getByRole('link', { name: 'Chat with us on Messenger' }).boundingBox();
  if (review && messenger) expect(messenger.y + messenger.height <= review.y).toBe(true);
  await expect(page.getByRole('radio', { name: 'Round Refill (Delivery)' })).toBeChecked();
  await expect(page.getByLabel('Quantity (refills)')).toHaveValue('2');
  await expect(page.getByText('Villa Trinitas, Bugo', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('3 of 10 toward your next reward')).toBeVisible();
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await page.getByLabel('Empty-gallon pickup time').selectOption('16:30');
  await expect(page.getByText(/Late pickup: no 1–2 hour slot/)).toBeVisible();
  await page.getByRole('button', { name: 'Place Order →' }).click();
  await expect(page).toHaveURL(/\/order\/confirmation/);
  expect(submitted).toMatchObject({ product_type: 'round5', quantity: 2, has_empty_containers: true, deliveryTime: '08:00' });
});

test('changing saved phone removes previous customer details and reorder shortcut', async ({ page }) => {
  await page.goto('/order?product=bottle_500');
  await page.evaluate(() => localStorage.setItem('anchor-drops:identity', JSON.stringify({
    saved_at: Date.now(), customer_name: 'Previous Customer', phone: '09171234567',
    address: 'Villa Trinitas', barangay: 'Bugo', lat: null, lng: null,
    lastOrder: { product_type: 'bottle_500', quantity: 1, fulfillment: 'pickup' },
  })));
  await page.reload();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Phone Number').fill('09998887777');
  await expect(page.getByLabel('Full Name')).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('anchor-drops:identity'))).toBeNull();
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'REORDER WATER' })).toHaveCount(0);
});

test('late reward verification cannot restore a changed reward choice', async ({ page }) => {
  const alternateRefill = { ...refill, id: 'slim5_pickup', name: 'Slim Refill (Pickup)' };
  await page.route('**/api/ordering-status', (route) => route.fulfill({ json: { enabled: true, products: [refill, alternateRefill] } }));
  await page.route('**/api/order-quote', (route) => route.fulfill({ json: {
    lines: [{ sku: refill.id, refill_price: 25, container_price: 0 }], subtotal: 25, delivery_fee: 0,
  } }));
  await page.route('**/api/rewards?phone=*', (route) => route.fulfill({ json: { deliveredGallons: 10, available: 1 } }));
  await page.route('**/api/rewards/send-code', (route) => route.fulfill({ json: { sent: true } }));
  await page.route('**/api/rewards/verify-code', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ json: { valid: true, available: 1 } });
  });
  await page.goto('/order?product=round5_pickup');
  await page.getByLabel('Phone Number').fill('09171234567');
  await page.getByRole('button', { name: 'Use more' }).click();
  await page.getByRole('button', { name: 'Verify with a Messenger code' }).click();
  await page.getByPlaceholder('123456').fill('123456');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Use fewer' }).click();
  await page.waitForTimeout(600);
  await expect(page.getByText(/Code verified/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Use more' }).click();
  await page.getByRole('button', { name: 'Verify with a Messenger code' }).click();
  await page.getByPlaceholder('123456').fill('123456');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('radio', { name: 'Slim Refill (Pickup)' }).check();
  await page.getByRole('button', { name: 'Use more' }).click();
  await expect(page.getByRole('button', { name: 'Verify with a Messenger code' })).toBeVisible();
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

test('bottle delivery with a pending fee shows a subtotal and accepts cash only', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('anchor-drops:identity', JSON.stringify({
    saved_at: Date.now(), customer_name: 'Sample Customer', phone: '09171234567',
    address: 'Sample Street', barangay: 'Iponan', lat: 8.497, lng: 124.589,
    lastOrder: { product_type: 'bottle_500', quantity: 1, fulfillment: 'pickup' },
  })));
  const quote = {
    lines: [{ sku: bottle.id, refill_price: 11, container_price: 0 }],
    subtotal: 11, delivery_fee: 0, delivery_fee_pending: false,
  };
  let feeBecamePending = false;
  await page.route('**/api/order-quote', (route) => route.fulfill({ json: { ...quote, delivery_fee_pending: feeBecamePending } }));
  let submitted;
  await page.route('**/api/orders', (route) => {
    const order = route.request().postDataJSON();
    if (!order.expected_delivery_fee_pending) {
      feeBecamePending = true;
      return route.fulfill({ status: 409, json: {
        error: 'The delivery fee changed. Review the updated quote before placing your order.',
        quote: { ...quote, delivery_fee_pending: true },
      } });
    }
    submitted = order;
    return route.fulfill({ status: 201, json: { id: submitted.client_order_id } });
  });
  await page.route('**/api/orders/*', (route) => route.fulfill({ json: {
    status: 'pending', product_type: bottle.id, fulfillment: 'delivery', quantity: 1,
    phone: '09171234567', payment_method: 'cod', delivery_fee: 0, delivery_fee_pending: true, total_amount: 11,
  } }));

  await page.goto('/order?product=bottle_500');
  const gcash = page.getByRole('radio', { name: 'GCash / Bank Transfer' });
  await gcash.check();
  await expect(page.getByText('Amount to send')).toBeVisible();
  await page.getByText('Attach payment proof (optional)').click();
  await page.getByLabel('Payment screenshot').setInputFiles('public/products/bottle-500ml.webp');
  await expect(page.getByRole('img', { name: 'Payment screenshot' })).toBeVisible();
  await page.getByLabel('Reference Number (after payment)').fill('old-reference');
  await page.getByRole('radio', { name: 'Delivery', exact: true }).check();
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await page.getByLabel('Delivery time').selectOption('08:00');
  await page.getByRole('button', { name: 'Place Order →' }).click();
  await expect(gcash).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Cash on Delivery' })).toBeChecked();
  await expect(page.getByText('Amount to send')).toHaveCount(0);
  const summary = page.locator('#order-summary');
  await expect(summary.getByText('To be confirmed')).toBeVisible();
  await expect(summary.getByText('Free', { exact: true })).toHaveCount(0);
  await expect(summary.getByText('Subtotal before delivery')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review order' }).locator('..').getByText('Subtotal before delivery')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm Updated Quote →' }).click();
  await expect(page).toHaveURL(/\/order\/confirmation/);
  expect(submitted).toMatchObject({
    fulfillment: 'delivery', payment_method: 'cod', reference_number: '',
    expected_final_total: 11, expected_delivery_fee_pending: true,
  });
  await expect(page.getByText('To be confirmed')).toBeVisible();
  await expect(page.getByText('Subtotal before delivery')).toBeVisible();
  await expect(page.getByText('Free', { exact: true })).toHaveCount(0);
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

test('checkout requires confirmation when the verified refill discount changes', async ({ page }) => {
  const quote = {
    lines: [{ sku: refill.id, refill_price: 25, container_price: 0 }],
    subtotal: 25, delivery_fee: 0, voucher_value: 30,
  };
  await page.route('**/api/ordering-status', (route) => route.fulfill({
    json: { enabled: true, products: [refill] },
  }));
  await page.route('**/api/order-quote', (route) => route.fulfill({ json: quote }));
  await page.route('**/api/rewards?phone=*', (route) => route.fulfill({ json: {
    available: 1, deliveredGallons: 10, progressPct: 0, gallonsToNext: 10,
  } }));
  await page.route('**/api/rewards/send-code', (route) => route.fulfill({ json: { sent: true } }));
  await page.route('**/api/rewards/verify-code', (route) => route.fulfill({ json: { valid: true, available: 1 } }));
  await page.route('**/api/orders/*', (route) => route.fulfill({
    json: { status: 'pending', quantity: 1, product_type: refill.id, product_name: refill.name, product_kind: 'refill' },
  }));
  const totals = [];
  await page.route('**/api/orders', (route) => {
    const order = route.request().postDataJSON();
    totals.push(order.expected_final_total);
    if (totals.length === 1) {
      expect(order.reward_code).toBe('123456');
      return route.fulfill({ status: 409, json: {
        error: 'The reward discount changed.',
        quote,
        revised_reward: { voucher_discount: 0, voucher_count: 0, requires_manual_approval: true },
      } });
    }
    expect(order.reward_code).toBeNull();
    expect(order.reward_requested).toBe(1);
    return route.fulfill({ status: 201, json: { id: order.client_order_id } });
  });

  await page.goto('/order?product=round5_pickup');
  await page.getByLabel(/full name/i).fill('Sample Customer');
  await page.getByLabel(/phone number/i).fill('09171234567');
  await page.getByRole('button', { name: 'Use more' }).click();
  await page.getByRole('button', { name: 'Verify with a Messenger code' }).click();
  await page.getByPlaceholder('123456').fill('123456');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('Code verified. ₱25 off applied.')).toBeVisible();
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  await page.getByLabel('Store pickup date').fill(tomorrow);
  await page.getByLabel('Store pickup time').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Place Order →' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The reward discount changed.' })).toBeVisible();
  expect(totals).toEqual([0]);
  const summary = page.getByRole('heading', { name: 'Order Summary' }).locator('..');
  await expect(summary).toContainText('Total₱25');
  await expect(summary.getByText('−₱25')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm New Total →' }).click();
  await expect(page).toHaveURL(/\/order\/confirmation/);
  expect(totals).toEqual([0, 25]);
  await page.getByRole('link', { name: 'Check your rewards' }).click();
  await page.getByLabel('Your Phone Number').fill('09171234567');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('Free refills available')).toBeVisible();
  await expect(page.getByText('10 refills delivered all-time')).toBeVisible();
});
