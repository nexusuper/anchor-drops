import assert from 'node:assert/strict';
import { recordContainerMove } from '../lib/containers.js';

// Minimal stand-in for the supabase client: records the row that would be
// inserted, and answers the customers lookup with a fixed id.
function fakeSupabase(inserted) {
  return {
    from(table) {
      if (table === 'customers') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'cust-1' } }) }) }) };
      }
      assert.equal(table, 'container_ledger');
      return { insert: async (row) => { inserted.push(row); return { error: null }; } };
    },
  };
}

// delivery_out: positive delta, customer resolved from the phone.
{
  const rows = [];
  await recordContainerMove(fakeSupabase(rows), {
    phone: '0917-123-4567', orderId: 'o1', delta: 2, kind: 'delivery_out', note: 'x',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].delta, 2);
  assert.equal(rows[0].kind, 'delivery_out');
  assert.equal(rows[0].phone_normalized, '09171234567');
  assert.equal(rows[0].customer_id, 'cust-1');
  assert.equal(rows[0].order_id, 'o1');
}

// pickup_return: negative delta is preserved (a return must reduce the balance).
{
  const rows = [];
  await recordContainerMove(fakeSupabase(rows), {
    phone: '09171234567', customerId: 'cust-9', delta: -3, kind: 'pickup_return',
  });
  assert.equal(rows[0].delta, -3);
  assert.equal(rows[0].customer_id, 'cust-9');
  assert.equal(rows[0].order_id, null);
}

// Zero / missing quantity writes nothing — an order with need_container but no
// quantity must not create a meaningless ledger row.
{
  const rows = [];
  await recordContainerMove(fakeSupabase(rows), { phone: '09171234567', delta: 0, kind: 'delivery_out' });
  await recordContainerMove(fakeSupabase(rows), { phone: '09171234567', delta: undefined, kind: 'delivery_out' });
  assert.equal(rows.length, 0);
}

// No double-count: place an order, then deliver it => exactly ONE delivery_out.
// create_order used to insert its own 'order placed' row (removed in migration
// 0029), which made every container order book twice. Placement is modelled
// here as what it now is: a no-op on the ledger.
{
  const rows = [];
  const db = fakeSupabase(rows);
  // 1. order placed — create_order writes nothing to the ledger.
  // 2. PATCH to delivered — pages/api/orders/[id].js records the booking.
  await recordContainerMove(db, {
    phone: '09171234567', customerId: 'cust-1', orderId: 'o2', delta: 2,
    kind: 'delivery_out', note: 'order o2 delivered',
  });
  const out = rows.filter((r) => r.order_id === 'o2' && r.kind === 'delivery_out');
  assert.equal(out.length, 1);
  assert.equal(out.reduce((s, r) => s + r.delta, 0), 2);

  // 3. cancelled after delivery — reversal nets the balance back to zero.
  await recordContainerMove(db, {
    phone: '09171234567', customerId: 'cust-1', orderId: 'o2', delta: -2,
    kind: 'adjustment', note: 'order o2 cancelled after delivery',
  });
  assert.equal(rows.reduce((s, r) => s + r.delta, 0), 0);
}

console.log('containers.test.mjs: all assertions passed');
