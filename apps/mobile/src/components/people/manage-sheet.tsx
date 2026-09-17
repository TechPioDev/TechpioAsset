import { Ionicons } from '@expo/vector-icons';
import { MAX_PAGE_SIZE } from '@techpioasset/contracts';
import { REQUEST_OVERRIDE_LABELS, deactivateWithAssetsWarning } from '@techpioasset/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import {
  colleagueName,
  fallbackRoles,
  fetchAllColleagues,
  initialDetails,
  peopleGates,
  personName,
  profileBody,
  sameDetails,
  sameRoles,
  saveBlocked,
  sodConflictsFor,
  statusLabel,
  toggleKey,
  type Colleague,
  type ManageDetails,
  type RoleOption,
  type UserRow,
} from '../../lib/people-admin';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { ChipPicker } from '../chip-picker';
import { Button, Field } from '../ui';
import { errorText, InviteLink, PeopleSheet, SheetLabel, ToggleChips } from './sheet';

/**
 * Manage one person - the web People page's Manage panel, on the phone.
 *
 * One Save for everything, sending only what changed: the web had two buttons
 * once and each silently threw away the other's edits. Correcting a job title
 * must not rewrite someone's roles either, which would land in the audit trail
 * as a role change nobody made.
 *
 * Sign in as is left to the web - it swaps the session, which the phone's
 * stored sign-in is not built to hand back.
 */

type Named = { id: string; name: string };

const OVERRIDE_OPTIONS: Named[] = [
  { id: 'allow', name: REQUEST_OVERRIDE_LABELS.allow },
  { id: 'block', name: REQUEST_OVERRIDE_LABELS.block },
];

