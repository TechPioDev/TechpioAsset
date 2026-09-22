import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  CONDITION_TOKENS,
  OWNERSHIP_TYPE_TOKENS,
  TONE_PALETTE_DARK,
  TONE_PALETTE_LIGHT,
} from '@techpioasset/ui-tokens';
import {
  PERMISSIONS,
  assetHolderName,
  assetListEmptyState,
  deviceActiveUser,
  deviceUptime,
  assetListFilterParams,
  assetListSortFields,
  ASSET_LIST_SORT_LABELS,
  defaultAssetTypeFilter,
  toQueryString,
  type AssetCondition,
  type AssetListSortField,
  type AssetStatus,
  type AvailabilityState,
  type LifecycleState,
  type OwnershipType,
} from '@techpioasset/domain';
import { assetPills } from '../../src/asset-pills';
import { ChipPicker } from '../../src/components/chip-picker';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Button, Card, Chevron, EmptyState, Field, IconBadge, ListSkeleton, PullRefresh, StatusPill } from '../../src/components/ui';
import { formatMoney } from '../../src/lib/format';
import {
  AVAILABILITY_OPTIONS,
  LIFECYCLE_OPTIONS,
  NO_FILTERS,
  OWNERSHIP_OPTIONS,
  STATUS_OPTIONS,
  activeFilterLabels,
  assetTypeOptions,
  hasMorePages,
  mergePage,
  quickTypeChips,
  sortSummary,
  type Category,
  type SheetFilters,
} from '../../src/lib/asset-list';

const PAGE_SIZE = 25;

interface AssetRow {
  id: string;
  assetTag: string;
  name: string;
  serialNumber: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  // v2.1 Workstream A — nullable until backfilled / dual-written.
  lifecycleState: LifecycleState | null;
  /** 0.3.33 - the agent's last report, for uptime and the signed-in user. */
  osInfo?: {
    lastBootAt: string | null;
    lastDiscoveredAt: string;
    activeUser: string | null;
    activeUserAt: string | null;
  } | null;
  availabilityState: AvailabilityState | null;
  ownershipType: OwnershipType | null;
  // Absent from the payload entirely without assets:cost:read.
  purchaseCost?: string | null;
  currency?: string | null;
  category: { name: string } | null;
  subcategory: { name: string } | null;
  // The API sends first and last name. This screen used to read a
  // `displayName` that never arrives, so no holder was ever shown.
  assignedUser: {
    id: string;
    email: string;
    profile: { firstName: string; lastName: string } | null;
  } | null;
}

/** A route param as one string - expo-router may hand over an array. */
function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

/**
 * All company assets, the phone's version of the web table (mobile parity).
 *
 * Same endpoint, same parameters, same sorts and the same labels as the web:
 * the query, sort columns, default type, holder name and empty wording all
 * come from @techpioasset/domain. Paged from the server rather than one
 * hundred-row fetch searched on the phone, which hid everything past the
 * hundredth asset.
 */
/** "Up 3d 4h · ravi", or what stands in when the agent has not reported. */
function activityLine(os: NonNullable<AssetRow['osInfo']>): string {
  const input = {
    lastBootAt: os.lastBootAt,
    reportedAt: os.lastDiscoveredAt,
    activeUser: os.activeUser,
    activeUserAt: os.activeUserAt,
  };
  return `${deviceUptime(input).label} · ${deviceActiveUser(input).label}`;
}

