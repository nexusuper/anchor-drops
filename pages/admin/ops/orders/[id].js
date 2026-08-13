import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import OpsShell from '@/components/admin/OpsShell';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

// Web port of app/(app)/orders/[id].tsx — status changes, payment-verified
// toggle, apply-reward, Messenger message. `create_order`/`apply_order_reward`
// stay server-authoritative for money; this page never computes a total.
const STATUS_LABELS = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  out_for_delivery: 'On the Way',
  delivered: 'Done',
  cancelled: 'Cancelled',
};
const STATUS_BADGE = {
  pending: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-sky-100 text-sky-700',
  out_for_delivery: 'bg-violet-100 text-violet-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};
const STATUS_BTN_VARIANT = {
  confirmed: 'primary',
  out_for_delivery: 'outline',
  delivered: 'primary',
  cancelled: 'outline',
};

function nextStatuses(current) {
  switch (current) {
    case 'pending':
      return ['confirmed', 'cancelled'];
    case 'confirmed':
      return ['out_for_delivery', 'cancelled'];
    case 'out_for_delivery':
      return ['delivered', 'cancelled'];
    default:
      return [];
  }
}

function orderCode(id) {
  return `ORD-${id.slice(0, 4).toUpperCase()}`;
}

function Row({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between gap-3 text-sm py-1">
      <span className="text-clay-muted">{label}</span>
      <span className="text-clay-ink font-medium text-right">{String(value)}</span>
    </div>
  );
}

export default function OpsOrderDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [rewardBusy, setRewardBusy] = useState(false);
  const [messengerBusy, setMessengerBusy] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState(null);
  const [screenshotError, setScreenshotError] = useState(false);

  async function loadOrder() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowser();
      const { data, error: err } = await supabase.from('orders').select('*').eq('id', id).single();
      if (err) throw err;
      setOrder(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => loadOrder());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Payment screenshot lives in Storage, not the row — resolve a short-lived
  // signed URL. Bucket may not exist yet; fail quietly.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setScreenshotUrl(null);
      setScreenshotError(false);
      if (!order?.payment_screenshot_path) return;
      getSupabaseBrowser()
        .storage.from('payment-screenshots')
        .createSignedUrl(order.payment_screenshot_path, 300)
        .then(({ data, error: storageError }) => {
          if (cancelled) return;
          if (storageError || !data?.signedUrl) {
            setScreenshotError(true);
            return;
          }
          setScreenshotUrl(data.signedUrl);
        })
        .catch(() => !cancelled && setScreenshotError(true));
    });
    return () => {
      cancelled = true;
    };
  }, [order?.payment_screenshot_path]);

  async function handleStatusChange(s) {
    setStatusBusy(true);
    setStatusError(null);
    try {
      const supabase = getSupabaseBrowser();
      const { data, error: err } = await supabase.from('orders').update({ status: s }).eq('id', id).select().single();
      if (err) throw err;

      // Mirrors the app: cancelling an order that had containers out reverses
      // the container_ledger entry so container_balances doesn't stay overstated.
      if (s === 'cancelled' && data.need_container && data.container_quantity > 0) {
        const { error: ledgerErr } = await supabase.from('container_ledger').insert({
          branch_id: data.branch_id,
          customer_id: data.customer_id,
          order_id: data.id,
          delta: data.container_quantity,
          kind: 'adjustment',
          note: 'order cancelled, reversing container_out',
        });
        if (ledgerErr) throw ledgerErr;
      }
      setOrder(data);
    } catch (e) {
      setStatusError(e.message);
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleVerifiedChange(v) {
    setVerifyBusy(true);
    try {
      const supabase = getSupabaseBrowser();
      const { data, error: err } = await supabase.from('orders').update({ payment_verified: v }).eq('id', id).select().single();
      if (err) throw err;
      setOrder(data);
    } catch (e) {
      alert(e.message);
    } finally {
      setVerifyBusy(false);
    }
  }

  async function handleApplyReward(requested) {
    if (!confirm(`Redeem this customer's earned voucher(s) on this order? The server caps by their available balance (up to ${requested} requested).`)) return;
    setRewardBusy(true);
    try {
      const supabase = getSupabaseBrowser();
      const { data, error: err } = await supabase.rpc('apply_order_reward', { p_order_id: id, p_voucher_count: null });
      if (err) throw err;
      const applied = Array.isArray(data) ? data[0]?.applied ?? 0 : 0;
      alert(applied > 0 ? `${applied} voucher(s) applied — total updated.` : "The customer had no available voucher balance; the request was cleared.");
      await loadOrder();
    } catch (e) {
      alert('Could not apply reward: ' + e.message);
    } finally {
      setRewardBusy(false);
    }
  }

  async function handleSendMessenger() {
    setMessengerBusy(true);
    try {
      const supabase = getSupabaseBrowser();
      const { data, error: err } = await supabase.functions.invoke('send-messenger', { body: { order_id: id } });
      if (err) throw err;
      if (data?.skipped) alert('Messenger not configured yet. Add the Facebook page token to enable Messenger updates.');
      else alert('Sent — status update sent over Messenger.');
    } catch (e) {
      alert('Could not send: ' + e.message);
    } finally {
      setMessengerBusy(false);
    }
  }

  return (
    <OpsShell title={order ? `#${orderCode(order.id)}` : 'Order'} subtitle={order?.customer_name} allow={['owner', 'admin', 'staff']}>
      {loading && <p className="text-center py-16 text-gray-400">Loading…</p>}
      {!loading && (error || !order) && (
        <p className="clay-raised-sm rounded-2xl p-4 text-sm text-clay-danger bg-clay-danger-bg">{error ?? 'Order not found'}</p>
      )}

      {!loading && order && (
        <div className="space-y-4 max-w-2xl">
          <div className="flex items-center justify-between">
            <ClayButton variant="outline" size="sm" onClick={() => router.push('/admin/ops/orders')}>
              ← Back
            </ClayButton>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_BADGE[order.status] ?? 'bg-gray-100 text-gray-700'}`}>
              {STATUS_LABELS[order.status] ?? order.status}
            </span>
          </div>

          <ClayCard className="p-4">
            <h2 className="font-display font-bold text-clay-ink mb-2">Customer</h2>
            <Row label="Phone" value={order.phone} />
            <Row label="Address" value={order.address} />
            <Row label="Barangay" value={order.barangay} />
          </ClayCard>

          <ClayCard className="p-4">
            <h2 className="font-display font-bold text-clay-ink mb-2">Order items</h2>
            <Row label="Product" value={order.product_type} />
            <Row label="Container size" value={order.container_size} />
            <Row label="Quantity" value={order.quantity} />
            <Row label="Needs container(s)" value={order.need_container ? `Yes (${order.container_quantity})` : 'No'} />
            <Row label="Total" value={`₱${Number(order.total_amount ?? 0).toFixed(2)}`} />
            <Row label="Sale channel" value={order.sale_channel} />
            {order.voucher_count > 0 && <Row label="Loyalty vouchers redeemed" value={order.voucher_count} />}
          </ClayCard>

          <ClayCard className="p-4">
            <h2 className="font-display font-bold text-clay-ink mb-2">Payment</h2>
            <Row label="Payment method" value={order.payment_method} />
            <Row label="Reference #" value={order.reference_number} />
            <Row label="GCash #" value={order.gcash_number} />
            <Row label="Cash tendered" value={order.cash_tendered ? `₱${order.cash_tendered}` : null} />
            {order.payment_method === 'gcash' || order.payment_method === 'bank_transfer' ? (
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-clay-muted">Payment verified</span>
                <input
                  type="checkbox"
                  checked={!!order.payment_verified}
                  disabled={verifyBusy}
                  onChange={(e) => handleVerifiedChange(e.target.checked)}
                  className="w-5 h-5"
                />
              </div>
            ) : (
              <Row label="Payment verified" value={order.payment_verified ? 'Yes' : 'No'} />
            )}
            {order.payment_screenshot_path && (
              <div className="mt-3">
                <div className="text-sm text-clay-muted mb-1">Payment screenshot</div>
                {screenshotUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={screenshotUrl} alt="Payment screenshot" className="w-full max-h-60 object-contain rounded-xl bg-clay-bg" />
                ) : screenshotError ? (
                  <p className="text-sm text-clay-muted">Screenshot unavailable.</p>
                ) : (
                  <p className="text-sm text-clay-muted">Loading…</p>
                )}
              </div>
            )}
          </ClayCard>

          <ClayCard className="p-4">
            <h2 className="font-display font-bold text-clay-ink mb-2">Delivery schedule</h2>
            <Row label="Pickup date" value={order.pickup_date} />
            <Row label="Pickup time" value={order.pickup_time} />
            <Row label="Delivery date" value={order.delivery_date} />
            <Row label="Delivery time" value={order.delivery_time} />
            <Row label="Notes" value={order.notes} />
          </ClayCard>

          {order.reward_requested > 0 && (
            <ClayCard className="p-4">
              <h2 className="font-display font-bold text-clay-ink mb-2">Loyalty reward requested</h2>
              <p className="text-sm text-clay-muted mb-3">
                This online order requested {order.reward_requested} free refill(s). Applying redeems the customer&apos;s earned vouchers
                server-side and lowers the total.
              </p>
              <ClayButton onClick={() => handleApplyReward(order.reward_requested)} disabled={rewardBusy}>
                {rewardBusy ? 'Applying…' : `Apply free refill (${order.reward_requested})`}
              </ClayButton>
            </ClayCard>
          )}

          {order.messenger_psid && (
            <ClayCard className="p-4">
              <h2 className="font-display font-bold text-clay-ink mb-2">Customer messaging</h2>
              <p className="text-sm text-clay-muted mb-3">
                Send this order&apos;s current status ({order.status.replace(/_/g, ' ')}) over Messenger.
              </p>
              <ClayButton variant="outline" onClick={handleSendMessenger} disabled={messengerBusy}>
                {messengerBusy ? 'Sending…' : 'Send status via Messenger'}
              </ClayButton>
            </ClayCard>
          )}

          {nextStatuses(order.status).length > 0 ? (
            <ClayCard className="p-4">
              <h2 className="font-display font-bold text-clay-ink mb-2">Change status</h2>
              <div className="flex flex-wrap gap-2">
                {nextStatuses(order.status).map((s) => (
                  <ClayButton
                    key={s}
                    variant={STATUS_BTN_VARIANT[s] ?? 'primary'}
                    size="sm"
                    disabled={statusBusy}
                    onClick={() => handleStatusChange(s)}
                  >
                    {s === 'cancelled' ? 'Cancel order' : `Mark ${s.replace(/_/g, ' ')}`}
                  </ClayButton>
                ))}
              </div>
              {statusError && <p className="text-sm text-clay-danger mt-2">{statusError}</p>}
            </ClayCard>
          ) : (
            <p className="text-center text-sm text-clay-muted py-4">This order is in a terminal state ({order.status}).</p>
          )}
        </div>
      )}
    </OpsShell>
  );
}