export function ManageSheet({
  user,
  visible,
  onClose,
  onChanged,
  onDeleted,
}: {
  user: UserRow;
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDeleted?: () => void;
}) {
  const { api, user: me } = useSession();
  const { c, spacing } = useTheme();
  const gates = peopleGates(me);
  const { canStatus, canRoles, canEmployees } = gates;
  const isSelf = me?.id === user.id;
  const name = personName(user);

  const [details, setDetails] = useState<ManageDetails>(() => initialDetails(user));
  const [roleKeys, setRoleKeys] = useState<string[]>(() => user.roles.map((r) => r.role.key));
  const [acknowledged, setAcknowledged] = useState(false);
  const [roles, setRoles] = useState<RoleOption[]>(fallbackRoles());
  const [departments, setDepartments] = useState<Named[]>([]);
  const [offices, setOffices] = useState<Named[]>([]);
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [busy, setBusy] = useState<null | 'save' | 'status' | 'resend' | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);
  const [resentUrl, setResentUrl] = useState<string | null>(null);
  // What the sheet opened with - what makes "unsaved" meaningful.
  const opened = useRef({ details: initialDetails(user), roles: user.roles.map((r) => r.role.key) });

  useEffect(() => {
    if (!visible) return;
    const d = initialDetails(user);
    const k = user.roles.map((r) => r.role.key);
    opened.current = { details: d, roles: k };
    setDetails(d);
    setRoleKeys(k);
    setAcknowledged(false);
    setError(null);
    setResentUrl(null);
    if (canRoles) {
      api
        .request<RoleOption[]>('/roles')
        .then((r) => setRoles(r?.length ? r : fallbackRoles()))
        .catch(() => setRoles(fallbackRoles()));
    }
    if (canStatus) {
      api.request<Named[]>('/departments').then((x) => setDepartments(x ?? [])).catch(() => setDepartments([]));
      api.request<Named[]>('/offices').then((x) => setOffices(x ?? [])).catch(() => setOffices([]));
      // Anyone active may be somebody's manager - the approval step checks
      // authority at decide time, so the picker does not second-guess seniority.
      fetchAllColleagues((page, size) =>
        api.request<Colleague[]>(`/users?page=${page}&pageSize=${size}&view=active&sort=name&order=asc`),
      )
        .then(setColleagues)
        .catch(() => setColleagues([]));
    }
  }, [visible, user, api, canRoles, canStatus]);

  const conflicts = useMemo(() => sodConflictsFor(roles, roleKeys), [roles, roleKeys]);
  const conflictKey = conflicts.map((x) => x.id).join('|');
  // A changed conflict set is a new decision, so the tick resets.
  useEffect(() => setAcknowledged(false), [conflictKey]);

  const detailsDirty = canStatus && !sameDetails(details, opened.current.details);
  const rolesDirty = canRoles && !sameRoles(roleKeys, opened.current.roles);
  const dirty = detailsDirty || rolesDirty;
  const blocked = saveBlocked({ details, detailsDirty, roleKeys, rolesDirty, conflicts: conflicts.length, acknowledged });

  const managerOptions = useMemo(
    () => colleagues.filter((x) => x.id !== user.id).map((x) => ({ id: x.id, name: colleagueName(x) })),
    [colleagues, user.id],
  );
  // A manager outside the first pages still has to show as chosen.
  const managerChoices = useMemo(() => {
    const m = user.profile?.manager;
    if (!m || managerOptions.some((o) => o.id === m.id)) return managerOptions;
    return [{ id: m.id, name: m.profile ? `${m.profile.firstName} ${m.profile.lastName}` : m.email }, ...managerOptions];
  }, [managerOptions, user.profile?.manager]);

  const setField = (key: keyof ManageDetails) => (value: string) =>
    setDetails((d) => ({ ...d, [key]: value }));

  const closeGuarded = () => {
    if (!dirty) return onClose();
    Alert.alert('Discard your changes?', `Your edits to ${name} have not been saved yet. Closing now loses them.`, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };

  async function act<T>(kind: NonNullable<typeof busy>, fn: () => Promise<T>, fallback: string): Promise<T | undefined> {
    setBusy(kind);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e, fallback));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  const save = async () => {
    const ok = await act(
      'save',
      async () => {
        if (detailsDirty) {
          await api.request(`/users/${user.id}/profile`, { method: 'PATCH', body: profileBody(details) });
        }
        if (rolesDirty) {
          await api.request(`/users/${user.id}/roles`, { method: 'PATCH', body: { roleKeys } });
        }
        return true;
      },
      'Could not save.',
    );
    if (ok) {
      onChanged();
      onClose();
      Alert.alert('Saved', `${name}'s changes saved`);
    }
  };

  const setStatus = async (status: 'ACTIVE' | 'DEACTIVATED') => {
    const ok = await act(
      'status',
      () => api.request(`/users/${user.id}/status`, { method: 'PATCH', body: { status } }).then(() => true),
      'Could not change the account status.',
    );
    if (ok) {
      onChanged();
      onClose();
    }
  };

  // When equipment is still out the confirm says so and points at Offboard,
  // which records each return; the server still allows a plain deactivate.
  const deactivate = async () => {
    const assetsOut = await api
      .request<{ id: string }[]>(`/assets?assignedUserId=${user.id}&pageSize=${MAX_PAGE_SIZE}`)
      .then((rows) => rows?.length ?? 0)
      .catch(() => 0);
    const warning = deactivateWithAssetsWarning(assetsOut);
    Alert.alert(
      `Deactivate ${name}?`,
      (warning ? `${warning}\n\n` : '') +
        'They will lose access immediately and cannot sign in until reactivated. Their records and asset history are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: warning ? 'Deactivate anyway' : 'Deactivate',
          style: 'destructive',
          onPress: () => void setStatus('DEACTIVATED'),
        },
      ],
    );
  };

  // A fresh 7-day link; the old one dies. Shown inline once.
  const resend = async () => {
    const data = await act(
      'resend',
      () =>
        api.request<{ email: string; inviteUrl: string }>(`/users/${user.id}/resend-invite`, {
          method: 'POST',
          body: {},
        }),
      'Could not resend the invitation.',
    );
    if (data) setResentUrl(data.inviteUrl);
  };

  const remove = () =>
    Alert.alert(
      `Delete ${name}?`,
      'They disappear from People and can never sign in again. Their asset assignment history and audit trail are kept, so past laptop custody stays answerable. Refused if equipment is still assigned to them.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const ok = await act(
              'delete',
              () => api.request(`/users/${user.id}`, { method: 'DELETE' }).then(() => true),
              'Could not delete this person.',
            );
            if (ok) {
              onClose();
              onChanged();
              onDeleted?.();
            }
          },
        },
      ],
    );

  const heading = (text: string) => (
    <Text
      style={{
        color: c.muted,
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        marginBottom: spacing.sm,
        marginTop: spacing.md,
      }}
    >
      {text}
    </Text>
  );

  return (
    <PeopleSheet visible={visible} title={`Manage ${name}`} subtitle={user.email} onClose={closeGuarded}>
      {canStatus ? (
        <>
          {heading('Details')}
          <Field label="First name" value={details.firstName} onChangeText={setField('firstName')} />
          <Field label="Last name" value={details.lastName} onChangeText={setField('lastName')} />
          <Field label="Job title" value={details.jobTitle} onChangeText={setField('jobTitle')} />
          <Field label="Employee number" value={details.employeeNumber} onChangeText={setField('employeeNumber')} />

          <SheetLabel>Department</SheetLabel>
          <View style={{ marginBottom: spacing.lg }}>
            <ChipPicker
              label="Department"
              options={departments}
              value={details.departmentId}
              onChange={setField('departmentId')}
              allowNone
              noneLabel="No department"
            />
          </View>

          <SheetLabel>Office</SheetLabel>
          <View style={{ marginBottom: spacing.lg }}>
            <ChipPicker
              label="Office"
              options={offices}
              value={details.officeId}
              onChange={setField('officeId')}
              allowNone
              noneLabel="No office"
            />
          </View>

          <SheetLabel>Line manager</SheetLabel>
          <Text style={{ color: c.subtle, fontSize: 12, marginBottom: spacing.sm }}>
            Who approves this person&apos;s requests. With nobody named, approvals fall back to whoever
            holds the Manager role.
          </Text>
          <View style={{ marginBottom: spacing.lg }}>
            <ChipPicker
              label="Line manager"
              options={managerChoices}
              value={details.managerId}
              onChange={setField('managerId')}
              allowNone
              noneLabel="Not set"
            />
          </View>

          <SheetLabel>Can raise requests</SheetLabel>
          <View style={{ marginBottom: spacing.lg }}>
            <ChipPicker
              label="Can raise requests"
              options={OVERRIDE_OPTIONS}
              value={details.requests}
              onChange={setField('requests')}
              allowNone
              noneLabel={REQUEST_OVERRIDE_LABELS.inherit}
            />
          </View>
        </>
      ) : null}

      {canRoles ? (
        <>
          {heading('Roles')}
          {/* Super Admin is never offered; on the account that holds it the
              chip shows ticked and locked - the server refuses both moves. */}
          <ToggleChips
            options={roles
              .filter((r) => r.key !== 'SUPER_ADMIN' || roleKeys.includes('SUPER_ADMIN'))
              .map((r) => ({ key: r.key, name: r.name, custom: !r.isSystem }))}
            selected={roleKeys}
            onToggle={(key) => setRoleKeys((prev) => toggleKey(prev, key))}
            locked={(key) => key === 'SUPER_ADMIN'}
          />
          {conflicts.length > 0 ? (
            <View
              accessibilityRole="alert"
              style={{
                marginTop: spacing.md,
                borderWidth: 1,
                borderColor: c.warning,
                borderRadius: 12,
                padding: spacing.md,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="warning-outline" size={16} color={c.warning} />
                <Text style={{ color: c.warning, fontSize: 13, fontWeight: '700' }}>
                  Segregation-of-duties warning
                </Text>
              </View>
              {conflicts.map((x) => (
                <Text key={x.id} style={{ color: c.text, fontSize: 12, marginTop: 6, lineHeight: 17 }}>
                  {x.reason}
                </Text>
              ))}
              <Pressable
                onPress={() => setAcknowledged((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: acknowledged }}
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: spacing.md }}
              >
                <Ionicons name={acknowledged ? 'checkbox' : 'square-outline'} size={20} color={c.warning} />
                <Text style={{ color: c.text, fontSize: 12, fontWeight: '600', flex: 1 }}>
                  I understand this combination conflicts, and I accept the risk.
                </Text>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}

      {canStatus ? (
        <>
          {heading('Account status')}
          <Text style={{ color: c.muted, fontSize: 14, marginBottom: spacing.sm }}>
            Currently <Text style={{ fontWeight: '700', color: c.text }}>{statusLabel(user.status)}</Text>.
          </Text>
          {isSelf ? (
            <Text style={{ color: c.subtle, fontSize: 12 }}>You cannot change your own account status.</Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {user.status === 'INVITED' ? (
                <Button
                  label="Resend invitation"
                  variant="secondary"
                  loading={busy === 'resend'}
                  disabled={busy !== null}
                  onPress={resend}
                />
              ) : null}
              {user.status !== 'ACTIVE' ? (
                <Button
                  label="Activate"
                  variant="secondary"
                  loading={busy === 'status'}
                  disabled={busy !== null}
                  onPress={() => void setStatus('ACTIVE')}
                />
              ) : null}
              {user.status !== 'DEACTIVATED' ? (
                <Button label="Deactivate" variant="danger" disabled={busy !== null} onPress={() => void deactivate()} />
              ) : null}
              <Button
                label="Delete"
                variant="danger"
                loading={busy === 'delete'}
                disabled={busy !== null}
                onPress={remove}
              />
              <Text style={{ color: c.subtle, fontSize: 12 }}>
                Delete is a soft delete: the account vanishes and cannot sign in, but asset assignment
                history and the audit trail are kept.
              </Text>
            </View>
          )}
          {resentUrl ? <InviteLink url={resentUrl} /> : null}
        </>
      ) : null}

      {/* HR-style managers (employees:create, no users:manage) get exactly one
          action: re-sending an invitation that went astray. */}
      {!canStatus && canEmployees && user.status === 'INVITED' && !isSelf ? (
        <>
          {heading('Invitation')}
          <Button
            label="Resend invitation"
            variant="secondary"
            loading={busy === 'resend'}
            disabled={busy !== null}
            onPress={resend}
          />
          {resentUrl ? <InviteLink url={resentUrl} /> : null}
        </>
      ) : null}

      {error ? (
        <Text style={{ color: c.danger, fontSize: 13, marginTop: spacing.md }}>{error}</Text>
      ) : null}

      {canStatus || canRoles ? (
        <View style={{ marginTop: spacing.xl }}>
          {dirty ? (
            <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.sm }}>
              {rolesDirty && conflicts.length > 0 && !acknowledged
                ? 'Acknowledge the segregation-of-duties warning first.'
                : 'Unsaved changes'}
            </Text>
          ) : null}
          <Button
            label="Save changes"
            onPress={save}
            loading={busy === 'save'}
            disabled={!dirty || blocked || busy !== null}
          />
        </View>
      ) : null}
    </PeopleSheet>
  );
}
