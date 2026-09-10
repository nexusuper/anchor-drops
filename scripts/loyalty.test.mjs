import assert from 'node:assert/strict';
import {
  GALLONS_BY_SIZE, VOUCHER_VALUE, GALLONS_PER_VOUCHER,
  normalizePhone, gallonsForOrder, computeRewards, maxRedeemable,
} from '../lib/loyalty.js';

// constants
assert.equal(VOUCHER_VALUE, 30);
assert.equal(GALLONS_PER_VOUCHER, 10);
assert.equal(GALLONS_BY_SIZE['5-Gal'], 1);
assert.equal(GALLONS_BY_SIZE['3-Gal'], 1);

// normalizePhone
assert.equal(normalizePhone('0917-123 4567'), '09171234567');
assert.equal(normalizePhone(''), '');
assert.equal(normalizePhone(null), '');

// gallonsForOrder: one point per container refilled, not per literal gallon
assert.equal(gallonsForOrder({ container_size: '5-Gal', quantity: 2 }), 2);
assert.equal(gallonsForOrder({ container_size: '3-Gal', quantity: 1 }), 1);
assert.equal(gallonsForOrder({ container_size: 'weird', quantity: 5 }), 0);

// computeRewards: empty
assert.deepEqual(computeRewards([]), {
  deliveredGallons: 0, earned: 0, redeemed: 0, available: 0,
  gallonsToNext: 10, progressPct: 0,
});

// computeRewards: the reported bug — 3 delivered 5-gal refills earn nothing
let r = computeRewards([{ status: 'delivered', container_size: '5-Gal', quantity: 3, voucher_count: 0 }]);
assert.equal(r.deliveredGallons, 3);
assert.equal(r.earned, 0);
assert.equal(r.available, 0);
assert.equal(r.gallonsToNext, 7);

// computeRewards: 10 single-refill orders → 1 earned, bar resets, next is 10 away
r = computeRewards(Array.from({ length: 10 }, () => ({ status: 'delivered', container_size: '5-Gal', quantity: 1, voucher_count: 0 })));
assert.equal(r.deliveredGallons, 10);
assert.equal(r.earned, 1);
assert.equal(r.available, 1);
assert.equal(r.gallonsToNext, 10);
assert.equal(r.progressPct, 0);

// computeRewards: 5 delivered refills → halfway, none earned
r = computeRewards([{ status: 'delivered', container_size: '5-Gal', quantity: 5, voucher_count: 0 }]);
assert.equal(r.earned, 0);
assert.equal(r.gallonsToNext, 5);
assert.equal(r.progressPct, 0.5);

// pending order does NOT accrue; cancelled redemption does NOT count
r = computeRewards([
  { status: 'delivered', container_size: '5-Gal', quantity: 20, voucher_count: 0 }, // 20 refills → earned 2
  { status: 'pending',   container_size: '5-Gal', quantity: 4, voucher_count: 0 },  // ignored for accrual
  { status: 'cancelled', container_size: '5-Gal', quantity: 1, voucher_count: 1 },  // redemption ignored
  { status: 'confirmed', container_size: '5-Gal', quantity: 1, voucher_count: 1 },  // redemption counts
]);
assert.equal(r.deliveredGallons, 20);
assert.equal(r.earned, 2);
assert.equal(r.redeemed, 1);
assert.equal(r.available, 1);

// maxRedeemable: capped by available and quantity — one voucher buys one refill
assert.equal(maxRedeemable({ available: 3, quantity: 2, refillSubtotal: 60 }), 2);
assert.equal(maxRedeemable({ available: 3, quantity: 5, refillSubtotal: 60 }), 3);
// A single ₱25 store-pickup refill is redeemable even though 25 < VOUCHER_VALUE.
assert.equal(maxRedeemable({ available: 1, quantity: 1, refillSubtotal: 25 }), 1);
assert.equal(maxRedeemable({ available: 0, quantity: 5, refillSubtotal: 90 }), 0);
// Nothing to discount, nothing to redeem.
assert.equal(maxRedeemable({ available: 3, quantity: 5, refillSubtotal: 0 }), 0);

console.log('loyalty.test.mjs: all assertions passed');