export default function AssetsScreen() {
  const { api, user } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ vendorProductId?: string; warrantyWithinDays?: string }>();
  const { c, scheme, spacing, radius } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const canSeeCost = user?.permissions.includes(PERMISSIONS.ASSETS_COST_READ) ?? false;
  const mayCreate = user?.permissions.includes(PERMISSIONS.ASSETS_CREATE) ?? false;

  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<SheetFilters>(NO_FILTERS);
  const [sort, setSort] = useState<AssetListSortField | null>(null);
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');

  // Arrive by link, like the web: a banner says each is on and turns it off.
  const [vendorProductId, setVendorProductId] = useState(one(params.vendorProductId));
  const [warrantyWithinDays, setWarrantyWithinDays] = useState(one(params.warrantyWithinDays));

  const [categories, setCategories] = useState<Category[]>([]);
  /**
   * The list opens on laptops, as the web does, once the catalogue says which
   * type that is. Arriving by link counts as a choice: a link names a set of
   * assets, and a laptop filter on top would show a subset of it.
   */
  const typeChosen = useRef(Boolean(one(params.vendorProductId) || one(params.warrantyWithinDays)));
  const [typeReady, setTypeReady] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<SheetFilters>(NO_FILTERS);
  const [draftSort, setDraftSort] = useState<AssetListSortField | null>(null);
  const [draftOrder, setDraftOrder] = useState<'asc' | 'desc'>('asc');

  // Ignore a slow response for a query the reader has already moved past.
  const latest = useRef(0);

  // A link followed while the tab is already open replaces what it names.
  useEffect(() => {
    const vp = one(params.vendorProductId);
    const wd = one(params.warrantyWithinDays);
    if (!vp && !wd) return;
    typeChosen.current = true;
    setVendorProductId(vp);
    setWarrantyWithinDays(wd);
    setFilters((f) => ({ ...f, type: '' }));
  }, [params.vendorProductId, params.warrantyWithinDays]);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    api
      .request<Category[]>('/categories')
      .then((data) => {
        if (cancelled) return;
        const list = data ?? [];
        setCategories(list);
        if (!typeChosen.current) {
          const laptop = defaultAssetTypeFilter(list);
          if (laptop) setFilters((f) => ({ ...f, type: laptop }));
          typeChosen.current = true;
        }
      })
      // No catalogue, no default to wait for: an unfiltered list beats none.
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setTypeReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const fetchPage = useCallback(
    (n: number) => {
      const pairs = assetListFilterParams({ q, ...filters, warrantyWithinDays, vendorProductId });
      pairs.push(['page', String(n)], ['pageSize', String(PAGE_SIZE)]);
      if (sort) pairs.push(['sort', sort], ['order', order]);
      return api.request<AssetRow[]>(`/assets?${toQueryString(pairs)}`);
    },
    [api, q, filters, warrantyWithinDays, vendorProductId, sort, order],
  );

  const load = useCallback(async () => {
    const token = ++latest.current;
    setLoading(true);
    try {
      const data = (await fetchPage(1)) ?? [];
      if (token !== latest.current) return;
      setRows(data);
      setPage(1);
      setHasMore(hasMorePages(data.length, PAGE_SIZE));
      setFailed(false);
    } catch {
      if (token === latest.current) setFailed(true);
    } finally {
      if (token === latest.current) setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    if (typeReady) void load();
  }, [load, typeReady]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || loading) return;
    const token = latest.current;
    setLoadingMore(true);
    try {
      const data = (await fetchPage(page + 1)) ?? [];
      if (token !== latest.current) return;
      setRows((prev) => mergePage(prev, data));
      setPage((p) => p + 1);
      setHasMore(hasMorePages(data.length, PAGE_SIZE));
    } catch {
      // A failed next page leaves what is already shown; pull to refresh retries.
    } finally {
      setLoadingMore(false);
    }
  };

  const openSheet = () => {
    setDraft(filters);
    setDraftSort(sort);
    setDraftOrder(order);
    setSheetOpen(true);
  };

  const applySheet = () => {
    typeChosen.current = true;
    setFilters(draft);
    setSort(draftSort);
    setOrder(draftOrder);
    setSheetOpen(false);
  };

  const active = activeFilterLabels(filters, categories);
  const quickTypes = useMemo(() => quickTypeChips(categories), [categories]);
  const sortFields = assetListSortFields(canSeeCost);
  const empty = assetListEmptyState({ q, status: filters.status });

  const smallButton = (icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Ionicons name={icon} size={16} color={c.text} />
      <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );

  const banner = (text: string, onPress: () => void) => (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ marginBottom: spacing.sm }}>
      <Text style={{ color: c.brand, fontSize: 13, fontWeight: '600' }}>{text}</Text>
    </Pressable>
  );

  const sectionTitle = (text: string) => (
    <Text
      style={{
        color: c.text,
        fontSize: 13,
        fontWeight: '700',
        marginTop: spacing.lg,
        marginBottom: spacing.sm,
      }}
    >
      {text}
    </Text>
  );

  const header = (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={{ color: c.muted, fontSize: 13, marginBottom: spacing.sm }}>
        {user?.scope === 'OWN'
          ? 'Assets assigned to you.'
          : q
            ? `Results for “${q}”.`
            : 'Everything you are permitted to see.'}
      </Text>
      {warrantyWithinDays
        ? banner(`Warranty ending within ${warrantyWithinDays} days · show all assets`, () =>
            setWarrantyWithinDays(''),
          )
        : null}
      {vendorProductId
        ? banner('Bought from one catalogue listing · show all assets', () => setVendorProductId(''))
        : null}
      <Field
        placeholder="Search by name, tag, serial, brand or model"
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {smallButton('options-outline', active.length ? `Filter (${active.length})` : 'Filter', openSheet)}
        {smallButton('swap-vertical-outline', sortSummary(sort, order), openSheet)}
        {smallButton('qr-code-outline', 'Scan QR', () => router.push('/(tabs)/scan'))}
      </View>
      {/* One tap to a type. The filter sheet has them too, but "show me the
          mice" should not take three taps and a scroll. */}
      {quickTypes.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={{ marginTop: spacing.md, marginHorizontal: -spacing.lg }}
          contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}
        >
          {[{ id: '', name: 'All types' }, ...quickTypes].map((t) => {
            const chosen = filters.type === t.id;
            return (
              <Pressable
                key={t.id || 'all'}
                onPress={() => {
                  typeChosen.current = true;
                  setFilters((f) => ({ ...f, type: t.id }));
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
                accessibilityLabel={`Show ${t.name}`}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: chosen ? c.brand : c.border,
                  backgroundColor: chosen ? c.brand : c.surface,
                }}
              >
                <Text style={{ color: chosen ? c.brandText : c.text, fontSize: 13, fontWeight: '600' }}>
                  {t.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {active.length ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            marginTop: spacing.md,
          }}
        >
          <Text style={{ flex: 1, color: c.muted, fontSize: 12 }} numberOfLines={2}>
            {active.join(' · ')}
          </Text>
          <Pressable
            onPress={() => {
              typeChosen.current = true;
              setFilters(NO_FILTERS);
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear filters"
            hitSlop={8}
          >
            <Text style={{ color: c.brand, fontSize: 13, fontWeight: '700' }}>Clear</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <FlatList
        style={{ flex: 1, backgroundColor: c.background }}
        data={rows}
        keyExtractor={(r) => r.id}
        refreshControl={<PullRefresh refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl * 3, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={header}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={c.brand} /> : null
        }
        ListEmptyComponent={
          loading ? <ListSkeleton /> : failed ? (
            <EmptyState
              icon="cloud-offline-outline"
              title="Could not load assets"
              message="Pull down to try again."
            />
          ) : (
            <EmptyState icon="cube-outline" title={empty.title} message={empty.description} />
          )
        }
        renderItem={({ item }) => {
          const condition = CONDITION_TOKENS[item.condition];
          const ownership = item.ownershipType ? OWNERSHIP_TYPE_TOKENS[item.ownershipType] : null;
          const kind = [item.category?.name, item.subcategory?.name].filter(Boolean).join(' · ');
          return (
            <Card
              onPress={() => router.push(`/asset/${item.id}`)}
              style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
            >
              <IconBadge icon="hardware-chip-outline" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {item.assetTag}
                  {item.serialNumber ? ` · ${item.serialNumber}` : ''}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {kind || '—'}
                </Text>
                <View
                  style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}
                >
                  {assetPills(item, scheme).map((p) => (
                    <StatusPill key={p.label} label={p.label} bg={p.bg} fg={p.fg} />
                  ))}
                </View>
                <View
                  style={{ marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}
                >
                  {condition ? (
                    <StatusPill
                      label={condition.label}
                      bg={palette[condition.tone].bg}
                      fg={palette[condition.tone].fg}
                    />
                  ) : null}
                  {ownership ? (
                    <StatusPill
                      label={ownership.label}
                      bg={palette[ownership.tone].bg}
                      fg={palette[ownership.tone].fg}
                    />
                  ) : null}
                </View>
                {/* 0.3.33 - what the agent last said: how long up, and who was signed in. */}
                {item.osInfo ? (
                  <Text style={{ color: c.muted, fontSize: 12, marginTop: 6 }} numberOfLines={1}>
                    {activityLine(item.osInfo)}
                  </Text>
                ) : null}
                <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Ionicons name="person-outline" size={13} color={c.muted} />
                  <Text style={{ flex: 1, color: c.muted, fontSize: 12 }} numberOfLines={1}>
                    {assetHolderName(item.assignedUser)}
                  </Text>
                  {canSeeCost && 'purchaseCost' in item ? (
                    <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                      {formatMoney(item.purchaseCost, item.currency ?? 'INR')}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Chevron />
            </Card>
          );
        }}
      />

      {/* Registering kit is done standing next to it, so it is one tap from the
          list rather than buried in a menu. */}
      {mayCreate ? (
        <Pressable
          onPress={() => router.push('/asset/new')}
          accessibilityLabel="Add asset"
          style={{
            position: 'absolute',
            right: spacing.lg,
            bottom: spacing.lg,
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: c.brand,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 5,
          }}
        >
          <Ionicons name="add" size={28} color={c.brandText} />
        </Pressable>
      ) : null}

      <Modal visible={sheetOpen} animationType="slide" transparent onRequestClose={() => setSheetOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(2,6,23,0.45)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: c.background,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              // A fixed height, not a maximum: with only a cap, the scrolling
              // body has no size to fill and can collapse, leaving the title and
              // buttons with no options between them.
              height: '85%',
              paddingBottom: spacing.xl,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: spacing.lg,
                borderBottomWidth: 1,
                borderBottomColor: c.border,
              }}
            >
              <Text style={{ flex: 1, color: c.text, fontSize: 17, fontWeight: '800' }}>Filter and sort</Text>
              <Pressable onPress={() => setSheetOpen(false)} accessibilityLabel="Close" hitSlop={10}>
                <Ionicons name="close" size={24} color={c.muted} />
              </Pressable>
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}
              keyboardShouldPersistTaps="handled"
            >
              {sectionTitle('Type')}
              <ChipPicker
                label="Type"
                options={assetTypeOptions(categories)}
                value={draft.type}
                onChange={(type) => setDraft((d) => ({ ...d, type }))}
                allowNone
                noneLabel="All types"
              />
              {sectionTitle('Status')}
              <ChipPicker
                label="Status"
                options={STATUS_OPTIONS}
                value={draft.status}
                onChange={(status) => setDraft((d) => ({ ...d, status }))}
                allowNone
                noneLabel="All statuses"
              />
              {sectionTitle('Lifecycle')}
              <ChipPicker
                label="Lifecycle"
                options={LIFECYCLE_OPTIONS}
                value={draft.lifecycle}
                onChange={(lifecycle) => setDraft((d) => ({ ...d, lifecycle }))}
                allowNone
                noneLabel="Any lifecycle"
              />
              {sectionTitle('Availability')}
              <ChipPicker
                label="Availability"
                options={AVAILABILITY_OPTIONS}
                value={draft.availability}
                onChange={(availability) => setDraft((d) => ({ ...d, availability }))}
                allowNone
                noneLabel="Any availability"
              />
              {sectionTitle('Ownership')}
              <ChipPicker
                label="Ownership"
                options={OWNERSHIP_OPTIONS}
                value={draft.ownership}
                onChange={(ownership) => setDraft((d) => ({ ...d, ownership }))}
                allowNone
                noneLabel="Any ownership"
              />

              {sectionTitle('Sort by')}
              <ChipPicker
                label="Sort by"
                options={sortFields.map((f) => ({ id: f, name: ASSET_LIST_SORT_LABELS[f] }))}
                value={draftSort ?? ''}
                onChange={(id) => {
                  setDraftSort(id ? (id as AssetListSortField) : null);
                  setDraftOrder('asc');
                }}
                allowNone
                noneLabel="Newest first"
              />
              {draftSort ? (
                <>
                  {sectionTitle('Order')}
                  <ChipPicker
                    label="Order"
                    options={[
                      { id: 'asc', name: 'Ascending' },
                      { id: 'desc', name: 'Descending' },
                    ]}
                    value={draftOrder}
                    onChange={(id) => setDraftOrder(id === 'desc' ? 'desc' : 'asc')}
                  />
                </>
              ) : null}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg }}>
              <Button
                label="Clear all"
                variant="secondary"
                onPress={() => {
                  setDraft(NO_FILTERS);
                  setDraftSort(null);
                  setDraftOrder('asc');
                }}
                style={{ flex: 1 }}
              />
              <Button label="Show assets" onPress={applySheet} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
