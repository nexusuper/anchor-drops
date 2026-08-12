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

console.log('containers.test.mjs: all assertions passed');
