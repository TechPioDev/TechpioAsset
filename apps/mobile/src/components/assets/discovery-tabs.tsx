import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import {
  ASSET_DETAIL_COPY,
  HEALTH_GRADE_TONE,
  hardwareRows,
  healthDimensionLabel,
  healthSubScoreTone,
  osRows,
  securityPostureRows,
  type HardwareSnapshot,
  type OsSnapshot,
} from '@techpioasset/domain';
import {
  SOFTWARE_PAGE_SIZE,
  SOFTWARE_RENDER_MAX,
  filterSoftware,
  hasMoreSoftware,
  type SoftwareRow,
} from '../../lib/asset-detail';
import { problemMessage } from '../../lib/asset-admin';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { Button, Card, Field, SectionTitle } from '../ui';
import { DetailRows, FreshnessBanner, TabEmpty, ToneBadge, useToneColor } from './detail-parts';
import { toast } from '../toast';

/**
 * The agent-reported tabs on the phone (web: discovery-tabs.tsx) - Hardware,
 * OS & Security, Software and Health. Same endpoint, same rows, same badges,
 * same empty-state sentences; laid out as one column of label/value lines.
 */

export interface HardwareProfileDto extends HardwareSnapshot {
  source: string;
  lastDiscoveredAt: string;
}

export interface OsInfoDto extends OsSnapshot {
  source: string;
  lastDiscoveredAt: string;
}

export interface HealthDto {
  overall: number;
  grade: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'CRITICAL';
  subScores: { key: string; score: number; weight: number }[];
  recommendations: string[];
  capped: boolean;
  computedAt: string;
}

const NotDiscovered = () => (
  <TabEmpty title={ASSET_DETAIL_COPY.notDiscovered.title} message={ASSET_DETAIL_COPY.notDiscovered.description} />
);

export function HardwareTab({ hw }: { hw: HardwareProfileDto | null }) {
  if (!hw) return <NotDiscovered />;
  return (
    <>
      <FreshnessBanner source={hw.source} at={hw.lastDiscoveredAt} />
      <Card style={{ padding: 0 }}>
        <DetailRows rows={hardwareRows(hw)} />
      </Card>
    </>
  );
}

export function OsTab({ os }: { os: OsInfoDto | null }) {
  const { c, spacing } = useTheme();
  if (!os) return <NotDiscovered />;
  const posture = securityPostureRows(os);
  return (
    <>
      {/* Once for the whole tab: both cards are the same snapshot. */}
      <FreshnessBanner source={os.source} at={os.lastDiscoveredAt} />
      <SectionTitle>Operating system</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        <DetailRows rows={osRows(os, (at) => new Date(at).toLocaleString())} />
      </Card>
      <SectionTitle>Security posture</SectionTitle>
      <Card style={{ padding: 0 }}>
        {posture.map((row, i) => (
          <View
            key={row.label}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderBottomWidth: i === posture.length - 1 ? 0 : 1,
              borderBottomColor: c.border,
            }}
          >
            <Text style={{ color: c.text, fontSize: 14 }}>{row.label}</Text>
            {row.state === null ? (
              <Text style={{ color: c.subtle, fontSize: 12 }}>not reported</Text>
            ) : (
              <ToneBadge tone={row.state.tone} label={row.state.text} />
            )}
          </View>
        ))}
      </Card>
    </>
  );
}

/**
 * Installed applications. The web pages through 25 at a time; on a phone a
 * search box is the faster way to answer "does this machine have Zoom", so the
 * whole list is loaded (100 a page, capped) and filtered on the device.
 */
