import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PERMISSIONS, type VerificationStatus } from '@techpioasset/domain';
import {
  TONE_PALETTE_DARK,
  TONE_PALETTE_LIGHT,
  VERIFICATION_STATUS_TOKENS,
} from '@techpioasset/ui-tokens';
import { ApiError } from '../../src/lib/api-client';
import { formatMoney, personName } from '../../src/lib/format';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Button, Card, EmptyState, Field, PullRefresh, Screen, SectionTitle, StatusPill } from '../../src/components/ui';
import { MatchPanel } from '../../src/components/invoices/match-panel';

interface Issue {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
  lineNumber?: number;
  expected?: string;
  actual?: string;
}

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  subtotal: string;
  tax: string;
  discount: string;
  total: string;
  verificationStatus: VerificationStatus;
  vendor: { id: string; name: string } | null;
  lines: {
    id: string;
    lineNumber: number;
    description: string;
    quantity: string;
    unitPrice: string;
    lineTotal: string;
    assetLinks: { asset: { id: string; assetTag: string; name: string } | null }[];
  }[];
  documents: { id: string; originalName: string; mimeType: string; sizeBytes?: number }[];
  extractions: {
    id: string;
    provider: string;
    overallConfidence: string | null;
    simulated: boolean;
    fieldConfidences: Record<string, number> | null;
  }[];
  verifications: {
    id: string;
    issues: Issue[];
    outcome: VerificationStatus;
    decidedAt: string | null;
    notes: string | null;
    decidedBy: { email: string; profile: { firstName: string | null; lastName: string | null } | null } | null;
  }[];
}

const SEVERITY_TONE = { ERROR: 'critical', WARNING: 'warning', INFO: 'info' } as const;
/** Still being read - keep looking, as the web page does. */
const AWAITING_EXTRACTION = new Set<string>(['PENDING_AI_PROCESSING', 'AI_PROCESSING']);
const CONFIDENCE_THRESHOLD = 0.85;

/**
 * Invoice review, on the phone (v2.56) - the web /invoices/[id] page.
 *
 * Reading needs invoices:read (the route is only reached from the list, which
 * needs it too). The document opens through a two-minute signed link in the
 * system browser. Verify / Reject needs invoices:verify and is a human
 * decision - AI never verifies an invoice on its own.
 */
