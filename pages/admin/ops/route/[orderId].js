import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import OpsShell from '@/components/admin/OpsShell';
import ClayButton from '@/components/ui/ClayButton';
import ClayCard from '@/components/ui/ClayCard';
import ClayIcon from '@/components/ui/ClayIcon';
import RouteSignaturePad from '@/components/admin/ops/RouteSignaturePad';
import { fetchStop, formatTime, navigateUrl, PAYMENT_METHODS, peso } from '@/components/admin/ops/RouteData';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { uuidv4 } from '@/lib/uuid';

// Stop detail + Complete Delivery — web port of app/(app)/route/[orderId].tsx.
//
// ONLINE-ONLY by scope decision: no IndexedDB outbox, no service worker. The
// `complete_delivery` RPC is called directly, with a client-generated UUID as
// p_client_uuid so a retry after a dropped response is an idempotent no-op
// server-side rather than a second delivery.
//
// MEDIA ORDERING (do not change): photo/signature/screenshot are uploaded to
// Supabase Storage and resolved to object PATHS before the RPC runs — a blob:
// URL must never reach complete_delivery, because the RPC's idempotent
// short-circuit would lock that dead local URL into proof_of_delivery
// permanently. Same rule as the app's src/offline/media.ts.
const POD_BUCKET = 'proof-of-delivery';
const SCREENSHOT_BUCKET = 'payment-screenshots';

// Postgres check_violation — complete_delivery raises this when the order is
// already cancelled/delivered or was reassigned to another driver. Terminal:
// retrying can never succeed, so surface it instead of offering a retry.
const TERMINAL_CODES = ['23514'];

function Section({ title, children, icon }) {
  return (
    <ClayCard className="p-4 space-y-3">
      <h2 className="font-display font-bold text-clay-ink flex items-center gap-2">
        {icon && <ClayIcon name={icon} className="w-4 h-4" />}
        {title}
      </h2>
      {children}
    </ClayCard>
  );
}

const inputClass =
  'w-full rounded-2xl clay-inset bg-clay-surface px-4 py-3 text-base text-clay-ink outline-none focus:ring-2 focus:ring-clay-sky';

// File + its preview URL as one unit, so the old object URL is revoked instead
// of leaking one per re-render.
function usePickedImage() {
  const [picked, setPicked] = useState({ file: null, url: null });
  const pick = (file) => {
    setPicked((prev) => {
      if (prev.url) URL.revokeObjectURL(prev.url);
      return { file: file ?? null, url: file ? URL.createObjectURL(file) : null };
    });
  };
  return [picked, pick];
}

