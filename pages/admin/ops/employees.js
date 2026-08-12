import { useCallback, useEffect, useState } from 'react';
import OpsShell from '@/components/admin/OpsShell';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import { useOpsSession } from '@/lib/useOpsSession';
import { fetchEmployees, fetchActivityLog, createEmployee, deactivateEmployee } from '@/components/admin/ops/StaffApi';

const CREATABLE_ROLES = ['staff', 'driver', 'admin'];
const ROLE_FILTERS = ['all', 'staff', 'driver'];

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export default function EmployeesPage() {
  return (
    <OpsShell title="Employees" allow={['owner', 'admin']}>
      <EmployeesContent />
    </OpsShell>
  );
}

function EmployeesContent() {
  const { role, branchId } = useOpsSession();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [roleFilter, setRoleFilter] = useState('all');

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEmployees(await fetchEmployees());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(() => loadEmployees()); }, [loadEmployees]);

  useEffect(() => {
    if (!showActivity) return;
    async function load() {
      setActivityLoading(true);
      try {
        setActivity(await fetchActivityLog());
      } finally {
        setActivityLoading(false);
      }
    }
    queueMicrotask(() => load());
  }, [showActivity]);

  async function handleDeactivate(p) {
    if (!confirm(`Deactivate ${p.full_name || p.id}? They will no longer be able to sign in.`)) return;
    try {
      await deactivateEmployee(p.id);
      await loadEmployees();
    } catch (e) {
      alert(e.message);
    }
  }

  const filtered = employees.filter((p) => roleFilter === 'all' || p.role === roleFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {ROLE_FILTERS.map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold ${roleFilter === r ? 'clay-btn-primary' : 'clay-raised-sm bg-clay-surface'}`}
            >
              {capitalize(r)}
            </button>
          ))}
        </div>
        <ClayButton variant={showAdd ? 'outline' : 'primary'} size="sm" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Cancel' : '+ Add Employee'}
        </ClayButton>
      </div>

      {showAdd && <AddEmployeeForm role={role} branchId={branchId} onDone={() => { setShowAdd(false); loadEmployees(); }} />}

      {error && <p className="text-sm text-clay-danger bg-clay-danger-bg clay-raised-sm rounded-2xl p-3">{error}</p>}

      <div className="space-y-2">
        {filtered.map((p) => (
          <ClayCard key={p.id} className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-clay-sky/30 flex items-center justify-center font-display font-bold text-clay-skydeep shrink-0">
              {(p.full_name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-clay-ink truncate">{p.full_name || '(no name)'}</div>
              <div className="text-xs text-clay-ink/60">
                {capitalize(p.role)} · branch {p.branch_id ? p.branch_id.slice(0, 8) : '—'}
              </div>
            </div>
            <span className={`text-xs font-semibold px-3 py-1 rounded-full ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {p.is_active ? 'Active' : 'Inactive'}
            </span>
            {p.is_active && p.role !== 'owner' && (
              <button onClick={() => handleDeactivate(p)} className="text-xs font-semibold text-clay-danger px-2 py-1">
                Deactivate
              </button>
            )}
          </ClayCard>
        ))}
        {!loading && filtered.length === 0 && <p className="text-sm text-clay-ink/50 py-8 text-center">No employees found</p>}
      </div>

      <button
        onClick={() => setShowActivity((v) => !v)}
        className="font-semibold text-clay-skydeep text-sm mt-4"
      >
        {showActivity ? 'Hide activity log' : 'Show activity log'}
      </button>
      {showActivity && (
        <div className="max-h-64 overflow-y-auto space-y-1.5">
          {activityLoading && <p className="text-sm text-clay-ink/50">Loading…</p>}
          {!activityLoading && activity.length === 0 && <p className="text-sm text-clay-ink/50">No activity yet</p>}
          {!activityLoading && activity.map((a) => (
            <ClayCard key={a.id} className="p-3">
              <div className="font-semibold text-sm text-clay-ink">{a.action}</div>
              <div className="text-xs text-clay-ink/60">
                {a.entity_type ?? ''} {a.entity_id ? a.entity_id.slice(0, 8) : ''} · {new Date(a.created_at).toLocaleString()}
              </div>
            </ClayCard>
          ))}
        </div>
      )}
    </div>
  );
}

// branchId fixed to the caller's own branch, same as the app — single-branch
// system currently, and profiles_ins RLS pins an admin's creates to their own
// branch anyway.
function AddEmployeeForm({ role, branchId, onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [empRole, setEmpRole] = useState('staff');
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const assignableRoles = role === 'owner' ? CREATABLE_ROLES : ['staff', 'driver'];

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    if (!branchId) {
      setFormError('No branch on this account — cannot create an employee.');
      return;
    }
    if (!email.trim() || password.length < 6 || !fullName.trim()) {
      setFormError('Name, email, and a password (6+ chars) are required.');
      return;
    }
    setSubmitting(true);
    try {
      await createEmployee({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        role: empRole,
        branchId,
      });
      setEmail(''); setPassword(''); setFullName(''); setPhone('');
      onDone();
    } catch (e2) {
      setFormError(e2.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ClayCard className="p-4 space-y-3">
      <div className="font-display font-bold text-clay-ink flex items-center gap-2">
        <ClayIcon name="users" className="w-4 h-4" /> New employee
      </div>
      <div className="flex gap-2 flex-wrap">
        {assignableRoles.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setEmpRole(r)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold ${empRole === r ? 'clay-btn-primary' : 'clay-raised-sm bg-clay-surface'}`}
          >
            {capitalize(r)}
          </button>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="space-y-2">
        <input className="clay-inset w-full rounded-xl px-4 py-2.5 text-sm" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <input className="clay-inset w-full rounded-xl px-4 py-2.5 text-sm" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" />
        <input className="clay-inset w-full rounded-xl px-4 py-2.5 text-sm" placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input className="clay-inset w-full rounded-xl px-4 py-2.5 text-sm" placeholder="Temporary password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {formError && <p className="text-sm text-clay-danger">{formError}</p>}
        <ClayButton size="sm" disabled={submitting} loading={submitting}>Create account</ClayButton>
      </form>
    </ClayCard>
  );
}
