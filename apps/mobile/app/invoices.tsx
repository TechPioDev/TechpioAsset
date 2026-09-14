import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { PERMISSIONS } from '@techpioasset/domain';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { formatMoney } from '../src/lib/format';
import {
  PICKER_UNAVAILABLE_MESSAGE,
  pickImageFromLibrary,
  uploadInvoiceImage,
} from '../src/lib/pick-image';
import {
  Card,
  Chevron,
  EmptyState,
  IconBadge,
  StatusPill,
  type IconName,
} from '../src/components/ui';

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  currency: string;
  total: string | null;
  paymentStatus: string;
  verificationStatus: string;
  vendor: { name: string } | null;
}

export default function InvoicesScreen() {
  const { api, user } = useSession();
  const { c, spacing, radius } = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same gate as POST /invoices and /invoices/upload. Invoices carry purchase
  // cost, which only Finance, Office Admin and Super Admin may enter.
  const canAdd = user?.permissions.includes(PERMISSIONS.INVOICES_UPLOAD) ?? false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.request<InvoiceRow[]>('/invoices?pageSize=50')) ?? []);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  async function uploadFromGallery() {
    setSheetOpen(false);
    setError(null);
    // iOS will not present the picker over a sheet that is still sliding away.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const picked = await pickImageFromLibrary();
    if (picked.kind === 'cancelled') return;
    if (picked.kind === 'denied') {
      setError('Photo access is off for PioAssets. Allow it in Settings to choose a saved bill.');
      return;
    }
    if (picked.kind === 'unavailable') {
      setError(PICKER_UNAVAILABLE_MESSAGE);
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadInvoiceImage(api, picked.image);
      // Straight to the invoice: that is where the fields get checked or entered.
      router.push(`/invoice/${uploaded.invoice.id}`);
      void load();
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'Upload failed. Check your connection and try again.',
      );
    } finally {
      setUploading(false);
    }
  }

  const options: { icon: IconName; label: string; hint: string; onPress: () => void }[] = [
    {
      icon: 'create-outline',
      label: 'Enter manually',
      hint: 'Type the vendor, lines and totals from the bill',
      onPress: () => {
        setSheetOpen(false);
        router.push('/invoice/new');
      },
    },
    // Photographing and picking are device flows; the browser build has neither.
    ...(Platform.OS === 'web'
      ? []
      : [
          {
            icon: 'camera-outline' as IconName,
            label: 'Photograph a bill',
            hint: 'Use the camera, then upload',
            onPress: () => {
              setSheetOpen(false);
              router.push('/(tabs)/capture');
            },
          },
          {
            icon: 'images-outline' as IconName,
            label: 'Choose from gallery',
            hint: 'Upload a saved photo of a bill',
            onPress: () => void uploadFromGallery(),
          },
        ]),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <FlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 96, flexGrow: 1 }}
        ListHeaderComponent={
          error ? (
            <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text>
          ) : null
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="document-attach-outline"
              title="No invoices yet"
              message={
                canAdd
                  ? 'Tap + to enter a bill, photograph one or choose a saved photo.'
                  : 'Bills captured by Finance will appear here.'
              }
            />
          )
        }
        renderItem={({ item }) => (
          <Card
            onPress={() => router.push(`/invoice/${item.id}`)}
            style={{
              marginBottom: spacing.md,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
            }}
          >
            <IconBadge icon="document-attach-outline" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                {item.invoiceNumber}
              </Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {item.vendor?.name ?? 'Unknown vendor'}
                {item.invoiceDate ? ` · ${new Date(item.invoiceDate).toLocaleDateString()}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              {item.total ? (
                <Text style={{ color: c.text, fontWeight: '700' }}>
                  {formatMoney(item.total, item.currency)}
                </Text>
              ) : null}
              <StatusPill label={item.paymentStatus} bg={c.brandSoft} fg={c.brand} />
            </View>
            <Chevron />
          </Card>
        )}
      />

      {canAdd ? (
        <Pressable
          onPress={() => setSheetOpen(true)}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel="Add an invoice"
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
          {uploading ? (
            <ActivityIndicator color={c.brandText} />
          ) : (
            <Ionicons name="add" size={28} color={c.brandText} />
          )}
        </Pressable>
      ) : null}

      {/* A sheet rather than an Alert: Android shows at most three Alert buttons,
          and three choices plus Cancel is four. */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(2,6,23,0.45)' }}
          onPress={() => setSheetOpen(false)}
          accessibilityLabel="Close"
        />
        <View
          style={{
            backgroundColor: c.background,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            padding: spacing.lg,
            paddingBottom: spacing.xxl,
            gap: spacing.sm,
          }}
        >
          <Text
            style={{ color: c.text, fontSize: 17, fontWeight: '800', marginBottom: spacing.sm }}
          >
            Add an invoice
          </Text>
          {options.map((option) => (
            <Pressable
              key={option.label}
              onPress={option.onPress}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                padding: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.card,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <IconBadge icon={option.icon} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>
                  {option.label}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>{option.hint}</Text>
              </View>
              <Chevron />
            </Pressable>
          ))}
          <Pressable
            onPress={() => setSheetOpen(false)}
            accessibilityRole="button"
            style={{ padding: spacing.md, alignItems: 'center' }}
          >
            <Text style={{ color: c.muted, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}
