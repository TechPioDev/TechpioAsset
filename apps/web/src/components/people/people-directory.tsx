'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, AlertTriangle, Check, Copy, Download, Mail, Search, Settings2, UserPlus } from 'lucide-react';
import {
  PERMISSIONS,
  REQUEST_OVERRIDE_LABELS,
  SYSTEM_ROLES,
  deactivateWithAssetsWarning,
  findSodConflicts,
} from '@techpioasset/domain';
import { openOffboardingFor, type OpenTaskRow } from '@/lib/offboarding';
import { apiFetch, apiFetchPage, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { downloadCsv } from '@/lib/download-csv';
import { fetchColleagues, colleagueName } from '@/lib/colleagues';
import { Button, Card, EmptyState, ErrorState, Field, NativeSelect, Skeleton } from '@/components/ui';
import { PersonAvatar } from '@/components/person-avatar';
import { Input } from '@/components/ui/input';
import { SortableHeader } from '@/components/sortable-header';

interface UserRow {
  id: string;
  email: string;
  status: string;
  profile: {
    firstName: string;
    lastName: string;
    jobTitle: string | null;
    employeeNumber: string | null;
    /** v2.22 - null follows the company policy; true allows; false blocks. */
    canRaiseRequests?: boolean | null;
    department: { id: string; name: string } | null;
    office: { id: string; name: string } | null;
    /** v2.26 - who approves this person's requests. */
    manager: {
      id: string;
      email: string;
      profile: { firstName: string; lastName: string } | null;
    } | null;
  } | null;
  roles: { role: { key: string; name: string } }[];
  /** v2.68 - the vendor company a vendor sign-in acts for; null for staff. */
  vendorAccount?: { id: string; name: string } | null;
}

/**
 * Whose accounts a directory lists (v2.68). The owner asked for vendor sign-ins
 * out of People and under a menu of their own: `staff` is everybody except
 * accounts whose only role is Vendor, `vendors` is exactly those.
 */
export type DirectoryAudience = 'staff' | 'vendors';

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'success',
  INVITED: 'info',
  SUSPENDED: 'warning',
  DEACTIVATED: 'muted',
};

function statusLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

/** Columns the API can order by. Role is absent - see toggleSort. */
type SortField = 'name' | 'email' | 'department' | 'status';


