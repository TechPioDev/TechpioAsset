import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import {
  EXPENSE_SOURCE_LABELS,
  EXPENSE_SOURCES,
  formatMoneyText,
  type ExpensePeriodPreset,
} from '@techpioasset/domain';
import type {
  ExpenseExportLinkDto,
  ExpenseGroupDto,
  ExpenseSummaryDto,
} from '@techpioasset/contracts';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { ApiError } from '../src/lib/api-client';
import { Button, Card, EmptyState, Field, SectionTitle, StatCard } from '../src/components/ui';
import {
  EXPENSE_CHIPS,
  EXPENSE_LEVEL_LABELS,
  EXPENSE_LEVEL_TONES,
  customRangeError,
  describeChange,
  expenseLineRoute,
  expenseQueryString,
  exportLinkBody,
  formatMoneyShort,
  scaleBars,
  shareWidth,
  type ExpenseQueryInput,
} from '../src/lib/expenses';

/**
 * Expenses (v2.59) - Super Admin only.
 *
 * Asset purchases, completed repairs and software licences for a period, with
 * the bars coloured High / Normal / Low against the period's usual spend. The
 * API refuses anyone but a Super Admin on the role; this screen does not even
 * ask for anyone else, so nothing financial is ever fetched for them.
 *
 * Most companies start with no prices recorded, so the empty state is the
 * common case and is written as a to-do list (the API's dataGaps notes), not
 * as a blank chart.
 */

const CHART_HEIGHT = 140;
const SHORT_SOURCE: Record<(typeof EXPENSE_SOURCES)[number], string> = {
  ASSET: 'Assets',
  MAINTENANCE: 'Repairs',
  LICENCE: 'Licences',
};

export default function ExpensesScreen() {
  const { user } = useSession();
  const isSuperAdmin = Boolean(user?.roles.includes('SUPER_ADMIN'));

  if (!isSuperAdmin) {
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
        <EmptyState
          icon="lock-closed-outline"
          title="Super Admin only"
          message="The expense report shows company-wide spending, so only a Super Admin can open it."
        />
      </ScrollView>
    );
  }
  return <ExpensesReport />;
}