function StopBody({ orderId }) {
  const router = useRouter();
  const [order, setOrder] = useState(undefined); // undefined = loading, null = not found
  const [loadError, setLoadError] = useState(null);

  const [photo, setPhoto] = usePickedImage();
  const [signature, setSignature] = useState(null);
  const [recordPayment, setRecordPayment] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('cod');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [screenshot, setScreenshot] = usePickedImage();
  const [containersReturned, setContainersReturned] = useState('0');

  const [busy, setBusy] = useState(null); // 'uploading' | 'saving' | null
  const [submitError, setSubmitError] = useState(null);
  const [terminal, setTerminal] = useState(null);
  const [done, setDone] = useState(false);

  // One idempotency key per stop visit, reused across retries — a retry after a
  // dropped response must NOT mint a new p_client_uuid or the RPC would record a
  // second delivery. Also the Storage object key, so a re-upload overwrites.
  const clientUuid = useRef(null);
  if (clientUuid.current == null) clientUuid.current = uuidv4();
  // Paths already uploaded for this key, so a retry skips finished uploads.
  const uploaded = useRef({});

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    fetchStop(getSupabaseBrowser(), orderId)
      .then((row) => { if (!cancelled) setOrder(row); })
      .catch((e) => { if (!cancelled) { setOrder(null); setLoadError(e.message); } });
    return () => { cancelled = true; };
  }, [orderId]);

  useEffect(() => {
    if (!order) return;
    queueMicrotask(() => {
      setPaymentMethod(PAYMENT_METHODS.includes(order.payment_method) ? order.payment_method : 'cod');
      setAmount(String(order.total_amount ?? 0));
      setContainersReturned(String(order.need_container ? (order.container_quantity ?? 0) : 0));
    });
  }, [order]);

  if (order === undefined) return <p className="text-center py-16 text-gray-400">Loading stop…</p>;

  if (order === null) {
    return (
      <ClayCard className="p-6 space-y-3 text-center">
        <p className="text-sm text-clay-danger">
          {loadError || 'Stop not found, or it is no longer visible to you (archived, or reassigned).'}
        </p>
        <ClayButton variant="outline" href="/admin/ops/route">Back to route</ClayButton>
      </ClayCard>
    );
  }

  const deliverable = order.status === 'confirmed' || order.status === 'out_for_delivery';

  // Best-effort GPS fix. Never blocks the delivery — the app does the same
  // (getGpsFix swallows every failure and returns nulls).
  function getGpsFix() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ lat: null, lng: null });
      const timer = setTimeout(() => resolve({ lat: null, lng: null }), 8000);
      navigator.geolocation.getCurrentPosition(
        (p) => { clearTimeout(timer); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
        () => { clearTimeout(timer); resolve({ lat: null, lng: null }); },
        { enableHighAccuracy: false, timeout: 8000 }
      );
    });
  }

  async function uploadOne(key, bucket, path, blob, contentType) {
    if (uploaded.current[key]) return uploaded.current[key];
    const { error } = await getSupabaseBrowser()
      .storage.from(bucket)
      .upload(path, blob, { contentType, upsert: true });
    if (error) throw new Error(`Upload failed (${bucket}): ${error.message}`);
    uploaded.current[key] = path;
    return path;
  }

  async function handleSubmit() {
    if (busy || done || terminal) return;
    setSubmitError(null);
    const key = clientUuid.current;
    try {
      // ---- 1. Resolve all media to Storage paths FIRST (never a blob: URL) ----
      setBusy('uploading');
      let photoPath = null;
      let signaturePath = null;
      let screenshotPath = null;
      if (photo.file) {
        photoPath = await uploadOne('photo', POD_BUCKET, `${key}/photo.jpg`, photo.file, photo.file.type || 'image/jpeg');
      }
      if (signature) {
        signaturePath = await uploadOne('signature', POD_BUCKET, `${key}/signature.png`, signature, 'image/png');
      }
      if (recordPayment && screenshot.file) {
        screenshotPath = await uploadOne('screenshot', SCREENSHOT_BUCKET, `${key}/payment.jpg`, screenshot.file, screenshot.file.type || 'image/jpeg');
      }

      // ---- 2. Then the RPC, keyed by the stable client UUID ----
      setBusy('saving');
      const { lat, lng } = await getGpsFix();
      const paidAmount = Number(amount);
      const { error } = await getSupabaseBrowser().rpc('complete_delivery', {
        p_order_id: order.id,
        p_client_uuid: key,
        p_photo_path: photoPath,
        p_signature_path: signaturePath,
        p_lat: lat,
        p_lng: lng,
        p_payment_method: recordPayment ? paymentMethod : null,
        p_payment_amount: recordPayment ? (Number.isFinite(paidAmount) ? paidAmount : 0) : null,
        p_payment_reference: recordPayment ? (reference.trim() || null) : null,
        p_payment_screenshot_path: screenshotPath,
        p_payment_client_uuid: recordPayment ? key : null,
        p_containers_returned: Number(containersReturned) || 0,
      });
      if (error) {
        if (TERMINAL_CODES.includes(error.code)) {
          setTerminal(error.message);
          return;
        }
        throw error;
      }
      setDone(true);
    } catch (e) {
      setSubmitError(e.message || 'Could not record the delivery. Check your signal and try again.');
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <ClayCard className="p-6 space-y-3 text-center">
        <ClayIcon name="check" className="w-10 h-10 mx-auto text-clay-skydeep" />
        <p className="font-display font-bold text-lg text-clay-ink">Delivery recorded</p>
        <p className="text-sm text-clay-muted">Saved to the server. Order marked delivered.</p>
        <ClayButton variant="primary" href="/admin/ops/route">Back to route</ClayButton>
      </ClayCard>
    );
  }

  if (terminal) {
    return (
      <ClayCard className="p-6 space-y-3 text-center">
        <ClayIcon name="alert" className="w-10 h-10 mx-auto text-clay-danger" />
        <p className="font-display font-bold text-lg text-clay-ink">This stop can no longer be completed</p>
        <p className="text-sm text-clay-danger">{terminal}</p>
        <p className="text-sm text-clay-muted">
          The order was cancelled, already delivered, or reassigned to another driver. Nothing was saved — do not retry.
          Tell the office so they can sort it out on the Needs Review board.
        </p>
        <ClayButton variant="outline" href="/admin/ops/route">Back to route</ClayButton>
      </ClayCard>
    );
  }

  return (
    <div className="space-y-4">
      <ClayCard className="p-4 space-y-1">
        <p className="font-display font-bold text-lg text-clay-ink">{order.customer_name}</p>
        <p className="text-sm text-clay-ink">{order.address}</p>
        <p className="text-xs text-clay-muted">
          Barangay {order.barangay || 'Unspecified'} · {formatTime(order.delivery_time)}
        </p>
        {order.notes && <p className="text-sm text-clay-skydeep">Note: {order.notes}</p>}
      </ClayCard>

      <div className="grid grid-cols-3 gap-2">
        <ClayButton variant="outline" size="sm" href={navigateUrl(order)} target="_blank" rel="noreferrer">
          Navigate
        </ClayButton>
        <ClayButton variant="outline" size="sm" href={`tel:${order.phone}`}>
          <ClayIcon name="phone" className="w-4 h-4" />
          Call
        </ClayButton>
        <ClayButton variant="outline" size="sm" href={`sms:${order.phone}`}>
          <ClayIcon name="chat" className="w-4 h-4" />
          SMS
        </ClayButton>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ClayCard variant="raisedSm" className="p-4">
          <p className="text-xs text-clay-muted">Amount Due</p>
          <p className="font-display font-bold text-lg text-clay-ink">{peso(order.total_amount)}</p>
        </ClayCard>
        <ClayCard variant="raisedSm" className="p-4">
          <p className="text-xs text-clay-muted">Container Balance</p>
          <p className="font-display font-bold text-lg text-clay-ink">
            {order.containerBalance != null ? `${order.containerBalance} pcs` : 'N/A'}
          </p>
          {order.containerBalance == null && <p className="text-xs text-clay-danger">lookup unavailable</p>}
        </ClayCard>
      </div>

      {!deliverable && (
        <p className="clay-raised-sm rounded-2xl p-4 text-sm text-clay-danger bg-clay-danger-bg">
          This order is <strong>{String(order.status).replace(/_/g, ' ')}</strong>, not on the route. It cannot be
          completed.
        </p>
      )}

      <Section title="Order" icon="clipboard">
        <dl className="text-sm space-y-1">
          <div className="flex justify-between gap-3">
            <dt className="text-clay-muted">Product</dt>
            <dd className="text-clay-ink text-right">
              {order.productName ?? order.product_type} · {order.container_size} × {order.quantity}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-clay-muted">Payment method on file</dt>
            <dd className="text-clay-ink">{order.payment_method}</dd>
          </div>
          {order.need_container && (
            <div className="flex justify-between gap-3">
              <dt className="text-clay-muted">Containers to deliver</dt>
              <dd className="text-clay-ink">{order.container_quantity}</dd>
            </div>
          )}
        </dl>
      </Section>

      <Section title="Delivery Photo" icon="camera">
        {photo.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt="Delivery photo preview" className="w-full h-44 object-cover rounded-2xl" />
        ) : (
          <p className="text-sm text-clay-muted">No photo yet.</p>
        )}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); delete uploaded.current.photo; }}
          className="block w-full text-sm text-clay-ink file:mr-3 file:rounded-full file:border-0 file:bg-clay-sky/30 file:px-4 file:py-2 file:font-semibold file:text-clay-skydeep"
        />
      </Section>

      <Section title="Customer Signature" icon="pen">
        <RouteSignaturePad
          saved={!!signature}
          onSave={(blob) => { setSignature(blob); delete uploaded.current.signature; }}
        />
      </Section>

      <Section title="Record a Payment" icon="cash">
        <label className="flex items-center gap-3 text-sm font-semibold text-clay-ink">
          <input
            type="checkbox"
            checked={recordPayment}
            onChange={(e) => setRecordPayment(e.target.checked)}
            className="w-5 h-5"
          />
          Collected a payment at the door
        </label>
        {recordPayment && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={
                    'rounded-full px-4 py-2 text-sm font-semibold capitalize clay-pressable ' +
                    (paymentMethod === m ? 'clay-btn-primary' : 'clay-inset bg-clay-surface text-clay-muted')
                  }
                >
                  {m.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
            <label className="block text-sm text-clay-muted">
              Amount collected (₱)
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={inputClass + ' mt-1'}
              />
            </label>
            {(paymentMethod === 'gcash' || paymentMethod === 'bank_transfer') && (
              <label className="block text-sm text-clay-muted">
                Reference number
                <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass + ' mt-1'} />
              </label>
            )}
            {paymentMethod === 'gcash' && (
              <div className="space-y-2">
                {screenshot.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={screenshot.url} alt="GCash screenshot preview" className="w-full h-44 object-contain rounded-2xl" />
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => { setScreenshot(e.target.files?.[0] ?? null); delete uploaded.current.screenshot; }}
                  className="block w-full text-sm text-clay-ink file:mr-3 file:rounded-full file:border-0 file:bg-clay-sky/30 file:px-4 file:py-2 file:font-semibold file:text-clay-skydeep"
                />
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="Containers Returned" icon="box">
        <p className="text-sm text-clay-muted">Empties collected at the door.</p>
        <input
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          value={containersReturned}
          onChange={(e) => setContainersReturned(e.target.value)}
          className={inputClass}
        />
      </Section>

      {submitError && (
        <p className="clay-raised-sm rounded-2xl p-4 text-sm text-clay-danger bg-clay-danger-bg">
          {submitError} Press Complete delivery again — the same delivery id is reused, so a retry can’t double-record.
        </p>
      )}

      <ClayButton
        variant="primary"
        size="lg"
        className="w-full"
        disabled={!deliverable}
        loading={!!busy}
        onClick={handleSubmit}
      >
        Complete delivery
      </ClayButton>
      {busy && (
        <p className="text-center text-sm text-clay-muted">
          {busy === 'uploading' ? 'Uploading photo/signature…' : 'Recording delivery…'}
        </p>
      )}
      <ClayButton variant="outline" className="w-full" onClick={() => router.push('/admin/ops/route')}>
        Back to route
      </ClayButton>
    </div>
  );
}

export default function StopPage() {
  const router = useRouter();
  const { orderId } = router.query;
  return (
    <OpsShell title="Complete Delivery" subtitle="Stop detail" allow={['owner', 'admin', 'staff', 'driver']}>
      {orderId ? <StopBody orderId={String(orderId)} /> : <p className="text-center py-16 text-gray-400">Loading…</p>}
    </OpsShell>
  );
}
