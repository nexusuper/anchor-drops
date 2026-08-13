import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import OpsShell from '@/components/admin/OpsShell';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import { useOpsSession } from '@/lib/useOpsSession';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

export default function ProfilePage() {
  return (
    <OpsShell title="Profile" allow={['owner', 'admin', 'staff', 'driver']}>
      <ProfileContent />
    </OpsShell>
  );
}

function ProfileContent() {
  const router = useRouter();
  const { session, profile, role, signOut } = useOpsSession();
  const fileRef = useRef(null);

  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState(null);
  const [nameSaved, setNameSaved] = useState(false);

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState(null);

  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState(null);
  const [pwSaved, setPwSaved] = useState(false);

  useEffect(() => { queueMicrotask(() => setFullName(profile?.full_name || '')); }, [profile?.full_name]);

  useEffect(() => {
    queueMicrotask(() => {
      if (!profile?.avatar_url) { setAvatarUrl(null); return; }
      const supabase = getSupabaseBrowser();
      supabase.storage.from('avatars').createSignedUrl(profile.avatar_url, 3600)
        .then(({ data }) => setAvatarUrl(data?.signedUrl ?? null));
    });
  }, [profile?.avatar_url]);

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !session?.user) return;
    setAvatarError(null);
    setUploading(true);
    try {
      const supabase = getSupabaseBrowser();
      const path = `${session.user.id}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;
      const { error: rpcError } = await supabase.rpc('set_my_avatar', { p_path: path });
      if (rpcError) throw rpcError;
      const { data } = await supabase.storage.from('avatars').createSignedUrl(path, 3600);
      setAvatarUrl(data?.signedUrl ?? null);
    } catch (err) {
      setAvatarError(err.message);
    } finally {
      setUploading(false);
    }
  }

  // Own-name edit goes through the `set_my_name` RPC (migration 0031), not a
  // direct UPDATE: staff/driver have no self-UPDATE policy on `profiles`, since
  // a blanket one would open role/branch tampering on that table. The RPC is
  // SECURITY DEFINER and can only ever write full_name on the caller's own row.
  // Same rationale as `set_my_avatar` (0021).
  async function handleSaveName() {
    if (!session?.user) return;
    setNameError(null); setNameSaved(false);
    if (!fullName.trim()) { setNameError('Name is required.'); return; }
    setNameSaving(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.rpc('set_my_name', { p_full_name: fullName.trim() });
      if (error) throw error;
      setNameSaved(true);
    } catch (err) {
      setNameError(err.message);
    } finally {
      setNameSaving(false);
    }
  }

  async function handleChangePassword() {
    setPwError(null); setPwSaved(false);
    if (password.length < 6) { setPwError('Password must be at least 6 characters.'); return; }
    if (password !== password2) { setPwError('Passwords do not match.'); return; }
    setPwSaving(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword(''); setPassword2('');
      setPwSaved(true);
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwSaving(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    router.replace('/admin/login');
  }

  return (
    <div className="space-y-4 max-w-xl">
      <ClayCard className="p-6 flex flex-col items-center gap-2">
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className="relative">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover clay-raised-sm" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-clay-sky/30 flex items-center justify-center font-display font-bold text-xl text-clay-skydeep clay-raised-sm">
              {(fullName || 'A').charAt(0).toUpperCase()}
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
              <span className="clay-spinner" aria-hidden="true" />
            </div>
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
        <div className="font-display font-bold text-lg text-clay-ink">{fullName || 'Profile'}</div>
        <div className="text-xs text-clay-ink/60">{capitalize(role)}</div>
        {avatarError && <p className="text-sm text-clay-danger">{avatarError}</p>}
      </ClayCard>

      <ClayCard className="p-4 space-y-3">
        <div className="font-display font-bold text-clay-ink">Name</div>
        <input className="clay-inset w-full rounded-xl px-4 py-2 text-sm" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        {nameError && <p className="text-sm text-clay-danger">{nameError}</p>}
        {nameSaved && <p className="text-sm text-green-600">Saved.</p>}
        <ClayButton size="sm" onClick={handleSaveName} loading={nameSaving}>Save Name</ClayButton>
      </ClayCard>

      <ClayCard className="p-4 space-y-3">
        <div className="font-display font-bold text-clay-ink">Change Password</div>
        <input className="clay-inset w-full rounded-xl px-4 py-2 text-sm" type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <input className="clay-inset w-full rounded-xl px-4 py-2 text-sm" type="password" placeholder="Confirm new password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
        {pwError && <p className="text-sm text-clay-danger">{pwError}</p>}
        {pwSaved && <p className="text-sm text-green-600">Password updated.</p>}
        <ClayButton size="sm" onClick={handleChangePassword} loading={pwSaving}>Update Password</ClayButton>
      </ClayCard>

      <ClayButton variant="outline" onClick={handleSignOut}>Sign out</ClayButton>
    </div>
  );
}
