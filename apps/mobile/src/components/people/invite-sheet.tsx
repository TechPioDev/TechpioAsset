import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import {
  canSubmitInvite,
  fallbackRoles,
  inviteBody,
  peopleGates,
  toggleKey,
  type RoleOption,
} from '../../lib/people-admin';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { ChipPicker } from '../chip-picker';
import { Button, Field } from '../ui';
import { errorText, InviteLink, PeopleSheet, SheetLabel, ToggleChips } from './sheet';

/**
 * Invite a person from the phone - the web's Invite user dialog.
 *
 * Least privilege by default: Registered Employee is pre-ticked. On success the
 * sheet switches to the hand-over view with the link, shown once, because not
 * every company has email delivery configured.
 */

type Named = { id: string; name: string };

const EMPTY = { firstName: '', lastName: '', email: '', jobTitle: '', departmentId: '', officeId: '' };

export function InviteSheet({
  visible,
  onClose,
  onInvited,
}: {
  visible: boolean;
  onClose: () => void;
  onInvited: () => void;
}) {
  const { api, user } = useSession();
  const { c, spacing } = useTheme();
  // HR-style inviters may only invite Registered Employees - the server
  // enforces it; the form says so upfront.
  const { fullManager } = peopleGates(user);

  const [form, setForm] = useState(EMPTY);
  const [roleKeys, setRoleKeys] = useState<string[]>(['EMPLOYEE']);
  const [roles, setRoles] = useState<RoleOption[]>(fallbackRoles());
  const [departments, setDepartments] = useState<Named[]>([]);
  const [offices, setOffices] = useState<Named[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; inviteUrl: string } | null>(null);

  useEffect(() => {
    if (!visible) return;
    setForm(EMPTY);
    setRoleKeys(['EMPLOYEE']);
    setError(null);
    setResult(null);
    // /roles needs roles:manage; without it the system roles are offered, as on the web.
    api
      .request<RoleOption[]>('/roles')
      .then((r) => setRoles(r?.length ? r : fallbackRoles()))
      .catch(() => setRoles(fallbackRoles()));
    api.request<Named[]>('/departments').then((d) => setDepartments(d ?? [])).catch(() => setDepartments([]));
    api.request<Named[]>('/offices').then((o) => setOffices(o ?? [])).catch(() => setOffices([]));
  }, [visible, api]);

  const set = (key: keyof typeof EMPTY) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.request<{ id: string; email: string; inviteUrl: string }>('/users/invite', {
        method: 'POST',
        body: inviteBody(form, roleKeys),
      });
      setResult({ email: data.email, inviteUrl: data.inviteUrl });
      onInvited();
    } catch (e) {
      setError(errorText(e, 'Could not send the invitation.'));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <PeopleSheet visible={visible} title="Invitation created" onClose={onClose}>
        <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>
          {result.email} has been emailed an invitation. The same link is below —{' '}
          <Text style={{ fontWeight: '700', color: c.text }}>it is shown only once</Text>, so share it
          now if you want to hand it over yourself (chat, in person). It works for 7 days, once.
        </Text>
        <InviteLink url={result.inviteUrl} />
        <Text style={{ color: c.subtle, fontSize: 12, marginTop: spacing.md, marginBottom: spacing.lg }}>
          The account shows as Invited in People until the person sets their password.
        </Text>
        <Button label="Done" onPress={onClose} />
      </PeopleSheet>
    );
  }

  return (
    <PeopleSheet
      visible={visible}
      title="Invite a new user"
      subtitle="They set their own password from the link."
      onClose={onClose}
    >
      <Field label="First name" value={form.firstName} onChangeText={set('firstName')} />
      <Field label="Last name" value={form.lastName} onChangeText={set('lastName')} />
      <Field
        label="Work email"
        value={form.email}
        onChangeText={set('email')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="Where their invitation link is sent"
      />
      <Field label="Job title (optional)" value={form.jobTitle} onChangeText={set('jobTitle')} />

      <SheetLabel>Department</SheetLabel>
      <View style={{ marginBottom: spacing.lg }}>
        <ChipPicker
          label="Department"
          options={departments}
          value={form.departmentId}
          onChange={set('departmentId')}
          allowNone
          noneLabel="No department"
        />
      </View>

      <SheetLabel>Office</SheetLabel>
      <View style={{ marginBottom: spacing.lg }}>
        <ChipPicker
          label="Office"
          options={offices}
          value={form.officeId}
          onChange={set('officeId')}
          allowNone
          noneLabel="No office"
        />
      </View>

      <SheetLabel>Roles</SheetLabel>
      <View style={{ marginBottom: spacing.lg }}>
        {fullManager ? (
          // No Super Admin: an invitation can never create a second one.
          <ToggleChips
            options={roles
              .filter((r) => r.key !== 'SUPER_ADMIN')
              .map((r) => ({ key: r.key, name: r.name }))}
            selected={roleKeys}
            onToggle={(key) => setRoleKeys((prev) => toggleKey(prev, key))}
          />
        ) : (
          <Text style={{ color: c.muted, fontSize: 14 }}>
            Invited as <Text style={{ fontWeight: '700', color: c.text }}>Registered Employee</Text>.
            Other roles are granted afterwards by a user manager.
          </Text>
        )}
      </View>

      {error ? <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text> : null}

      <Button
        label="Send invitation"
        icon="send-outline"
        onPress={submit}
        loading={busy}
        disabled={!canSubmitInvite(form, roleKeys)}
      />
    </PeopleSheet>
  );
}