export function SoftwareTab({ assetId, total }: { assetId: string; total: number }) {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [rows, setRows] = useState<SoftwareRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const all: SoftwareRow[] = [];
        let page = 0;
        let more = true;
        while (more) {
          page += 1;
          const batch = await api.request<SoftwareRow[]>(
            `/assets/${assetId}/software?page=${page}&pageSize=${SOFTWARE_PAGE_SIZE}`,
          );
          all.push(...(batch ?? []));
          more = hasMoreSoftware(batch?.length ?? 0, page);
          if (!more && (batch?.length ?? 0) === SOFTWARE_PAGE_SIZE) setTruncated(true);
        }
        if (alive) setRows(all);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, assetId]);

  if (failed) {
    return <TabEmpty title="Could not load software" message="Go back and open this tab again." />;
  }
  if (rows === null) return <ActivityIndicator color={c.brand} style={{ marginVertical: spacing.xl }} />;
  if (rows.length === 0) {
    return <TabEmpty title={ASSET_DETAIL_COPY.noSoftware.title} message={ASSET_DETAIL_COPY.noSoftware.description} />;
  }

  const matches = filterSoftware(rows, q);
  // The screen is one ScrollView, so a thousand rows would all mount at once.
  const shown = matches.slice(0, SOFTWARE_RENDER_MAX);
  return (
    <>
      <Field
        value={q}
        onChangeText={setQ}
        placeholder={`Search ${total || rows.length} applications`}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
      />
      <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.sm }}>
        {q.trim() ? `${matches.length} of ${total || rows.length} applications` : `${total || rows.length} applications`}
        {truncated ? ` · first ${rows.length} loaded` : ''}
        {matches.length > shown.length ? ` · showing ${shown.length}, search to narrow` : ''}
      </Text>
      <Card style={{ padding: 0 }}>
        {shown.length === 0 ? (
          <Text style={{ color: c.muted, fontSize: 14, padding: 16 }}>Nothing matches that search.</Text>
        ) : (
          shown.map((r, i) => (
            <View
              key={r.id}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 11,
                borderBottomWidth: i === shown.length - 1 ? 0 : 1,
                borderBottomColor: c.border,
              }}
            >
              <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{r.name}</Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
                {r.version ?? '—'} · {r.publisher ?? '—'}
              </Text>
            </View>
          ))
        )}
      </Card>
    </>
  );
}

function SubScoreBar({ label, score }: { label: string; score: number }) {
  const { c } = useTheme();
  const color = useToneColor(healthSubScoreTone(score));
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}
      accessible
      accessibilityLabel={`${label}: ${score} out of 100`}
    >
      <Text style={{ color: c.muted, fontSize: 13, width: 72 }}>{label}</Text>
      <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: c.background, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(0, Math.min(100, score))}%`, height: '100%', backgroundColor: color }} />
      </View>
      <Text style={{ color: c.text, fontSize: 13, width: 30, textAlign: 'right' }}>{score}</Text>
    </View>
  );
}

export function HealthTab({
  assetId,
  health,
  canRecompute,
  onRecomputed,
}: {
  assetId: string;
  health: HealthDto | null;
  canRecompute: boolean;
  onRecomputed: () => void;
}) {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [busy, setBusy] = useState(false);
  const gradeColor = useToneColor(health ? HEALTH_GRADE_TONE[health.grade] : 'muted');
  const warn = useToneColor('warning');
  const critical = useToneColor('critical');

  const recompute = useCallback(async () => {
    setBusy(true);
    try {
      await api.request(`/assets/${assetId}/health/recompute`, { method: 'POST', body: {} });
      onRecomputed();
    } catch (e) {
      toast.say('Could not recompute', problemMessage(e, 'Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  }, [api, assetId, onRecomputed]);

  if (!health) {
    return <TabEmpty title={ASSET_DETAIL_COPY.noHealth.title} message={ASSET_DETAIL_COPY.noHealth.description} />;
  }

  return (
    <>
      <Card style={{ marginBottom: spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}>
          <Text style={{ color: gradeColor, fontSize: 34, fontWeight: '800' }}>
            {health.overall}
            <Text style={{ color: c.subtle, fontSize: 15, fontWeight: '500' }}> / 100</Text>
          </Text>
          <ToneBadge tone={HEALTH_GRADE_TONE[health.grade]} label={health.grade.toLowerCase()} />
        </View>
        {health.capped ? (
          <Text
            style={{
              color: critical,
              fontSize: 13,
              lineHeight: 19,
              marginTop: spacing.md,
            }}
          >
            {ASSET_DETAIL_COPY.healthCapped}
          </Text>
        ) : null}
        {health.subScores.map((sub) => (
          <SubScoreBar key={sub.key} label={healthDimensionLabel(sub.key)} score={sub.score} />
        ))}
        <Text style={{ color: c.subtle, fontSize: 12, marginTop: spacing.md }}>
          Computed {new Date(health.computedAt).toLocaleString()} · {ASSET_DETAIL_COPY.healthExcluded}
        </Text>
        {canRecompute ? (
          <Button
            label="Recompute"
            icon="refresh-outline"
            variant="secondary"
            onPress={() => void recompute()}
            loading={busy}
            style={{ marginTop: spacing.md }}
          />
        ) : null}
      </Card>

      {health.recommendations.length > 0 ? (
        <>
          <SectionTitle>Recommendations</SectionTitle>
          <Card>
            {health.recommendations.map((rec) => (
              <View key={rec} style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: warn, marginTop: 7 }} />
                <Text style={{ color: c.text, fontSize: 14, lineHeight: 20, flex: 1 }}>{rec}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </>
  );
}