function ExpensesReport() {
  const { api } = useSession();
  const router = useRouter();
  const { c, scheme, spacing, radius } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [preset, setPreset] = useState<ExpensePeriodPreset>('LAST_30_DAYS');
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [query, setQuery] = useState<ExpenseQueryInput>({ preset: 'LAST_30_DAYS' });
  const [data, setData] = useState<ExpenseSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [customError, setCustomError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.request<ExpenseSummaryDto>(`/expenses/summary?${expenseQueryString(query)}`));
    } catch (e) {
      setData(null);
      setError(
        e instanceof ApiError && e.status === 403
          ? 'Your account cannot open the expense report.'
          : e instanceof Error
            ? e.message
            : 'The server could not be reached.',
      );
    } finally {
      setLoading(false);
    }
  }, [api, query]);

  useEffect(() => void load(), [load]);

  const choose = (next: ExpensePeriodPreset) => {
    setPreset(next);
    setCustomError(null);
    // Custom waits for Apply; every other chip loads straight away.
    if (next !== 'CUSTOM') setQuery({ preset: next });
  };

  const applyCustom = () => {
    const problem = customRangeError(fromText, toText);
    setCustomError(problem);
    if (!problem) setQuery({ preset: 'CUSTOM', from: fromText.trim(), to: toText.trim() });
  };

  const download = async (format: 'pdf' | 'xlsx') => {
    setExporting(format);
    try {
      const link = await api.request<ExpenseExportLinkDto>('/expenses/export-link', {
        method: 'POST',
        body: exportLinkBody(format, query),
      });
      await Linking.openURL(api.absoluteUrl(link.path));
    } catch (e) {
      Alert.alert(
        'Could not download the report',
        e instanceof ApiError ? e.message : 'Please try again.',
      );
    } finally {
      setExporting(null);
    }
  };

  const money = (amount: string) => formatMoneyText(amount, data?.currency ?? 'INR');
  const isEmpty = data ? data.totals.count === 0 : false;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      keyboardShouldPersistTaps="handled"
    >
      {/* Period chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}
      >
        {EXPENSE_CHIPS.map((chip) => {
          const active = chip.preset === preset;
          return (
            <Pressable
              key={chip.preset}
              onPress={() => choose(chip.preset)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: active ? c.brand : c.border,
                backgroundColor: active ? c.brand : c.surface,
              }}
            >
              <Text
                style={{ color: active ? c.brandText : c.text, fontSize: 13, fontWeight: '600' }}
              >
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {preset === 'CUSTOM' ? (
        <Card style={{ marginBottom: spacing.md }}>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Field
                label="From"
                value={fromText}
                onChangeText={setFromText}
                placeholder="YYYY-MM-DD"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="To"
                value={toText}
                onChangeText={setToText}
                placeholder="YYYY-MM-DD"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
            </View>
          </View>
          {customError ? (
            <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.sm }}>{customError}</Text>
          ) : null}
          <Button label="Apply" icon="checkmark-outline" onPress={applyCustom} />
        </Card>
      ) : null}

      {data ? (
        <Text style={{ color: c.muted, fontSize: 13, marginBottom: spacing.md }}>
          {data.period.label} · {data.period.rangeLabel}
        </Text>
      ) : null}

      {error ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={{ color: c.danger, fontWeight: '700', fontSize: 15 }}>
            Could not load expenses
          </Text>
          <Text style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>{error}</Text>
          <Button
            label="Try again"
            variant="secondary"
            icon="refresh-outline"
            onPress={() => void load()}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      ) : null}

      {!data && loading ? (
        <View style={{ gap: spacing.md }}>
          {[80, 80, 180].map((h, i) => (
            <View
              key={i}
              style={{ height: h, borderRadius: radius.lg, backgroundColor: c.surface, opacity: 0.7 }}
            />
          ))}
        </View>
      ) : null}

      {data ? (
        <>
          {/* KPIs */}
          <Card style={{ marginBottom: spacing.md }}>
            <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600' }}>Total spend</Text>
            <Text
              style={{ color: c.text, fontSize: 26, fontWeight: '800', marginTop: 2 }}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {money(data.totals.total)}
            </Text>
            <ChangeLine data={data} />
            <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }}>
              {data.totals.count} {data.totals.count === 1 ? 'expense' : 'expenses'} · previous{' '}
              {money(data.totals.previousTotal)}
            </Text>
          </Card>

          <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md }}>
            <StatCard
              icon="trending-up-outline"
              value={
                data.highestBucket
                  ? formatMoneyShort(data.highestBucket.total, data.currency)
                  : '—'
              }
              label={
                data.highestBucket
                  ? `Highest ${data.period.granularity === 'DAY' ? 'day' : 'month'}: ${data.highestBucket.label}`
                  : `Highest ${data.period.granularity === 'DAY' ? 'day' : 'month'}`
              }
            />
            <StatCard
              icon="pricetag-outline"
              value={data.byType[0] ? formatMoneyShort(data.byType[0].total, data.currency) : '—'}
              label={data.byType[0] ? `Biggest type: ${data.byType[0].name}` : 'Biggest type'}
            />
          </View>

          {/* Source split */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl }}>
            {EXPENSE_SOURCES.map((source) => (
              <View
                key={source}
                accessibilityLabel={`${EXPENSE_SOURCE_LABELS[source]}: ${money(data.totals.bySource[source].total)}`}
                style={{
                  flex: 1,
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: c.card,
                }}
              >
                <Text style={{ color: c.muted, fontSize: 11, fontWeight: '600' }}>
                  {SHORT_SOURCE[source]}
                </Text>
                <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                  {formatMoneyShort(data.totals.bySource[source].total, data.currency)}
                </Text>
                <Text style={{ color: c.subtle, fontSize: 11 }}>
                  {data.totals.bySource[source].count} items
                </Text>
              </View>
            ))}
          </View>

          {(data.filters.officeId || data.filters.categoryId) ? (
            <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.md }}>
              A filter is on, so software licences (which have no office or category) are left out.
            </Text>
          ) : null}

          {data.dataGaps.notes.length > 0 ? (
            <MissingData notes={data.dataGaps.notes} emphasise={isEmpty} />
          ) : null}

          {isEmpty ? (
            <Card style={{ marginBottom: spacing.xl }}>
              <EmptyState
                icon="cash-outline"
                title="No expenses in this period"
                message={
                  data.dataGaps.notes.length > 0
                    ? 'Nothing with a price and a date falls in this period. Filling in the missing data above is what makes this report work.'
                    : 'Nothing was bought, repaired or renewed in this period. Try a longer period.'
                }
              />
            </Card>
          ) : (
            <>
              <SectionTitle>
                Spend by {data.period.granularity === 'DAY' ? 'day' : 'month'}
              </SectionTitle>
              <Card style={{ marginBottom: spacing.xl }}>
                <SeriesBars data={data} palette={palette} />
              </Card>

              <GroupList title="By type" rows={data.byType} currency={data.currency} />
              <GroupList title="By category" rows={data.byCategory} currency={data.currency} />

              <SectionTitle>Top expenses</SectionTitle>
              <Card style={{ marginBottom: spacing.xl, paddingVertical: 4 }}>
                {data.topExpenses.map((line, i) => {
                  const route = expenseLineRoute(line);
                  return (
                    <Pressable
                      key={`${line.source}-${line.id}`}
                      disabled={!route}
                      onPress={() => route && router.push(route as never)}
                      accessibilityRole={route ? 'link' : undefined}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.sm,
                        paddingVertical: 10,
                        borderTopWidth: i === 0 ? 0 : 1,
                        borderTopColor: c.border,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                          {line.title}
                        </Text>
                        <Text style={{ color: c.subtle, fontSize: 12 }} numberOfLines={1}>
                          {SHORT_SOURCE[line.source]} · {line.localDate}
                          {line.vendor ? ` · ${line.vendor}` : ''}
                        </Text>
                      </View>
                      <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>
                        {formatMoneyText(line.amount, line.currency)}
                      </Text>
                      {route ? <Ionicons name="chevron-forward" size={16} color={c.subtle} /> : null}
                    </Pressable>
                  );
                })}
              </Card>
            </>
          )}

          {data.otherCurrencies.length > 0 ? (
            <Card style={{ marginBottom: spacing.xl }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }}>
                Other currencies (not converted)
              </Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2, marginBottom: 6 }}>
                Not included in the totals above - there is no exchange rate to convert with.
              </Text>
              {data.otherCurrencies.map((o) => (
                <Text key={o.currency} style={{ color: c.text, fontSize: 13 }}>
                  {formatMoneyText(o.total, o.currency)} · {o.count} items
                </Text>
              ))}
            </Card>
          ) : null}

          <SectionTitle>Download</SectionTitle>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Button
              label="PDF"
              icon="document-outline"
              variant="secondary"
              loading={exporting === 'pdf'}
              disabled={exporting !== null}
              onPress={() => void download('pdf')}
              style={{ flex: 1 }}
            />
            <Button
              label="Excel"
              icon="grid-outline"
              variant="secondary"
              loading={exporting === 'xlsx'}
              disabled={exporting !== null}
              onPress={() => void download('xlsx')}
              style={{ flex: 1 }}
            />
          </View>
          <Text style={{ color: c.subtle, fontSize: 12, marginTop: spacing.sm }}>
            Opens in your browser. The link works for two minutes.
          </Text>
        </>
      ) : null}
    </ScrollView>
  );
}

