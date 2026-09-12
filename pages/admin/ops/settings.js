import { useEffect, useState } from 'react';
import OpsShell from '@/components/admin/OpsShell';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import { useOpsSession } from '@/lib/useOpsSession';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

const DEFAULT_LOYALTY = { gallonsPerVoucher: 10, voucherValue: 20, gallonsBySize: {} };

function loyaltySettingsFromSettings(settings) {
  const row = settings?.find((s) => s.key === 'loyalty');
  const v = row?.value;
  if (!v) return DEFAULT_LOYALTY;
  return {
    gallonsPerVoucher: v.gallons_per_voucher ?? DEFAULT_LOYALTY.gallonsPerVoucher,
    voucherValue: v.voucher_value ?? DEFAULT_LOYALTY.voucherValue,
    gallonsBySize: v.gallons_by_size ?? DEFAULT_LOYALTY.gallonsBySize,
  };
}

// Money-relevant (server RPCs read app_settings.voucher_value) — validate
// carefully, never save a malformed shape.
function parsePositiveNumber(text) {
  const n = Number(text);
  if (text.trim() === '' || !Number.isFinite(n) || n < 0) return null;
  return n;
}

export default function SettingsPage() {
  return (
    <OpsShell title="Settings" allow={['owner', 'admin']}>
      <SettingsContent />
    </OpsShell>
  );
}

function SettingsContent() {
  const { role } = useOpsSession();
  const canEdit = role === 'owner' || role === 'admin';
  const [settings, setSettings] = useState(null);
  const [products, setProducts] = useState(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    const supabase = getSupabaseBrowser();
    const [{ data: settingsData, error }, { data: productsData, error: productsErr }] = await Promise.all([
      supabase.from('app_settings').select('*'),
      supabase.from('products').select('*').or('tag.is.null,tag.neq.supply').order('sort_order'),
    ]);
    if (!error) setSettings(settingsData);
    if (!productsErr) setProducts(productsData);
    setLoading(false);
  }

  useEffect(() => { queueMicrotask(() => reload()); }, []);

  if (loading) return <p className="text-center py-16 text-clay-ink/50">Loading…</p>;

  return (
    <div className="space-y-4 max-w-xl">
      {!canEdit && <p className="text-sm text-clay-ink/50">Read-only — only owner/admin can edit settings.</p>}
      <OrderingSection settings={settings} canEdit={canEdit} onSaved={reload} />
      <BusinessHoursSection settings={settings} canEdit={canEdit} onSaved={reload} />
      <ProductsSection products={products} canEdit={canEdit} onSaved={reload} />
      <LoyaltySection key={JSON.stringify(loyaltySettingsFromSettings(settings))} settings={settings} canEdit={canEdit} onSaved={reload} />
    </div>
  );
}

function SectionHeader({ icon, title }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center">
        <ClayIcon name={icon} className="w-4 h-4 text-clay-skydeep" />
      </div>
      <div className="font-display font-bold text-clay-ink">{title}</div>
    </div>
  );
}

async function saveSetting(key, value) {
  const supabase = getSupabaseBrowser();
  // .select() so an RLS-invisible existing row can't make the write look like a
  // success — these values feed server-side pricing, so a silent no-op here
  // would leave stale fees/voucher values in effect.
  const { data, error } = await supabase
    .from('app_settings')
    .upsert({ key, value }, { onConflict: 'key' })
    .select('key');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(`Setting "${key}" was not saved (permission denied).`);
}

