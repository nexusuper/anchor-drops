// Printable receipt, styled as the shop's paper sales-acknowledgment slip.
// `receipt` is the POS sale shape; build it from a single order with orderToReceipt() below.
export default function Receipt({ receipt }) {
  const orderDate = new Date(receipt.created_at);
  const dateStr = orderDate.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
  const addressLine = [receipt.address, receipt.barangay, 'CDO'].filter(Boolean).join(', ');
  const payment = (receipt.payment_method || '').toLowerCase();

  return (
    <div id="pos-receipt" className="bg-white text-black p-6 w-full max-w-[500px] mx-auto font-sans">
      <div className="flex items-center gap-3 border-b-2 border-black pb-3 mb-3">
        <img src="/anchor-drops-logo.jpg" alt="Anchor Drops" className="w-14 h-14 object-contain" />
        <div className="flex-1">
          <h1 className="text-2xl font-black leading-none">ANCHOR DROPS</h1>
          <p className="text-[10px] font-bold tracking-wide">WATER REFILLING STATION</p>
        </div>
        <div className="border border-black rounded px-2 py-1 text-xs font-semibold whitespace-nowrap">
          No. {receipt.transaction_id}
        </div>
      </div>

      <h2 className="text-center font-bold text-sm mb-3">SALES ACKNOWLEDGMENT / ORDER RECORD</h2>

      <div className="text-sm space-y-1 mb-3">
        <p><span className="font-semibold">Date:</span> {dateStr}</p>
        <p><span className="font-semibold">Customer Name:</span> {receipt.customer_name}</p>
        <p><span className="font-semibold">Address:</span> {receipt.fulfillment_type === 'pickup' ? 'Counter pickup' : addressLine}</p>
        <p><span className="font-semibold">Contact No.:</span> {receipt.phone}</p>
      </div>

      <table className="w-full text-sm border-collapse border border-black mb-3">
        <thead>
          <tr className="border border-black">
            <th className="border border-black px-2 py-1 w-14">QTY</th>
            <th className="border border-black px-2 py-1 text-left">ITEM / DESCRIPTION</th>
            <th className="border border-black px-2 py-1 w-16">PRICE</th>
            <th className="border border-black px-2 py-1 w-20">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((l) => (
            <tr key={l.order_id} className="border border-black">
              <td className="border border-black px-2 py-1 text-center">{l.quantity}</td>
              <td className="border border-black px-2 py-1">
                {l.product_name}{l.need_container ? ` (+${l.container_quantity} container)` : ''}
              </td>
              <td className="border border-black px-2 py-1 text-center">
                {(l.line_total / l.quantity).toFixed(0)}
              </td>
              <td className="border border-black px-2 py-1 text-center">{l.line_total.toFixed(0)}</td>
            </tr>
          ))}
          {receipt.delivery_fee > 0 && (
            <tr className="border border-black">
              <td className="border border-black px-2 py-1 text-center">1</td>
              <td className="border border-black px-2 py-1">Delivery fee</td>
              <td className="border border-black px-2 py-1 text-center">{receipt.delivery_fee.toFixed(0)}</td>
              <td className="border border-black px-2 py-1 text-center">{receipt.delivery_fee.toFixed(0)}</td>
            </tr>
          )}
          {receipt.voucher_discount_total > 0 && (
            <tr className="border border-black">
              <td className="border border-black px-2 py-1 text-center">{receipt.voucher_count_total}</td>
              <td className="border border-black px-2 py-1">Voucher discount</td>
              <td className="border border-black px-2 py-1 text-center">-</td>
              <td className="border border-black px-2 py-1 text-center">-{receipt.voucher_discount_total.toFixed(0)}</td>
            </tr>
          )}
          {/* Blank ruled rows to match the pad's fixed line count */}
          {Array.from({ length: Math.max(0, 4 - receipt.lines.length - (receipt.delivery_fee > 0 ? 1 : 0) - (receipt.voucher_discount_total > 0 ? 1 : 0)) }).map((_, i) => (
            <tr key={`blank-${i}`} className="border border-black h-7">
              <td className="border border-black" /><td className="border border-black" /><td className="border border-black" /><td className="border border-black" />
            </tr>
          ))}
          <tr className="border border-black">
            <td className="border border-black" colSpan={2} />
            <td className="border border-black px-2 py-1 text-right font-bold">TOTAL:</td>
            <td className="border border-black px-2 py-1 text-center font-bold">{receipt.total_amount.toFixed(0)}</td>
          </tr>
        </tbody>
      </table>

      <div className="text-sm mb-4 flex items-center gap-4">
        <span className="font-semibold">Payment Method:</span>
        <span>{payment === 'cod' ? '☑' : '☐'} Cash</span>
        <span>{payment === 'gcash' ? '☑' : '☐'} GCash</span>
        <span>{payment !== 'cod' && payment !== 'gcash' ? '☑' : '☐'} Other: {payment !== 'cod' && payment !== 'gcash' ? receipt.payment_method : ''}</span>
      </div>

      <p className="text-center font-bold mb-2">Thank you for choosing Anchor Drops!</p>
      <div className="text-center text-[11px] space-y-0.5">
        <p>Contact Us: 0975-855-5055</p>
        <p>Order Online: anchordropscdo.com</p>
        <p>Location: Phase 2b, Block 1 Lot 49, Villa Trinitas Subdivision, CDO City</p>
        <p>Fb Page: Anchor Drops Water Refilling Station</p>
      </div>
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

// Filename for the exported slip: AD-<order date, YYYY-MM-DD>.jpg
export function receiptFilename(receipt) {
  const d = new Date(receipt.created_at);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `AD-${yyyy}-${mm}-${dd}.jpg`;
}