function ChangeLine({ data }: { data: ExpenseSummaryDto }) {
  const { c } = useTheme();
  const change = describeChange(
    data.totals.changePct,
    Number(data.totals.previousTotal) === 0,
  );
  const icon =
    change.direction === 'up'
      ? 'arrow-up'
      : change.direction === 'down'
        ? 'arrow-down'
        : change.direction === 'flat'
          ? 'remove'
          : 'information-circle-outline';
  // Deliberately not green/red: more spend is not "bad" and less is not "good".
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
      <Ionicons name={icon} size={14} color={c.muted} />
      <Text style={{ color: c.muted, fontSize: 13 }}>{change.text}</Text>
    </View>
  );
}

function MissingData({ notes, emphasise }: { notes: string[]; emphasise: boolean }) {
  const { c, scheme, spacing, radius } = useTheme();
  const tone = (scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT).warning;
  return (
    <View
      accessibilityRole="summary"
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: tone.border,
        backgroundColor: tone.bg,
        padding: spacing.lg,
        marginBottom: spacing.xl,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Ionicons name="alert-circle-outline" size={18} color={tone.fg} />
        <Text style={{ color: tone.fg, fontWeight: '700', fontSize: 15 }}>
          {emphasise ? 'Missing data - why this report is empty' : 'Missing data'}
        </Text>
      </View>
      {notes.map((note) => (
        <Text key={note} style={{ color: tone.fg, fontSize: 13, lineHeight: 19, marginTop: 2 }}>
          • {note}
        </Text>
      ))}
      <Text style={{ color: c.text, fontSize: 13, marginTop: spacing.md, fontWeight: '600' }}>
        Fill purchase prices with the price sheet - that is done on the web, under Assets › Price
        sheet.
      </Text>
    </View>
  );
}

