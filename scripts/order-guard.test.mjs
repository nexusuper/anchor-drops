import assert from 'node:assert/strict';
import {
  firstOrderVerdict, isBulkFirstOrder, isPhoneBlocked, FIRST_ORDER_PREPAY_MIN_QTY as MIN,
} from '../lib/order-guard.js';

// trusted phone: never gated
assert.equal(firstOrderVerdict({ trusted: true, quantity: 50, paymentMethod: 'cod', hasScreenshot: false }).ok, true);
// untrusted, small order: allowed COD
assert.equal(firstOrderVerdict({ trusted: false, quantity: MIN - 1, paymentMethod: 'cod', hasScreenshot: false }).ok, true);
// untrusted bulk: COD refused, prepaid needs screenshot
assert.equal(firstOrderVerdict({ trusted: false, quantity: MIN, paymentMethod: 'cod', hasScreenshot: false }).ok, false);
assert.equal(firstOrderVerdict({ trusted: false, quantity: 7, paymentMethod: 'gcash', hasScreenshot: false }).ok, false);
assert.equal(firstOrderVerdict({ trusted: false, quantity: 7, paymentMethod: 'gcash', hasScreenshot: true }).ok, true);
assert.equal(isBulkFirstOrder(false, 7), true);
assert.equal(isBulkFirstOrder(true, 7), false);

// blocklist matches across +63 / 09 spellings, ignores empty/junk
const list = [{ phone: '09171234567' }];
assert.equal(isPhoneBlocked('+63 917 123 4567', list), true);
assert.equal(isPhoneBlocked('0917-123-4567', list), true);
assert.equal(isPhoneBlocked('09180000000', list), false);
assert.equal(isPhoneBlocked('aaaaaaa', list), false);
console.log('order-guard tests passed');
import { ORDER_REFUSED_MESSAGE } from '../lib/order-guard.js';
assert.equal(firstOrderVerdict({ trusted: false, quantity: 7, paymentMethod: 'cod', hasScreenshot: false }).error, ORDER_REFUSED_MESSAGE);
console.log('opaque-message test passed');
