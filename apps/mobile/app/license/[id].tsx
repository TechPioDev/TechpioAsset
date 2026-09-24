import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { PERMISSIONS } from '@techpioasset/domain';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { ApiError } from '../../src/lib/api-client';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Button, Card, DetailSkeleton, EmptyState, IconBadge, Screen, SectionTitle, StatusPill } from '../../src/components/ui';
import { LICENSE_LABEL, LICENSE_TONE, expiryText, type LicenseRow } from '../licenses';
import { toast } from '../../src/components/toast';
import { confirm } from '../../src/components/confirm';

interface Assignment {
  id: string;
  status: 'ACTIVE' | 'REVOKED';
  assignedAt: string;
  user: { id: string; email: string; profile: { firstName: string; lastName: string } | null } | null;
  asset: { id: string; assetTag: string; name: string } | null;
}
interface LicenseDetail extends LicenseRow {
  assignments: Assignment[];
}
interface Principal {
  id: string;
  label: string;
}

const who = (a: Assignment) =>
  a.user
    ? a.user.profile
      ? `${a.user.profile.firstName} ${a.user.profile.lastName}`.trim() || a.user.email
      : a.user.email
    : a.asset
      ? `${a.asset.name} (${a.asset.assetTag})`
      : '—';

/** Licence detail — seats, holders, and the same hard limit the web enforces. */
export default function LicenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useSession();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [license, setLicense] = useState<LicenseDetail | null>(null);
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const can = (perm: string) => !!user?.permissions.includes(perm);
  const canAssign = can(PERMISSIONS.LICENSES_ASSIGN);
  const canRevoke = can(PERMISSIONS.LICENSES_REVOKE);

  const load = useCallback(async () => {
    setLicense(await api.request<LicenseDetail>(`/licenses/${id}`));
  }, [api, id]);
  useEffect(() => void load(), [load]);

  // Principals load lazily, only when the assign panel opens.
  useEffect(() => {
    if (!assignOpen || !license || principals.length > 0) return;
    void (async () => {
      if (license.unitOfAssignment === 'USER') {
        const users = await api.request<{ id: string; email: string }[]>('/users?pageSize=100');
        setPrincipals((users ?? []).map((u) => ({ id: u.id, label: u.email })));
      } else {
        const assets = await api.request<{ id: string; assetTag: string; name: string }[]>(
          '/assets?pageSize=100',
        );
        setPrincipals((assets ?? []).map((a) => ({ id: a.id, label: `${a.name} (${a.assetTag})` })));
      }
    })();
  }, [assignOpen, license, principals.length, api]);

  const filtered = useMemo(
    () =>
      search
        ? principals.filter((p) => p.label.toLowerCase().includes(search.toLowerCase()))
        : principals,
    [principals, search],
  );

  async function assign(principal: Principal) {
    if (!license) return;
    setBusy(true);
    try {
      await api.request(`/licenses/${license.id}/assign`, {
        method: 'POST',
        body:
          license.unitOfAssignment === 'USER'
            ? { userId: principal.id }
            : { assetId: principal.id },
      });
      setAssignOpen(false);
      setSearch('');
      await load();
      toast.say('Seat assigned', `${principal.label} now holds a seat.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SEAT_LIMIT_EXCEEDED') {
        // The same honest refusal the web shows — no override on mobile either.
        toast.say('License limit exceeded', error.message);
      } else {
        toast.say('Could not assign', error instanceof Error ? error.message : 'Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(assignment: Assignment) {
    if (!license) return;
    void (async () => {
      const ok = await confirm({
        title: 'Revoke seat?',
        message: `${who(assignment)} will lose this licence seat.`,
        confirmLabel: 'Revoke',
        destructive: true,
      });
      if (!ok) return;
      setBusy(true);
      try {
        await api.request(`/licenses/${license.id}/revoke`, {
          method: 'POST',
          body: { assignmentId: assignment.id },
        });
        await load();
      } finally {
        setBusy(false);
      }
    })();
  }

  if (!license) {
    return (
      <DetailSkeleton />
    );
  }

  const tone = palette[LICENSE_TONE[license.status]];
  const active = license.assignments.filter((a) => a.status === 'ACTIVE');
  const full = license.seatsPurchased > 0 && license.seatsReserved >= license.seatsPurchased;
  const assignable = canAssign && license.status !== 'RETIRED' && license.status !== 'EXPIRED';

  return (
    <Screen scroll fade>
      <Card style={{ marginBottom: spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <IconBadge icon="key-outline" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '800' }}>{license.name}</Text>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>
              {[license.edition, license.vendor?.name, expiryText(license.expiryDate)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>
        <View style={{ marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <StatusPill label={LICENSE_LABEL[license.status]} bg={tone.bg} fg={tone.fg} />
          <Text
            style={{
              color: full ? tone.fg : c.muted,
              fontSize: 13,
              fontWeight: '700',
              fontVariant: ['tabular-nums'],
            }}
          >
            {license.seatsReserved}/{license.seatsPurchased} seats
            {full ? ' · Full' : ` · ${license.seatsAvailable} free`}
          </Text>
        </View>
      </Card>

      <SectionTitle>Seats in use</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        {active.length === 0 ? (
          <EmptyState icon="key-outline" title="No seats assigned" message="Assigned seats appear here." />
        ) : (
          active.map((a, i) => (
            <View
              key={a.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: i === active.length - 1 ? 0 : 1,
                borderBottomColor: c.border,
              }}
            >
              <Ionicons
                name={a.user ? 'person-outline' : 'hardware-chip-outline'}
                size={18}
                color={c.muted}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
                  {who(a)}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>
                  since{' '}
                  {new Date(a.assignedAt).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </Text>
              </View>
              {canRevoke ? (
                <Pressable
                  onPress={() => revoke(a)}
                  disabled={busy}
                  style={{ padding: 6 }}
                  accessibilityLabel={`Revoke seat for ${who(a)}`}
                >
                  <Ionicons name="person-remove-outline" size={18} color={c.danger} />
                </Pressable>
              ) : null}
            </View>
          ))
        )}
      </Card>

      {assignable ? (
        assignOpen ? (
          <>
            <SectionTitle>
              Assign to a {license.unitOfAssignment === 'USER' ? 'person' : 'device'}
            </SectionTitle>
            <Card style={{ padding: 0, marginBottom: spacing.md }}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search…"
                placeholderTextColor={c.muted}
                style={{
                  color: c.text,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: c.border,
                  fontSize: 14,
                }}
              />
              {filtered.slice(0, 8).map((p, i, arr) => (
                <Pressable
                  key={p.id}
                  onPress={() => void assign(p)}
                  disabled={busy}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: i === arr.length - 1 ? 0 : 1,
                    borderBottomColor: c.border,
                  }}
                >
                  <Text style={{ color: c.text, fontSize: 14 }} numberOfLines={1}>
                    {p.label}
                  </Text>
                </Pressable>
              ))}
              {principals.length === 0 ? (
                <Text style={{ color: c.muted, fontSize: 13, padding: 16 }}>Loading…</Text>
              ) : null}
            </Card>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => {
                setAssignOpen(false);
                setSearch('');
              }}
            />
          </>
        ) : (
          <Button
            label={full ? 'Assign seat (licence is full)' : 'Assign a seat'}
            icon="person-add-outline"
            onPress={() => setAssignOpen(true)}
            loading={busy}
          />
        )
      ) : null}
    </Screen>
  );
}