function SeriesBars({
  data,
  palette,
}: {
  data: ExpenseSummaryDto;
  palette: typeof TONE_PALETTE_LIGHT;
}) {
  const { c, spacing } = useTheme();
  const heights = scaleBars(
    data.series.map((p) => p.total),
    CHART_HEIGHT,
  );
  const many = data.series.length > 14;
  const barWidth = many ? 14 : 28;

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingTop: 18 }}>
          {data.series.map((point, i) => {
            const tone = point.level === 'NONE' ? null : palette[EXPENSE_LEVEL_TONES[point.level]];
            const label = point.label.replace(/ \d{4}$/, '');
            return (
              <View
                key={point.key}
                accessible
                accessibilityLabel={`${point.label}: ${formatMoneyText(point.total, data.currency)}, ${EXPENSE_LEVEL_LABELS[point.level]}${point.partial ? ', partial' : ''}`}
                style={{ alignItems: 'center', width: many ? 34 : 44 }}
              >
                {!many && heights[i]! > 0 ? (
                  <Text style={{ color: c.muted, fontSize: 9, marginBottom: 2 }} numberOfLines={1}>
                    {formatMoneyShort(point.total, data.currency)}
                  </Text>
                ) : null}
                <View
                  style={{
                    width: barWidth,
                    height: Math.max(heights[i]!, 1),
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                    backgroundColor: tone ? tone.solid : c.border,
                    opacity: point.partial ? 0.45 : 1,
                  }}
                />
                <Text style={{ color: c.subtle, fontSize: 10, marginTop: 4 }} numberOfLines={1}>
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md }}>
        {(['HIGH', 'NORMAL', 'LOW'] as const).map((level) => (
          <View key={level} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                backgroundColor: palette[EXPENSE_LEVEL_TONES[level]].solid,
              }}
            />
            <Text style={{ color: c.muted, fontSize: 12 }}>{EXPENSE_LEVEL_LABELS[level]}</Text>
          </View>
        ))}
        <Text style={{ color: c.muted, fontSize: 12 }}>Faded = partly in the period</Text>
      </View>
      <Text style={{ color: c.subtle, fontSize: 11, marginTop: 6, lineHeight: 16 }}>
        High is at least 1.25× the usual (median) {data.period.granularity === 'DAY' ? 'day' : 'month'},
        low is at most 0.75×. With fewer than 3 spending{' '}
        {data.period.granularity === 'DAY' ? 'days' : 'months'}, all are normal.
      </Text>
    </>
  );
}

function GroupList({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: ExpenseGroupDto[];
  currency: string;
}) {
  const { c, spacing } = useTheme();
  if (rows.length === 0) return null;
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card style={{ marginBottom: spacing.xl }}>
        {rows.slice(0, 8).map((row, i) => (
          <View key={`${row.id ?? 'none'}-${row.name}`} style={{ marginTop: i === 0 ? 0 : spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
              <Text style={{ color: c.text, fontSize: 13, flex: 1 }} numberOfLines={1}>
                {row.name}
              </Text>
              <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>
                {formatMoneyShort(row.total, currency)}
              </Text>
              <Text style={{ color: c.subtle, fontSize: 12, width: 44, textAlign: 'right' }}>
                {row.sharePct}%
              </Text>
            </View>
            <View
              style={{ height: 6, borderRadius: 3, backgroundColor: c.border, marginTop: 4, overflow: 'hidden' }}
            >
              <View
                style={{ width: `${shareWidth(row.sharePct)}%`, height: '100%', backgroundColor: c.brand }}
              />
            </View>
          </View>
        ))}
        {rows.length > 8 ? (
          <Text style={{ color: c.subtle, fontSize: 12, marginTop: spacing.md }}>
            {rows.length - 8} more in the PDF and Excel downloads.
          </Text>
        ) : null}
      </Card>
    </>
  );
}