export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useSession();
  const { c, scheme, spacing, radius } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notes, setNotes] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.request<InvoiceDetail>(`/invoices/${id}`));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load this invoice.');
    }
  }, [api, id]);

  useEffect(() => void load(), [load]);

  // Poll while the document is being read; stop the moment it settles.
  const awaiting = !!data && AWAITING_EXTRACTION.has(data.verificationStatus);
  useEffect(() => {
    if (!awaiting) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [awaiting, load]);

  if (error && !data) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Could not load this invoice" message={error} />
        <Button label="Try again" variant="secondary" onPress={() => void load()} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  const can = (p: string) => !!user?.permissions.includes(p);
  const extraction = data.extractions[0];
  const verification = data.verifications[0];
  const issues = verification?.issues ?? [];
  const canVerify = can(PERMISSIONS.INVOICES_VERIFY) && !verification?.decidedAt;
  const document = data.documents[0];
  const status = VERIFICATION_STATUS_TOKENS[data.verificationStatus];
  const statusTone = palette[status.tone];
  const confidenceOf = (field: string): number | null => extraction?.fieldConfidences?.[field] ?? null;

  async function openDocument() {
    if (!document) return;
    setOpening(true);
    try {
      const link = await api.request<{ path: string }>(
        `/invoices/${data!.id}/documents/${document.id}/link`,
        { method: 'POST' },
      );
      await Linking.openURL(api.absoluteUrl(link.path));
    } catch (caught) {
      Alert.alert('Could not open the document', caught instanceof ApiError ? caught.message : 'Please try again.');
    } finally {
      setOpening(false);
    }
  }

  function confirmDecision(decision: 'VERIFIED' | 'REJECTED') {
    Alert.alert(
      decision === 'VERIFIED' ? 'Verify this invoice?' : 'Reject this invoice?',
      'Your decision is recorded against the invoice with your name.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: decision === 'VERIFIED' ? 'Verify' : 'Reject',
          style: decision === 'VERIFIED' ? 'default' : 'destructive',
          onPress: () => void decide(decision),
        },
      ],
    );
  }

  async function decide(decision: 'VERIFIED' | 'REJECTED') {
    setDeciding(true);
    try {
      await api.request(`/invoices/${data!.id}/decision`, {
        method: 'POST',
        body: { decision, ...(notes.trim() ? { notes: notes.trim() } : {}) },
      });
      setNotes('');
      await load();
    } catch (caught) {
      Alert.alert(
        'Could not record the decision',
        caught instanceof ApiError ? caught.message : 'Please try again.',
      );
    } finally {
      setDeciding(false);
    }
  }

  const fields = [
    { label: 'Subtotal', value: data.subtotal, field: 'subtotal' },
    { label: 'Tax', value: data.tax, field: 'tax' },
    { label: 'Total', value: data.total, field: 'total' },
  ];

  return (
    <Screen
      scroll
      refreshControl={
        <PullRefresh
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Card style={{ marginBottom: spacing.xl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '800', flexShrink: 1 }} numberOfLines={1}>
            {data.invoiceNumber}
          </Text>
          <StatusPill label={status.label} bg={statusTone.bg} fg={statusTone.fg} />
        </View>
        <Text style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>
          {data.vendor?.name ?? 'Unknown vendor'} · {new Date(data.invoiceDate).toLocaleDateString()}
        </Text>
        {awaiting ? (
          <Text style={{ color: c.muted, fontSize: 13, marginTop: spacing.sm }}>
            Reading the document. The fields below will fill in on their own — a single page usually
            takes under a minute, a long scan longer.
          </Text>
        ) : null}
        {extraction?.simulated ? (
          <View style={{ marginTop: spacing.sm }}>
            <StatusPill
              label="AI extraction simulated — not a real OCR result"
              bg={palette.warning.bg}
              fg={palette.warning.fg}
            />
          </View>
        ) : null}
      </Card>

      <SectionTitle>Document</SectionTitle>
      <Card style={{ marginBottom: spacing.xl }}>
        {!document ? (
          <Text style={{ color: c.subtle, fontSize: 13 }}>No document — this invoice was entered manually.</Text>
        ) : (
          <Pressable
            onPress={() => void openDocument()}
            accessibilityRole="button"
            accessibilityLabel={`Open ${document.originalName}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
          >
            <Ionicons name="document-text-outline" size={22} color={c.brand} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>
                {document.originalName}
              </Text>
              <Text style={{ color: c.subtle, fontSize: 12 }}>
                {opening ? 'Opening…' : 'Tap to open in the browser'}
              </Text>
            </View>
            <Ionicons name="open-outline" size={18} color={c.subtle} />
          </Pressable>
        )}
      </Card>

      <SectionTitle>Extracted fields</SectionTitle>
      <Card style={{ marginBottom: spacing.xl, gap: 10 }}>
        {fields.map(({ label, value, field }) => {
          const confidence = confidenceOf(field);
          const low = confidence !== null && confidence < CONFIDENCE_THRESHOLD;
          return (
            <View key={field} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: c.muted, fontSize: 14 }}>{label}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {low ? (
                  <StatusPill
                    label={`${Math.round(confidence * 100)}% sure`}
                    bg={palette.warning.bg}
                    fg={palette.warning.fg}
                  />
                ) : null}
                <Text style={{ color: c.text, fontWeight: field === 'total' ? '800' : '600', fontSize: 14 }}>
                  {formatMoney(value, data.currency)}
                </Text>
              </View>
            </View>
          );
        })}
      </Card>

      <SectionTitle>Line items</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        {data.lines.length === 0 ? (
          <Text style={{ color: c.subtle, fontSize: 13, padding: 16 }}>No line items.</Text>
        ) : (
          data.lines.map((line, i) => {
            const lineIssue = issues.find((x) => x.lineNumber === line.lineNumber && x.severity === 'ERROR');
            const asset = line.assetLinks[0]?.asset;
            return (
              <View
                key={line.id}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderBottomWidth: i === data.lines.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                  backgroundColor: lineIssue ? palette.critical.bg : undefined,
                  borderRadius: lineIssue ? radius.sm : 0,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ color: c.text, fontSize: 14, flex: 1 }}>{line.description}</Text>
                  <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }}>
                    {formatMoney(line.lineTotal, data.currency)}
                  </Text>
                </View>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
                  {Number(line.quantity)} × {formatMoney(line.unitPrice, data.currency)}
                  {asset ? ` · → ${asset.assetTag}` : ''}
                </Text>
              </View>
            );
          })
        )}
      </Card>

      <SectionTitle>Verification issues{issues.length > 0 ? ` · ${issues.length}` : ''}</SectionTitle>
      <Card style={{ marginBottom: spacing.xl, gap: 8 }}>
        {issues.length === 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="shield-checkmark-outline" size={16} color={palette.success.fg} />
            <Text style={{ color: palette.success.fg, fontSize: 13 }}>
              No issues found by the deterministic checks.
            </Text>
          </View>
        ) : (
          issues.map((issue, index) => {
            const tone = palette[SEVERITY_TONE[issue.severity]];
            return (
              <View
                key={index}
                style={{
                  borderWidth: 1,
                  borderColor: tone.border,
                  backgroundColor: tone.bg,
                  borderRadius: radius.md,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                }}
              >
                <Text style={{ color: tone.fg, fontSize: 13 }}>{issue.message}</Text>
                {issue.expected ? (
                  <Text style={{ color: tone.fg, fontSize: 12, opacity: 0.8, marginTop: 2 }}>
                    Expected {issue.expected}, got {issue.actual}
                  </Text>
                ) : null}
              </View>
            );
          })
        )}
      </Card>

      <MatchPanel
        invoiceId={data.id}
        canRun={can(PERMISSIONS.INVOICES_VERIFY)}
        canOverride={can(PERMISSIONS.PROCUREMENT_MATCH_OVERRIDE)}
        onChanged={() => void load()}
      />

      {verification?.decidedAt ? (
        <>
          <SectionTitle>Decision</SectionTitle>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <StatusPill label={status.label} bg={statusTone.bg} fg={statusTone.fg} />
              <Text style={{ color: c.text, fontSize: 14 }}>by {personName(verification.decidedBy)}</Text>
            </View>
            {verification.notes ? (
              <Text style={{ color: c.muted, fontSize: 14, marginTop: spacing.sm }}>“{verification.notes}”</Text>
            ) : null}
          </Card>
        </>
      ) : canVerify ? (
        <>
          <SectionTitle>Your decision</SectionTitle>
          <Card>
            <Text style={{ color: c.subtle, fontSize: 12, marginBottom: spacing.md }}>
              A human decision is required — AI never verifies an invoice on its own.
            </Text>
            <Field
              placeholder="Notes (optional)"
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={2000}
              accessibilityLabel="Review notes"
            />
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Button
                label="Reject"
                variant="danger"
                onPress={() => confirmDecision('REJECTED')}
                disabled={deciding}
                style={{ flex: 1 }}
              />
              <Button
                label="Verify"
                icon="checkmark"
                onPress={() => confirmDecision('VERIFIED')}
                loading={deciding}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
