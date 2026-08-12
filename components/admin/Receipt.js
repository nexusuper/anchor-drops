// Printable receipt. Extracted verbatim from POSPanel's counter-sale receipt so
// delivery orders print the same slip. `receipt` is the POS sale shape; build it
// from a single order with orderToReceipt() below.
export default function Receipt({ receipt }) {
  return (
    <div className="clay-raised rounded-3xl p-6 print:shadow-none print:rounded-none" id="pos-receipt">
      <div className="text-center mb-4">
        <h2 className="text-xl font-bold text-clay-ink font-display">Anchor Drops</h2>
        <p className="text-xs text-clay-ink/60">{receipt.transaction_id} &middot; {new Date(receipt.created_at).toLocaleString()}</p>
      </div>
      <div className="text-sm text-clay-ink mb-3">
        <p><strong>{receipt.customer_name}</strong> &middot; {receipt.phone}</p>
        <p className="text-clay-ink/60 capitalize">{receipt.fulfillment_type === 'pickup' ? 'Counter pickup' : 'Delivery'}</p>
        {receipt.address && <p className="text-clay-ink/60">{receipt.address}{receipt.barangay ? `, ${receipt.barangay}` : ''}</p>}
      </div>
      <div className="border-t border-b border-clay-ink/10 py-3 mb-3 space-y-1">
        {receipt.lines.map((l) => (
          <div key={l.order_id} className="flex justify-between text-sm">
            <span>{l.product_name} &times; {l.quantity}{l.need_container ? ` (+${l.container_quantity} container)` : ''}</span>
            <span>₱{l.line_total.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between"><span>Subtotal</span><span>₱{receipt.subtotal.toFixed(2)}</span></div>
        {receipt.delivery_fee > 0 && <div className="flex justify-between"><span>Delivery fee</span><span>₱{receipt.delivery_fee.toFixed(2)}</span></div>}
        {receipt.voucher_discount_total > 0 && <div className="flex justify-between text-emerald-600"><span>Voucher discount ({receipt.voucher_count_total})</span><span>-₱{receipt.voucher_discount_total.toFixed(2)}</span></div>}
        <div className="flex justify-between font-bold text-base pt-1 border-t border-clay-ink/10"><span>Total</span><span>₱{receipt.total_amount.toFixed(2)}</span></div>
        <div className="flex justify-between text-clay-ink/60"><span>Payment</span><span className="capitalize">{receipt.payment_method}</span></div>
        {receipt.cash_tendered != null && (
          <>
            <div className="flex justify-between text-clay-ink/60"><span>Cash tendered</span><span>₱{Number(receipt.cash_tendered).toFixed(2)}</span></div>
            <div className="flex justify-between text-clay-ink/60"><span>Change due</span><span>₱{Number(receipt.change_due).toFixed(2)}</span></div>
          </>
        )}
      </div>
      {receipt.loyalty_available_after != null && (
        <p className="text-xs text-clay-ink/50 mt-4 text-center">Available vouchers after this sale: {receipt.loyalty_available_after}</p>
      )}
    </div>
  );
}

// One delivery order -> the POS receipt shape. The order row stores the final
// total and the discount, so the pre-discount subtotal is derived, not re-priced.
export function orderToReceipt(o) {
  const total = Number(o.total_amount) || 0;
  const discount = Number(o.voucher_discount) || 0;
  return {
    transaction_id: o.order_number || o.transaction_id || o.id,
    created_at: o.created_at,
    customer_name: o.customer_name,
    phone: o.phone,
    address: o.address,
    barangay: o.barangay,
    fulfillment_type: 'delivery',
    lines: [{
      order_id: o.id,
      product_name: o.product_type,
      quantity: o.quantity,
      need_container: !!o.need_container,
      container_quantity: o.container_quantity,
      line_total: total,
    }],
    // ponytail: delivery fee isn't stored separately on the order row, so it is
    // folded into the subtotal rather than guessed from the tier table.
    subtotal: total + discount,
    delivery_fee: 0,
    voucher_count_total: Number(o.voucher_count) || 0,
    voucher_discount_total: discount,
    total_amount: total,
    payment_method: o.payment_method,
    cash_tendered: o.cash_tendered ?? null,
    change_due: o.cash_tendered != null ? Math.max(0, Number(o.cash_tendered) - total) : null,
  };
}
