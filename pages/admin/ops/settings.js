import { useEffect, useState } from 'react';
import OpsShell from '@/components/admin/OpsShell';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import { useOpsSession } from '@/lib/useOpsSession';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

const DELIVERY_RULES = [
  { min: 3, fee: 0, label: '3+ containers', feeLabel: 'FREE' },
  { min: 2, fee: 15, label: '2 containers', feeLabel: '₱15' },
  { min: 1, fee: 20, label: '1 container', feeLabel: '₱20' },
];

const DEFAULT_LOYALTY = { gallonsPerVoucher: 10, voucherValue: 20, gallonsBySize: {} };

function deliveryTiersFromSettings(settings) {
  const row = settings?.find((s) => s.key === 'delivery_fee_tiers');
  return Array.isArray(row?.value) ? row.value : DELIVERY_RULES;
}

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

// Money-relevant (server RPCs read app_settings.delivery_fee_tiers /
// voucher_value) — validate carefully, never save a malformed shape.
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
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    const supabase = getSupabaseBrowser();
    const { data, error } = await supabase.from('app_settings').select('*');
    if (!error) setSettings(data);
    setLoading(false);
  }

  useEffect(() => { queueMicrotask(() => reload()); }, []);

  if (loading) return <p className="text-center py-16 text-clay-ink/50">Loading…</p>;

  return (
    <div className="space-y-4 max-w-xl">
      {!canEdit && <p className="text-sm text-clay-ink/50">Read-only — only owner/admin can edit settings.</p>}
      <LoyaltySection key={JSON.stringify(loyaltySettingsFromSettings(settings))} settings={settings} canEdit={canEdit} onSaved={reload} />
      <DeliveryTiersSection key={JSON.stringify(deliveryTiersFromSettings(settings))} settings={settings} canEdit={canEdit} onSaved={reload} />
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

function DeliveryTiersSection({ settings, canEdit, onSaved }) {
  const tiers = deliveryTiersFromSettings(settings);
  const [fees, setFees] = useState(tiers.map((t) => String(t.fee)));
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null); setSaved(false);
    const parsedFees = fees.map(parsePositiveNumber);
    if (parsedFees.some((f) => f === null)) {
      setError('Every fee must be a valid non-negative number.');
      return;
    }
    const nextTiers = tiers.map((tier, i) => ({ ...tier, fee: parsedFees[i] }));
    setSaving(true);
    try {
      await saveSetting('delivery_fee_tiers', nextTiers);
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
      <SectionHeader icon="cash" title="Delivery Fee Tiers" />
      {tiers.map((tier, i) => (
        <div key={tier.label} className="flex items-center justify-between gap-3">
          <span className="text-sm text-clay-ink/80 flex-1">{tier.label}</span>
          <input
            className="clay-inset rounded-xl px-3 py-2 text-sm text-right w-28"
            disabled={!canEdit}
            value={fees[i]}
            onChange={(e) => setFees((prev) => prev.map((f, idx) => (idx === i ? e.target.value : f)))}
            inputMode="decimal"
          />
        </div>
      ))}
      {error && <p className="text-sm text-clay-danger">{error}</p>}
      {saved && <p className="text-sm text-green-600">Saved.</p>}
      {canEdit && <ClayButton size="sm" onClick={handleSave} loading={saving}>Save Delivery Tiers</ClayButton>}
    </ClayCard>
  );
}