function roleLabel(key: string): string {
  return key
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Modal to change a user's roles and account status. Admins only. */
/**
 * Which vendor company a vendor sign-in acts for (v2.68). Everything that
 * account sees - its own products, quotes and orders - is scoped by this link,
 * and until now it could only be set by hand in the database. Saved on its own,
 * at once: it is not a profile detail, and a half-filled form below must not
 * hold it back.
 */
function VendorLinkField({ user }: { user: UserRow }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [linked, setLinked] = useState(user.vendorAccount?.id ?? '');
  const vendors = useQuery({
    queryKey: ['vendors'],
    queryFn: () => apiFetch<{ id: string; name: string }[]>('/vendors'),
  });
  const link = useMutation({
    mutationFn: (vendorId: string | null) =>
      apiFetch(`/users/${user.id}/vendor`, { method: 'PATCH', body: { vendorId } }),
    onSuccess: (_data, vendorId) => {
      toast.success(vendorId ? 'Linked to the vendor' : 'Unlinked from the vendor');
      void queryClient.invalidateQueries({ queryKey: ['people'] });
    },
    onError: (e: Error) => {
      setLinked(user.vendorAccount?.id ?? '');
      toast.error(e.message || 'Could not change the vendor link');
    },
  });
  return (
    <div className="mt-4">
      <Field label="Vendor company" htmlFor="pm-vendor">
        <NativeSelect
          id="pm-vendor"
          value={linked}
          disabled={link.isPending || vendors.isPending}
          onChange={(e) => {
            setLinked(e.target.value);
            link.mutate(e.target.value || null);
          }}
        >
          <option value="">Not linked</option>
          {(vendors.data ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
        This sign-in sees only that vendor&apos;s own products, quotes and orders. Saved as soon as
        you choose; it applies from their next sign-in.
      </p>
    </div>
  );
}

function ManageUserModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { can, user: me, impersonate } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canRoles = can(PERMISSIONS.ROLES_MANAGE);
  const canStatus = can(PERMISSIONS.USERS_MANAGE);
  const canEmployees = can(PERMISSIONS.EMPLOYEES_CREATE);
  const isSelf = me?.id === user.id;
  // Sign-in-as: active non-Super-Admin accounts only; the server enforces both.
  const canImpersonate =
    can(PERMISSIONS.USERS_IMPERSONATE) &&
    !isSelf &&
    user.status === 'ACTIVE' &&
    !user.roles.some((r) => r.role.key === 'SUPER_ADMIN');
  const name = user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.email;

  const [roleKeys, setRoleKeys] = useState<string[]>(user.roles.map((r) => r.role.key));
  const [error, setError] = useState<string | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  // WS-G — the tenant's full role list (system + custom) with each role's
  // permission keys, so the picker offers custom roles and can compute live
  // SoD warnings over the union of the selection. Falls back to system roles
  // if the fetch fails so the modal never goes blank.
  const tenantRoles = useQuery({
    queryKey: ['roles'],
    enabled: canRoles,
    queryFn: () =>
      apiFetch<{ key: string; name: string; isSystem: boolean; permissions: string[] }[]>('/roles'),
    staleTime: 60_000,
  });
  const roleOptions =
    tenantRoles.data ??
    SYSTEM_ROLES.map((key) => ({ key, name: roleLabel(key), isSystem: true, permissions: [] }));
  const sodConflicts = findSodConflicts(
    roleOptions.filter((r) => roleKeys.includes(r.key)).flatMap((r) => r.permissions),
  );
  // Saving a conflicting combination requires an explicit acknowledgment
  // (RBAC-024); a changed conflict set is a new decision, so the tick resets.
  const [sodAcknowledged, setSodAcknowledged] = useState(false);
  const sodKey = sodConflicts.map((c) => c.id).join('|');
  useEffect(() => {
    setSodAcknowledged(false);
  }, [sodKey]);
  const sodBlocked = sodConflicts.length > 0 && !sodAcknowledged;

  // Escape goes through the same guard as the Close button. Otherwise the
  // quickest way out of the drawer is also the one that discards edits without
  // asking - and it is the exit people reach for by reflex.
  const closeGuardedRef = useRef<() => void>(() => onClose());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeGuardedRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['people'] });
  };
  const onError = (caught: unknown) => {
    const message =
      caught instanceof ApiError
        ? (caught.problem.detail ?? caught.problem.title)
        : 'Something went wrong.';
    setError(message);
    toast.error(message);
  };

  /**
   * One save for the whole drawer (v2.27).
   *
   * There were two - "Save details" above the roles section, "Save roles"
   * below it - and each discarded the other's edits without a word. Setting a
   * line manager and then pressing the lower, more prominent button threw the
   * manager away silently. That is not hypothetical: it happened repeatedly on
   * production, and every time the screen looked like it had saved.
   *
   * Only what actually changed is sent, so correcting a job title does not
   * rewrite someone's roles - which would delete and recreate every grant and
   * land in the audit trail as a role change that nobody made.
   */
  const save = useMutation({
    mutationFn: async () => {
      if (canStatus && detailsDirty) {
        await apiFetch(`/users/${user.id}/profile`, { method: 'PATCH', body: detailsBody() });
      }
      if (canRoles && rolesDirty) {
        await apiFetch(`/users/${user.id}/roles`, { method: 'PATCH', body: { roleKeys } });
      }
    },
    onSuccess: () => {
      setError(null);
      invalidate();
      toast.success(`${name}'s changes saved`);
      onClose();
    },
    onError,
  });

  const setStatus = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/users/${user.id}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: (_data, status) => {
      setError(null);
      invalidate();
      toast.success(status === 'ACTIVE' ? `${name} activated` : `${name} deactivated`);
      onClose();
    },
    onError,
  });

  // Deactivating removes someone's access — gate it behind an explicit confirm.
  // When equipment is still out the confirm says so and points at Offboard,
  // which records each return; the server still allows a plain deactivate.
  const deactivate = async () => {
    const assetsOut = await apiFetchPage(`/assets?assignedUserId=${user.id}&pageSize=1`)
      .then((r) => r.meta.page.totalItems)
      .catch(() => 0);
    const warning = deactivateWithAssetsWarning(assetsOut);
    const ok = await confirm({
      title: `Deactivate ${name}?`,
      body:
        (warning ? `${warning} ` : '') +
        'They will lose access immediately and cannot sign in until reactivated. Their records and asset history are kept.',
      confirmLabel: warning ? 'Deactivate anyway' : 'Deactivate',
      destructive: true,
    });
    if (ok) setStatus.mutate('DEACTIVATED');
  };

  // Details the admin may set (PATCH /users/:id/profile). Department and
  // office matter beyond cosmetics: department feeds the DEPARTMENT data
  // scope, which is exactly why users cannot set these on themselves.
  const [details, setDetails] = useState({
    firstName: user.profile?.firstName ?? '',
    lastName: user.profile?.lastName ?? '',
    jobTitle: user.profile?.jobTitle ?? '',
    employeeNumber: user.profile?.employeeNumber ?? '',
    departmentId: user.profile?.department?.id ?? '',
    officeId: user.profile?.office?.id ?? '',
    managerId: user.profile?.manager?.id ?? '',
    // '' means inherit the company setting; 'allow' and 'block' are exceptions.
    requests:
      user.profile?.canRaiseRequests === true
        ? 'allow'
        : user.profile?.canRaiseRequests === false
          ? 'block'
          : '',
  });
  const departments = useQuery({
    queryKey: ['departments'],
    enabled: canStatus,
    queryFn: () => apiFetch<{ id: string; name: string }[]>('/departments'),
    staleTime: 60_000,
  });
  const offices = useQuery({
    queryKey: ['offices'],
    enabled: canStatus,
    queryFn: () => apiFetch<{ id: string; name: string }[]>('/offices'),
    staleTime: 60_000,
  });
  // Candidate line managers: every active colleague. Anyone may be somebody's
  // manager - the approval step checks authority at decide time, so the picker
  // does not second-guess who is "senior enough".
  const colleagues = useQuery({
    queryKey: ['colleagues'],
    enabled: canStatus,
    queryFn: fetchColleagues,
    staleTime: 60_000,
  });

  const detailsBody = () => ({
    firstName: details.firstName.trim(),
    lastName: details.lastName.trim(),
    jobTitle: details.jobTitle.trim() || null,
    employeeNumber: details.employeeNumber.trim() || null,
    ...(details.departmentId ? { departmentId: details.departmentId } : {}),
    ...(details.officeId ? { officeId: details.officeId } : {}),
    // Sent unconditionally, unlike department and office above: clearing a
    // line manager has to be possible, and the omit-when-empty pattern can
    // only ever set one.
    managerId: details.managerId || null,
    canRaiseRequests:
      details.requests === 'allow' ? true : details.requests === 'block' ? false : null,
  });

  // Sign in as this user: the provider swaps the in-memory token; the
  // admin's refresh cookie survives, so the session self-restores on expiry.
  const signInAs = useMutation({
    mutationFn: () => impersonate(user.id),
    onSuccess: () => {
      toast.success(`Now viewing as ${name} — 15 minutes max`);
      onClose();
    },
    onError,
  });

  // Re-send an invitation: fresh 7-day link, the old one dies. The returned
  // link is shown inline once, same hand-over story as the original invite.
  const [resentUrl, setResentUrl] = useState<string | null>(null);
  const resend = useMutation({
    mutationFn: () =>
      apiFetch<{ email: string; inviteUrl: string }>(`/users/${user.id}/resend-invite`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (data) => {
      setError(null);
      setResentUrl(data.inviteUrl);
      toast.success(`Invitation re-sent to ${data.email}`);
    },
    onError,
  });

  // Soft delete: the account vanishes from lists and cannot sign in, but the
  // row - and with it every "who had that laptop when" answer - stays.
  const removeUser = useMutation({
    mutationFn: () => apiFetch(`/users/${user.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setError(null);
      invalidate();
      toast.success(`${name} deleted — their asset history is retained`);
      onClose();
    },
    onError,
  });
  const deleteUser = async () => {
    const ok = await confirm({
      title: `Delete ${name}?`,
      body: 'They disappear from People and can never sign in again. Their asset assignment history and audit trail are kept, so past laptop custody stays answerable. Refused if equipment is still assigned to them.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) removeUser.mutate();
  };

  const toggleRole = (key: string) =>
    setRoleKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  // What the drawer opened with, captured on first render. Comparing against
  // this is what makes "unsaved" meaningful, and it keeps a section nobody
  // touched from being written back over the top of itself.
  const opened = useRef({ details, roles: [...roleKeys].sort().join(',') }).current;
  const detailsDirty = JSON.stringify(details) !== JSON.stringify(opened.details);
  const rolesDirty = [...roleKeys].sort().join(',') !== opened.roles;

  const busy =
    save.isPending || setStatus.isPending || removeUser.isPending || resend.isPending;

  /**
   * Nothing is saved until the one button is pressed, so the drawer has to know
   * what is still only on screen - both to enable that button and to stop a
   * close from throwing the edits away in silence.
   */
  const dirty = detailsDirty || rolesDirty;
  const namesMissing = !details.firstName.trim() || !details.lastName.trim();
  // Roles cannot be emptied, and a flagged conflict has to be acknowledged
  // first - but only when roles are actually part of what is being saved.
  const blocked =
    (rolesDirty && (roleKeys.length === 0 || sodBlocked)) || (detailsDirty && namesMissing);

  const closeGuarded = async () => {
    if (!dirty) return onClose();
    const ok = await confirm({
      title: 'Discard your changes?',
      body: `Your edits to ${name} have not been saved yet. Closing now loses them.`,
      confirmLabel: 'Discard',
      destructive: true,
    });
    if (ok) onClose();
  };
  closeGuardedRef.current = () => void closeGuarded();

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Manage ${name}`}
      onClick={() => void closeGuarded()}
    >
      <Card
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto p-5"
        // Stop backdrop clicks inside the card from closing the modal.
      >
        <div ref={trapRef} onClick={(e) => e.stopPropagation()}>
          <h2 className="text-[15px] font-semibold">Manage {name}</h2>
          <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">{user.email}</p>

          {canStatus ? (
            <fieldset className="mt-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                Details
              </legend>
              {/* v2.26 - every control carries a visible label, like the rest
                  of the app. They were placeholder-only, so the moment a field
                  had a value there was nothing left to say what it was: "Ravi |
                  Menon | Field Engineer | EMP-0008 | Engineering | Mohali" and
                  no headings. The two selects had to repeat their own label
                  inside all 148 options to compensate. */}
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="First name" htmlFor="pm-first">
                  <Input
                    id="pm-first"
                    value={details.firstName}
                    onChange={(e) => setDetails((d) => ({ ...d, firstName: e.target.value }))}
                  />
                </Field>
                <Field label="Last name" htmlFor="pm-last">
                  <Input
                    id="pm-last"
                    value={details.lastName}
                    onChange={(e) => setDetails((d) => ({ ...d, lastName: e.target.value }))}
                  />
                </Field>
                <Field label="Job title" htmlFor="pm-title">
                  <Input
                    id="pm-title"
                    value={details.jobTitle}
                    onChange={(e) => setDetails((d) => ({ ...d, jobTitle: e.target.value }))}
                  />
                </Field>
                <Field label="Employee number" htmlFor="pm-empno">
                  <Input
                    id="pm-empno"
                    value={details.employeeNumber}
                    onChange={(e) => setDetails((d) => ({ ...d, employeeNumber: e.target.value }))}
                  />
                </Field>
                <Field label="Department" htmlFor="pm-dept">
                  <NativeSelect
                    className="w-full"
                    id="pm-dept"
                    value={details.departmentId}
                    onChange={(e) => setDetails((d) => ({ ...d, departmentId: e.target.value }))}
                  >
                    <option value="">No department</option>
                    {(departments.data ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Office" htmlFor="pm-office">
                  <NativeSelect
                    className="w-full"
                    id="pm-office"
                    value={details.officeId}
                    onChange={(e) => setDetails((d) => ({ ...d, officeId: e.target.value }))}
                  >
                    <option value="">No office</option>
                    {(offices.data ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                {/* Full width: the names are long, and a half-width select
                    truncates them to ambiguity. */}
                <div className="sm:col-span-2">
                  <Field
                    label="Line manager"
                    htmlFor="pm-manager"
                    hint="Who approves this person's requests. With nobody named, approvals fall back to whoever holds the Manager role."
                  >
                    <NativeSelect
                      className="w-full"
                      id="pm-manager"
                      value={details.managerId}
                      onChange={(e) => setDetails((d) => ({ ...d, managerId: e.target.value }))}
                    >
                      <option value="">Not set</option>
                      {(colleagues.data ?? [])
                        .filter((c) => c.id !== user.id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {colleagueName(c)}
                          </option>
                        ))}
                    </NativeSelect>
                  </Field>
                </div>
                {/* v2.22 - the per-person exception to the company's request
                    policy. Most people inherit; this is for the individual
                    cases the company setting cannot express. */}
                <div className="sm:col-span-2">
                  <Field label="Can raise requests" htmlFor="pm-requests">
                    <NativeSelect
                      className="w-full"
                      id="pm-requests"
                      value={details.requests}
                      onChange={(e) => setDetails((d) => ({ ...d, requests: e.target.value }))}
                    >
                      <option value="">{REQUEST_OVERRIDE_LABELS.inherit}</option>
                      <option value="allow">{REQUEST_OVERRIDE_LABELS.allow}</option>
                      <option value="block">{REQUEST_OVERRIDE_LABELS.block}</option>
                    </NativeSelect>
                  </Field>
                </div>
              </div>
            </fieldset>
          ) : null}

          {can(PERMISSIONS.USERS_MANAGE) && user.roles.some((r) => r.role.key === 'VENDOR') ? (
            <VendorLinkField user={user} />
          ) : null}

          {canRoles ? (
            <fieldset className="mt-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                Roles
              </legend>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {/* Super Admin is not an option: there is exactly one, and the
                    server refuses to grant it. For the account that holds it,
                    the box renders ticked and locked - the same server refuses
                    to orphan the tenant by removing it. */}
                {roleOptions
                  .filter((r) => r.key !== 'SUPER_ADMIN' || roleKeys.includes('SUPER_ADMIN'))
                  .map((r) => (
                  <label key={r.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={roleKeys.includes(r.key)}
                      disabled={r.key === 'SUPER_ADMIN'}
                      onChange={() => toggleRole(r.key)}
                      className="size-4 rounded border-[var(--color-border-strong)]"
                    />
                    <span className="min-w-0 truncate">{r.name}</span>
                    {!r.isSystem ? (
                      <span className="rounded-full bg-[var(--color-brand)]/10 px-1.5 text-[10px] font-semibold text-[var(--color-brand)]">
                        custom
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
              {sodConflicts.length > 0 ? (
                <div
                  role="alert"
                  className="mt-3 rounded-[var(--radius-card)] border border-[var(--tone-warning-fg)]/30 bg-[var(--tone-warning-bg)] p-2.5"
                >
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--tone-warning-fg)]">
                    <AlertTriangle className="size-3.5" />
                    Segregation-of-duties warning
                  </p>
                  <ul className="mt-1.5 grid gap-1">
                    {sodConflicts.map((c) => (
                      <li key={c.id} className="text-[11.5px] leading-snug text-[var(--tone-warning-fg)]">
                        {c.reason}
                      </li>
                    ))}
                  </ul>
                  <label className="mt-2 flex items-start gap-2 text-[11.5px] font-medium text-[var(--tone-warning-fg)]">
                    <input
                      type="checkbox"
                      checked={sodAcknowledged}
                      onChange={(e) => setSodAcknowledged(e.target.checked)}
                      className="mt-0.5 size-3.5 accent-[var(--tone-warning-fg)]"
                    />
                    I understand this combination conflicts, and I accept the risk.
                  </label>
                </div>
              ) : null}
            </fieldset>
          ) : null}

          {canStatus ? (
            <div className="mt-5 border-t border-[var(--color-border)] pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                Account status
              </p>
              <p className="mt-1 text-sm text-[var(--color-content-muted)]">
                Currently <span className="font-medium">{statusLabel(user.status)}</span>.
              </p>
              {isSelf ? (
                <p className="mt-2 text-xs text-[var(--color-content-subtle)]">
                  You cannot change your own account status.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {canImpersonate ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={signInAs.isPending}
                      disabled={busy}
                      onClick={() => signInAs.mutate()}
                    >
                      Sign in as {user.profile?.firstName ?? 'user'}
                    </Button>
                  ) : null}
                  {user.status === 'INVITED' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={resend.isPending}
                      disabled={busy}
                      onClick={() => resend.mutate()}
                    >
                      Resend invitation
                    </Button>
                  ) : null}
                  {user.status !== 'ACTIVE' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setStatus.mutate('ACTIVE')}
                    >
                      Activate
                    </Button>
                  ) : null}
                  {user.status !== 'DEACTIVATED' ? (
                    <Button size="sm" variant="danger" disabled={busy} onClick={deactivate}>
                      Deactivate
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="danger"
                    loading={removeUser.isPending}
                    disabled={busy}
                    onClick={deleteUser}
                  >
                    Delete
                  </Button>
                </div>
              )}
              {resentUrl ? (
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-2 py-1.5 text-xs">
                    {resentUrl}
                  </code>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      await navigator.clipboard.writeText(resentUrl);
                      toast.success('Link copied');
                    }}
                  >
                    <Copy aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              ) : null}
              {!isSelf ? (
                <p className="mt-2 text-xs text-[var(--color-content-subtle)]">
                  Delete is a soft delete: the account vanishes and cannot sign in, but asset
                  assignment history and the audit trail are kept.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* HR-style managers (employees:create, no users:manage) get exactly
              one action here: re-sending an invitation that went astray. */}
          {!canStatus && canEmployees && user.status === 'INVITED' && !isSelf ? (
            <div className="mt-5 border-t border-[var(--color-border)] pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                Invitation
              </p>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={resend.isPending}
                  disabled={busy}
                  onClick={() => resend.mutate()}
                >
                  Resend invitation
                </Button>
              </div>
              {resentUrl ? (
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-2 py-1.5 text-xs">
                    {resentUrl}
                  </code>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      await navigator.clipboard.writeText(resentUrl);
                      toast.success('Link copied');
                    }}
                  >
                    <Copy aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-control)] border px-3 py-2 text-sm"
              style={{
                color: 'var(--tone-critical-fg)',
                backgroundColor: 'var(--tone-critical-bg)',
                borderColor: 'var(--tone-critical-border)',
              }}
            >
              {error}
            </p>
          ) : null}

          {/* One save, at the bottom, for everything above it. Where the two
              buttons used to sit inside their own sections, which section you
              happened to press decided which of your edits survived. */}
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            {dirty ? (
              <p className="mr-auto text-xs text-[var(--color-content-muted)]">
                Unsaved changes
              </p>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => void closeGuarded()} disabled={busy}>
              Close
            </Button>
            {canStatus || canRoles ? (
              <Button
                size="sm"
                loading={save.isPending}
                disabled={!dirty || blocked || busy}
                title={
                  rolesDirty && sodBlocked
                    ? 'Acknowledge the segregation-of-duties warning first'
                    : undefined
                }
                onClick={() => save.mutate()}
              >
                Save changes
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

/**
 * Invite a new user (v2.12). Least privilege by default: Registered Employee
 * is pre-ticked. On success the modal switches to a hand-over view showing
 * the invite link ONCE, because not every company has email delivery
 * configured and an invite that cannot reach its person is worthless.
 */
function InviteUserModal({
  onClose,
  defaultRoles = ['EMPLOYEE'],
}: {
  onClose: () => void;
  /** Pre-ticked roles: Employee for people, Vendor from the vendor accounts page. */
  defaultRoles?: string[];
}) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  // HR-style inviters (employees:create without users:manage) may only invite
  // Registered Employees - the server enforces it; the form says it upfront.
  const isFullManager = can(PERMISSIONS.USERS_MANAGE);

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    jobTitle: '',
    departmentId: '',
    officeId: '',
  });
  const [roleKeys, setRoleKeys] = useState<string[]>(defaultRoles);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; inviteUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const tenantRoles = useQuery({
    queryKey: ['roles'],
    queryFn: () =>
      apiFetch<{ key: string; name: string; isSystem: boolean; permissions: string[] }[]>('/roles'),
    staleTime: 60_000,
  });
  const roleOptions =
    tenantRoles.data ??
    SYSTEM_ROLES.map((key) => ({ key, name: roleLabel(key), isSystem: true, permissions: [] }));
  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => apiFetch<{ id: string; name: string }[]>('/departments'),
    staleTime: 60_000,
  });
  const offices = useQuery({
    queryKey: ['offices'],
    queryFn: () => apiFetch<{ id: string; name: string }[]>('/offices'),
    staleTime: 60_000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const invite = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; email: string; inviteUrl: string }>('/users/invite', {
        method: 'POST',
        body: {
          email: form.email.trim(),
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          jobTitle: form.jobTitle.trim() || null,
          ...(form.departmentId ? { departmentId: form.departmentId } : {}),
          ...(form.officeId ? { officeId: form.officeId } : {}),
          roleKeys,
        },
      }),
    onSuccess: (data) => {
      setError(null);
      setResult({ email: data.email, inviteUrl: data.inviteUrl });
      void queryClient.invalidateQueries({ queryKey: ['people'] });
    },
    onError: (caught) => {
      const message =
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'Something went wrong.';
      setError(message);
      toast.error(message);
    },
  });

  const toggleRole = (key: string) =>
    setRoleKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const canSubmit =
    form.firstName.trim() && form.lastName.trim() && /\S+@\S+\.\S+/.test(form.email) && roleKeys.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Invite user"
      onClick={onClose}
    >
      <Card className="max-h-[85vh] w-full max-w-lg overflow-y-auto p-5">
        <div ref={trapRef} onClick={(e) => e.stopPropagation()}>
          {result ? (
            <>
              <h2 className="text-[15px] font-semibold">Invitation created</h2>
              <p className="mt-1 text-sm text-[var(--color-content-muted)]">
                {result.email} has been emailed an invitation. The same link is below —{' '}
                <span className="font-medium">it is shown only once</span>, so copy it now if you
                want to hand it over yourself (chat, in person). It works for 7 days, once.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-2 text-xs">
                  {result.inviteUrl}
                </code>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(result.inviteUrl);
                    setCopied(true);
                    toast.success('Link copied');
                  }}
                >
                  {copied ? (
                    <Check aria-hidden="true" className="size-4" />
                  ) : (
                    <Copy aria-hidden="true" className="size-4" />
                  )}
                </Button>
              </div>
              <p className="mt-3 text-xs text-[var(--color-content-subtle)]">
                The account shows as Invited in People until the person sets their password.
              </p>
              <div className="mt-4 flex justify-end">
                <Button size="sm" onClick={onClose}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-[15px] font-semibold">Invite a new user</h2>
              <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">
                They receive a link to set their own password. Nobody ever types a password for
                someone else.
              </p>

              {/* Same labelling as the manage panel above - these were
                  placeholder-only too, so a half-filled invite showed six
                  boxes and no way to tell which was which. */}
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="First name" htmlFor="iu-first">
                  <Input id="iu-first" value={form.firstName} onChange={set('firstName')} />
                </Field>
                <Field label="Last name" htmlFor="iu-last">
                  <Input id="iu-last" value={form.lastName} onChange={set('lastName')} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Work email" htmlFor="iu-email" hint="Where their invitation link is sent.">
                    <Input id="iu-email" type="email" value={form.email} onChange={set('email')} />
                  </Field>
                </div>
                <Field label="Job title" htmlFor="iu-title" hint="Optional">
                  <Input id="iu-title" value={form.jobTitle} onChange={set('jobTitle')} />
                </Field>
                <Field label="Department" htmlFor="iu-dept">
                  <NativeSelect
                    id="iu-dept"
                    className="w-full"
                    value={form.departmentId}
                    onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
                  >
                    <option value="">No department</option>
                    {(departments.data ?? []).map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Office" htmlFor="iu-office">
                    <NativeSelect
                      id="iu-office"
                      className="w-full"
                      value={form.officeId}
                      onChange={(e) => setForm((f) => ({ ...f, officeId: e.target.value }))}
                    >
                      <option value="">No office</option>
                      {(offices.data ?? []).map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
              </div>

              <fieldset className="mt-4">
                <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                  Roles
                </legend>
                {isFullManager ? (
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {/* No Super Admin here either: an invitation can never
                        create a second one. */}
                    {roleOptions
                      .filter((r) => r.key !== 'SUPER_ADMIN')
                      .map((r) => (
                      <label key={r.key} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={roleKeys.includes(r.key)}
                          onChange={() => toggleRole(r.key)}
                          className="size-4 rounded border-[var(--color-border-strong)]"
                        />
                        <span className="min-w-0 truncate">{r.name}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-[var(--color-content-muted)]">
                    Invited as <span className="font-medium">Registered Employee</span>. Other
                    roles are granted afterwards by a user manager.
                  </p>
                )}
              </fieldset>

              {error ? (
                <p
                  role="alert"
                  className="mt-4 rounded-[var(--radius-control)] border px-3 py-2 text-sm"
                  style={{
                    color: 'var(--tone-critical-fg)',
                    backgroundColor: 'var(--tone-critical-bg)',
                    borderColor: 'var(--tone-critical-border)',
                  }}
                >
                  {error}
                </p>
              ) : null}

              <div className="mt-5 flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={onClose} disabled={invite.isPending}>
                  Cancel
                </Button>
                <Button size="sm" loading={invite.isPending} disabled={!canSubmit} onClick={() => invite.mutate()}>
                  Send invitation
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

function PeopleTable({ audience }: { audience: DirectoryAudience }) {
  const vendorsOnly = audience === 'vendors';
  const { can } = useAuth();
  const toast = useToast();
  const canManage =
    can(PERMISSIONS.USERS_MANAGE) || can(PERMISSIONS.ROLES_MANAGE) || can(PERMISSIONS.EMPLOYEES_CREATE);
  // A profile page's Manage button arrives as /people?q=<email>&manage=1 -
  // honour the filter and open the panel for that person straight away.
  const urlParams = useSearchParams();
  const initialQ = urlParams.get('q') ?? '';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(initialQ);
  const [q, setQ] = useState(initialQ);
  const [role, setRole] = useState('');
  const [view, setView] = useState<'active' | 'deactivated'>('active');
  const [sort, setSort] = useState<SortField | null>(null);
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [managing, setManaging] = useState<UserRow | null>(null);
  const [autoManaged, setAutoManaged] = useState(false);
  const [inviting, setInviting] = useState(false);
  const canInvite = can(PERMISSIONS.USERS_MANAGE) || can(PERMISSIONS.EMPLOYEES_CREATE);
  const queryClient = useQueryClient();
  const confirmDialog = useConfirm();
  const inviteAll = useMutation({
    mutationFn: () =>
      apiFetch<{ pending: number; sent: number; failed: string[] }>('/users/invite-all-pending', {
        method: 'POST',
        body: {},
      }),
    onSuccess: (r) => {
      if (r.pending === 0) toast.success('Nobody is pending - every account is already active.');
      else if (r.failed.length === 0) toast.success(`Invitations sent to ${r.sent} people.`);
      else toast.error(`Sent ${r.sent}, failed for: ${r.failed.join(', ')}`);
      void queryClient.invalidateQueries({ queryKey: ['people'] });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not send invitations'),
  });

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // v2.21 - click a heading to sort by it, click again to reverse. Role is not
  // sortable: a person can hold several, so there is no single value to order by.
  const toggleSort = (field: SortField) => {
    if (sort === field) {
      setOrder(order === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(field);
      setOrder('asc');
    }
    setPage(1);
  };

  const query = new URLSearchParams({ page: String(page), pageSize: '25', view, audience });
  if (q) query.set('q', q);
  if (role) query.set('role', role);
  if (sort) {
    query.set('sort', sort);
    query.set('order', order);
  }

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['people', audience, q, role, view, page, sort, order],
    queryFn: () => apiFetchPage<UserRow>(`/users?${query.toString()}`),
  });
  // Who is mid-offboarding, so the row says so before anyone opens Manage and
  // deactivates over the top of a checklist somebody else is working through.
  const openTasks = useQuery({
    queryKey: ['offboarding-open'],
    queryFn: () => apiFetch<OpenTaskRow[]>('/lifecycle/tasks?direction=OFFBOARDING&status=OPEN'),
    enabled: can(PERMISSIONS.EMPLOYEES_READ),
    retry: false,
  });

  // Open the Manage panel for the person the URL asked about - once, and only
  // when the filter resolves them unambiguously.
  useEffect(() => {
    if (autoManaged || urlParams.get('manage') !== '1' || !canManage || !data) return;
    const wanted = (urlParams.get('q') ?? '').toLowerCase();
    const match =
      data.data.length === 1
        ? data.data[0]
        : data.data.find((u) => u.email.toLowerCase() === wanted);
    if (match) {
      setManaging(match);
      setAutoManaged(true);
    }
  }, [autoManaged, urlParams, canManage, data]);

  const hasFilters = q !== '' || role !== '';

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {vendorsOnly ? 'Vendor accounts' : 'People'}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {vendorsOnly && view !== 'deactivated'
              ? 'Sign-ins that belong to your vendors. Each sees only its own products, quotes and orders. They are not listed under People.'
              : view === 'deactivated'
              ? 'Deactivated accounts. They keep their history but cannot sign in.'
              : canManage
                ? 'Everyone you can see. Manage roles and access from here.'
                : 'Everyone you are permitted to see.'}
          </p>
        </div>
        {/* Deactivated accounts get their own view instead of padding the
            default list with people who cannot sign in. */}
        <div
          role="radiogroup"
          aria-label="Which accounts to show"
          className="inline-flex rounded-[var(--radius-control)] border border-[var(--color-border-strong)] p-0.5"
        >
          {(
            [
              { value: 'active', label: 'Active' },
              { value: 'deactivated', label: 'Deactivated' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={view === opt.value}
              onClick={() => {
                setView(opt.value);
                setPage(1);
              }}
              className={
                view === opt.value
                  ? 'rounded-[calc(var(--radius-control)-2px)] bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-[var(--color-brand-contrast)]'
                  : 'rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 text-sm text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]'
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--color-content-subtle)]"
          />
          <Input
            type="search"
            aria-label="Search people"
            placeholder="Search by name, email or employee number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {/* Every account on the vendor page holds the one role, so there is
            nothing to filter by; and Vendor is not a filter on People, where an
            account that holds only it no longer appears. */}
        {vendorsOnly ? null : (
        <NativeSelect
          aria-label="Filter by role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
          className="bg-[var(--color-surface)]"
        >
          <option value="">All roles</option>
          {SYSTEM_ROLES.filter((key) => key !== 'VENDOR').map((key) => (
            <option key={key} value={key}>
              {roleLabel(key)}
            </option>
          ))}
        </NativeSelect>
        )}
        {hasFilters ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSearch('');
              setQ('');
              setRole('');
              setPage(1);
            }}
          >
            Clear
          </Button>
        ) : null}
        <button
          type="button"
          onClick={async () => {
            const p = new URLSearchParams({ audience });
            if (q) p.set('q', q);
            if (role) p.set('role', role);
            const ok = await downloadCsv(
              `/users/export${p.toString() ? `?${p}` : ''}`,
              vendorsOnly ? 'vendor-accounts.csv' : 'people.csv',
            );
            if (ok) toast.success('Export downloaded');
            else toast.error('Could not export');
          }}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
        >
          <Download aria-hidden="true" className="size-4" />
          Export
        </button>
        {can(PERMISSIONS.USERS_MANAGE) ? (
          <Link
            href="/people/invitations"
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
          >
            <Mail aria-hidden="true" className="size-4" />
            Invitations
          </Link>
        ) : null}
        {canInvite ? (
          <Button
            variant="secondary"
            loading={inviteAll.isPending}
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Send invitations to everyone pending?',
                body: 'Every account still in the Invited state gets the invitation email with a fresh link. Links they already received stop working - only the newest link counts.',
                confirmLabel: 'Send to all',
              });
              if (ok) inviteAll.mutate();
            }}
          >
            <Send aria-hidden="true" className="mr-1.5 size-4" />
            Invite all pending
          </Button>
        ) : null}
        {canInvite ? (
          <Button onClick={() => setInviting(true)}>
            <UserPlus aria-hidden="true" className="mr-1.5 size-4" />
            Invite user
          </Button>
        ) : null}
      </div>

      <Card>
        {isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load people" detail={(error as Error).message} />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No people found"
            description={hasFilters ? 'Try clearing the filters.' : 'No one is visible to you yet.'}
          />
        ) : (
          <>
          {/* v2.70 - on a phone each account is a card. The table put Manage
              in a sixth column, two screens to the right; here it is on the
              card. Sorting moves to a select, since there are no headings
              to press. */}
          <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2 sm:hidden">
            <label htmlFor="people-sort" className="text-xs text-[var(--color-content-muted)]">
              Sort by
            </label>
            <NativeSelect
              id="people-sort"
              value={sort ?? ''}
              onChange={(e) => {
                setSort((e.target.value || null) as SortField | null);
                setOrder('asc');
                setPage(1);
              }}
              className="bg-[var(--color-surface)]"
            >
              <option value="">Default order</option>
              <option value="name">Name</option>
              <option value="email">Email</option>
              {vendorsOnly ? null : <option value="department">Department</option>}
              <option value="status">Status</option>
            </NativeSelect>
          </div>
          <ul className="divide-y divide-[var(--color-border)] sm:hidden">
            {data.data.map((person) => {
              const name = person.profile
                ? `${person.profile.firstName} ${person.profile.lastName}`
                : null;
              const affiliation = vendorsOnly
                ? (person.vendorAccount?.name ?? 'Not linked')
                : (person.profile?.department?.name ?? null);
              return (
                <li key={person.id} className="flex items-start gap-3 px-4 py-3">
                  <PersonAvatar name={name} email={person.email} size={36} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/people/${person.id}`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {name ?? person.email}
                    </Link>
                    <p className="truncate text-xs text-[var(--color-content-muted)]">{person.email}</p>
                    <p className="mt-1 truncate text-xs text-[var(--color-content-subtle)]">
                      {[person.roles.map((r) => r.role.name).join(', '), affiliation]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{
                          color: `var(--tone-${STATUS_TONE[person.status] ?? 'muted'}-fg)`,
                          backgroundColor: `var(--tone-${STATUS_TONE[person.status] ?? 'muted'}-bg)`,
                        }}
                      >
                        {statusLabel(person.status)}
                      </span>
                      {openOffboardingFor(openTasks.data, person.id) ? (
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{
                            color: 'var(--tone-warning-fg)',
                            backgroundColor: 'var(--tone-warning-bg)',
                          }}
                        >
                          Offboarding in progress
                        </span>
                      ) : null}
                    </p>
                  </div>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => setManaging(person)}
                      aria-label={`Manage ${name ?? person.email}`}
                      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-xs font-medium active:bg-[var(--color-surface-sunken)]"
                    >
                      <Settings2 aria-hidden="true" className="size-4" />
                      Manage
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <caption className="sr-only">
                People, {data.meta.page.totalItems} in total, page {data.meta.page.page} of{' '}
                {data.meta.page.totalPages}
              </caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <SortableHeader label="Name" field="name" sort={sort} order={order} onSort={toggleSort} />
                  <SortableHeader label="Email" field="email" sort={sort} order={order} onSort={toggleSort} />
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Role
                  </th>
                  {vendorsOnly ? (
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Vendor company
                    </th>
                  ) : (
                    <SortableHeader label="Department" field="department" sort={sort} order={order} onSort={toggleSort} />
                  )}
                  <SortableHeader label="Status" field="status" sort={sort} order={order} onSort={toggleSort} />
                  {canManage ? (
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.data.map((person) => (
                  <tr key={person.id} className="hover:bg-[var(--color-surface-sunken)]">
                    <td className="px-4 py-2.5 font-medium">
                      <Link
                        href={`/people/${person.id}`}
                        className="inline-flex items-center gap-2.5 hover:underline"
                      >
                        {/* Initials, not a stock face - see person-avatar.tsx. */}
                        <PersonAvatar
                          name={
                            person.profile
                              ? `${person.profile.firstName} ${person.profile.lastName}`
                              : null
                          }
                          email={person.email}
                          size={28}
                        />
                        {person.profile
                          ? `${person.profile.firstName} ${person.profile.lastName}`
                          : person.email}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {person.email}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {person.roles.map((r) => r.role.name).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {vendorsOnly
                        ? (person.vendorAccount?.name ?? 'Not linked')
                        : (person.profile?.department?.name ?? '—')}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{
                          color: `var(--tone-${STATUS_TONE[person.status] ?? 'muted'}-fg)`,
                          backgroundColor: `var(--tone-${STATUS_TONE[person.status] ?? 'muted'}-bg)`,
                        }}
                      >
                        {statusLabel(person.status)}
                      </span>
                      {openOffboardingFor(openTasks.data, person.id) ? (
                        <span
                          className="ml-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{
                            color: 'var(--tone-warning-fg)',
                            backgroundColor: 'var(--tone-warning-bg)',
                          }}
                        >
                          Offboarding in progress
                        </span>
                      ) : null}
                    </td>
                    {canManage ? (
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setManaging(person)}
                          className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"
                        >
                          <Settings2 aria-hidden="true" className="size-3.5" />
                          Manage
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      {data && data.meta.page.totalPages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          <p className="text-[var(--color-content-subtle)]">
            Page {data.meta.page.page} of {data.meta.page.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= data.meta.page.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      ) : null}

      {managing ? <ManageUserModal user={managing} onClose={() => setManaging(null)} /> : null}
      {inviting ? (
        <InviteUserModal
          onClose={() => setInviting(false)}
          defaultRoles={vendorsOnly ? ['VENDOR'] : ['EMPLOYEE']}
        />
      ) : null}
    </div>
  );
}

/**
 * The accounts directory, as a page body. Two routes render it: /people
 * (staff) and /vendor-accounts (vendor sign-ins) - one table, one Manage
 * panel and one invite form, so the two never drift apart.
 */
export function PeopleDirectory({ audience = 'staff' }: { audience?: DirectoryAudience }) {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <PeopleTable audience={audience} />
    </Suspense>
  );
}
