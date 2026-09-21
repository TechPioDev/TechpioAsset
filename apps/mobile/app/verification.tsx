import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { canVerifyAssets, type AssetStatus } from '@techpioasset/domain';
import { useSession } from '../src/providers/session';
import { statusColor, statusLabel, useTheme } from '../src/theme';
import { problemMessage } from '../src/lib/asset-admin';
import {
  Button,
  Card,
  Chevron,
  EmptyState,
  ListSkeleton,
  PullRefresh,
  Screen,
  SectionTitle,
  StatusPill,
} from '../src/components/ui';

interface Summary {
  period: { label: string; since: string };
  total: number;
  verified: number;
  pending: number;
  percent: number;
  label: string;
  pendingShown: number;
  pendingAssets: {
    id: string;
    name: string;
    assetTag: string;
    status: AssetStatus;
    office: string | null;
    holder: string | null;
  }[];
}

/**
 * The verification round (0.3.31): where this quarter's physical check of the
 * register stands, and the units still to find.
 *
 * Somebody who handles equipment walks the floor from here - "Scan to verify"
 * opens the scanner in round mode, where every label read is marked seen and
 * the camera carries on. An Auditor reads the same screen and cannot mark
 * anything: attesting is a write, and that role is read-only by invariant, so
 * the people who touch the equipment attest and the auditor checks their work.
 *
 * Reloaded on focus, so coming back from the scanner shows the new count.
 */
export default function VerificationScreen() {
  const { api, user } = useSession();
  const router = useRouter();
  const { c, radius, scheme, spacing } = useTheme();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mayVerify = canVerifyAssets(user?.permissions ?? []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await api.request<Summary>('/assets/verification/summary'));
      setError(null);
    } catch (failure) {
      setError(problemMessage(failure, 'Could not load the verification round.'));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen scroll refreshControl={<PullRefresh refreshing={loading} onRefresh={load} />}>
      {error ? (
        <Card>
          <EmptyState icon="alert-circle-outline" title="Could not load" message={error} />
        </Card>
      ) : !summary ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          <Card style={{ marginBottom: spacing.lg }}>
            <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 }}>
              {summary.period.label.toUpperCase()} · PHYSICAL VERIFICATION
            </Text>
            <Text style={{ color: c.text, fontSize: 26, fontWeight: '800', marginTop: 4 }}>
              {summary.label}
            </Text>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: summary.percent }}
              style={{
                height: 10,
                borderRadius: radius.md,
                backgroundColor: c.surface,
                overflow: 'hidden',
                marginTop: spacing.md,
              }}
            >
              <View
                style={{
                  width: `${summary.percent}%`,
                  height: '100%',
                  backgroundColor: summary.pending === 0 && summary.total > 0 ? c.success : c.brand,
                }}
              />
            </View>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: spacing.sm }}>
              {summary.total === 0
                ? 'No assets are expected in this round.'
                : summary.pending === 0
                  ? 'Every asset has been seen this quarter.'
                  : `${summary.percent}% · ${summary.pending} still to find`}
            </Text>
            {mayVerify ? (
              <Button
                label="Scan to verify"
                icon="qr-code-outline"
                onPress={() => router.push('/(tabs)/scan?round=1' as never)}
                style={{ marginTop: spacing.md }}
              />
            ) : (
              <Text style={{ color: c.subtle, fontSize: 12, marginTop: spacing.md, lineHeight: 17 }}>
                You can follow the round here. Marking an asset as seen is done by the people who
                handle the equipment.
              </Text>
            )}
          </Card>

          {summary.pendingAssets.length > 0 ? (
            <>
              <SectionTitle>Still to find</SectionTitle>
              {summary.pendingAssets.map((asset) => {
                const tone = statusColor(asset.status, scheme);
                return (
                  <Card
                    key={asset.id}
                    onPress={() => router.push(`/asset/${asset.id}`)}
                    style={{
                      marginBottom: spacing.sm,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.md,
                    }}
                  >
                    <Ionicons name="help-circle-outline" size={20} color={c.muted} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>
                        {asset.name}
                      </Text>
                      <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                        {[asset.assetTag, asset.holder ?? 'Unassigned', asset.office]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                      <View style={{ marginTop: 6 }}>
                        <StatusPill label={statusLabel(asset.status)} bg={tone.bg} fg={tone.fg} />
                      </View>
                    </View>
                    <Chevron />
                  </Card>
                );
              })}
              {summary.pending > summary.pendingShown ? (
                <Text style={{ color: c.subtle, fontSize: 12, textAlign: 'center', marginTop: spacing.sm }}>
                  Showing the first {summary.pendingShown} of {summary.pending}.
                </Text>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