function OrderingSection({ settings, canEdit, onSaved }) {
  const row = settings?.find((s) => s.key === 'ordering_enabled');
  const enabled = row ? row.value === true : true;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function toggle() {
    setError(null);
    setSaving(true);
    try {
      await saveSetting('ordering_enabled', !enabled);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ClayCard className="p-4 space-y-3">
      <SectionHeader icon="truck" title="Online Ordering" />
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-clay-ink/80">
          Public order form is <b className={enabled ? 'text-green-600' : 'text-clay-danger'}>{enabled ? 'OPEN' : 'CLOSED (Opening Soon)'}</b>
        </span>
        {canEdit && (
          <ClayButton size="sm" variant={enabled ? 'outline' : 'primary'} onClick={toggle} loading={saving}>
            {enabled ? 'Close Ordering' : 'Open Ordering'}
          </ClayButton>
        )}
      </div>
      {error && <p className="text-sm text-clay-danger">{error}</p>}
    </ClayCard>
  );
}

// Store is normally closed Sunday (lib/scheduling.js). Dates listed here let
// online ordering treat that specific day as open, e.g. a one-off Sunday sale.
function BusinessHoursSection({ settings, canEdit, onSaved }) {
  const row = settings?.find((s) => s.key === 'open_override_dates');
  const dates = Array.isArray(row?.value) ? row.value : [];
  const [newDate, setNewDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save(nextDates) {
    setError(null);
    setSaving(true);
    try {
      await saveSetting('open_override_dates', nextDates);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function addDate() {
    if (!newDate || dates.includes(newDate)) return;
    save([...dates, newDate].sort());
    setNewDate('');
  }

  function removeDate(d) {
    save(dates.filter((x) => x !== d));
  }

  return (
    <ClayCard className="p-4 space-y-3">
      <SectionHeader icon="clock" title="Business Hours" />
      <p className="text-xs text-clay-ink/60">
        Store is closed Sundays by default. Add a date below to open online ordering for that Sunday specifically.
      </p>
      {dates.length > 0 && (
        <ul className="space-y-1">
          {dates.map((d) => (
            <li key={d} className="flex items-center justify-between text-sm">
              <span>{d}</span>
              {canEdit && (
                <button type="button" className="text-xs text-clay-danger" onClick={() => removeDate(d)} disabled={saving}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="clay-inset rounded-xl px-3 py-2 text-sm flex-1"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
          />
          <ClayButton size="sm" onClick={addDate} loading={saving} disabled={!newDate}>Add</ClayButton>
        </div>
      )}
      {error && <p className="text-sm text-clay-danger">{error}</p>}
    </ClayCard>
  );
}

function LoyaltySection({ settings, canEdit, onSaved }) {
  const loyalty = loyaltySettingsFromSettings(settings);
  const [gallonsPerVoucher, setGallonsPerVoucher] = useState(String(loyalty.gallonsPerVoucher));
  const [voucherValue, setVoucherValue] = useState(String(loyalty.voucherValue));
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null); setSaved(false);
    const gpv = parsePositiveNumber(gallonsPerVoucher);
    const vv = parsePositiveNumber(voucherValue);
    if (gpv === null || vv === null) {
      setError('Enter valid non-negative numbers for both fields.');
      return;
    }
    const existingRow = settings?.find((s) => s.key === 'loyalty');
    const existingValue = existingRow?.value ?? {};
    setSaving(true);
    try {
      await saveSetting('loyalty', {
        ...existingValue,
        gallons_per_voucher: gpv,
        voucher_value: vv,
        gallons_by_size: loyalty.gallonsBySize,
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ClayCard className="p-4 space-y-3">
      <SectionHeader icon="party" title="Loyalty Program" />
      <div className="space-y-1">
        <label className="text-xs text-clay-ink/60">Gallons per voucher</label>
        <input className="clay-inset w-full rounded-xl px-4 py-2 text-sm" disabled={!canEdit} value={gallonsPerVoucher} onChange={(e) => setGallonsPerVoucher(e.target.value)} inputMode="decimal" />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-clay-ink/60">Voucher value (₱)</label>
        <input className="clay-inset w-full rounded-xl px-4 py-2 text-sm" disabled={!canEdit} value={voucherValue} onChange={(e) => setVoucherValue(e.target.value)} inputMode="decimal" />
      </div>
      {error && <p className="text-sm text-clay-danger">{error}</p>}
      {saved && <p className="text-sm text-green-600">Saved.</p>}
      {canEdit && <ClayButton size="sm" onClick={handleSave} loading={saving}>Save Loyalty Settings</ClayButton>}
    </ClayCard>
  );
}

// Generic on/off switch for any row in the `products` table — this is what
// the site's public product list (lib/products.js, filtered by /api/ordering-status)
// actually checks, so flipping a row here hides/shows it everywhere at once.
function ProductsSection({ products, canEdit, onSaved }) {
  const [pendingSku, setPendingSku] = useState(null);
  const [error, setError] = useState(null);

  async function toggleProduct(sku, nextActive) {
    setError(null);
    setPendingSku(sku);
    try {
      const supabase = getSupabaseBrowser();
      const { data, error: err } = await supabase.from('products').update({ is_active: nextActive }).eq('sku', sku).select('sku');
      if (err) throw err;
      if (!data || data.length === 0) throw new Error(`Product "${sku}" was not updated (permission denied).`);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setPendingSku(null);
    }
  }

  return (
    <ClayCard className="p-4 space-y-3">
      <SectionHeader icon="box" title="Products" />
      {(products || []).map((p) => (
        <div key={p.sku} className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-clay-ink">{p.name}</div>
            <div className="text-xs text-clay-ink/50">₱{p.refill_price} refill · ₱{Number(p.refill_price) + Number(p.container_price)} container+refill</div>
          </div>
          {canEdit && (
            <ClayButton
              size="sm"
              variant={p.is_active ? 'outline' : 'primary'}
              onClick={() => toggleProduct(p.sku, !p.is_active)}
              loading={pendingSku === p.sku}
            >
              {p.is_active ? 'Turn Off' : 'Turn On'}
            </ClayButton>
          )}
        </div>
      ))}
      {error && <p className="text-sm text-clay-danger">{error}</p>}
    </ClayCard>
  );
}
