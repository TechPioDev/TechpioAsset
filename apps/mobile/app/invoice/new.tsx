import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { PERMISSIONS } from '@techpioasset/domain';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { ChipPicker } from '../../src/components/chip-picker';
import { problemMessage, todayIso } from '../../src/lib/asset-admin';
import { formatMoney } from '../../src/lib/format';
import {
  buildCreateInvoicePayload,
  computedLineTotal,
  emptyInvoiceDraft,
  emptyLine,
  MAX_LINES,
  previewInvoice,
  previewWarnings,
  validateInvoiceDraft,
  type InvoiceDraft,
  type InvoiceLineDraft,
} from '../../src/lib/invoice-entry';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Button, Card, EmptyState, Field, Screen, SectionTitle } from '../../src/components/ui';

interface Vendor {
  id: string;
  name: string;
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  vendor: { id: string; name: string } | null;
}

/** INR first; the company's own currency joins the list when it is something else. */
const COMMON_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];

/**
 * Enter a bill by hand, on the phone - POST /invoices, the path that works with
 * AI switched off. The web /invoices/new form sends the same body.
 *
 * Gated on invoices:upload, the permission the API checks: invoices carry
 * purchase cost, which only Finance, Office Admin and Super Admin may enter.
 * Totals on screen are exact-decimal previews; the server recomputes them and
 * records any mismatch for a reviewer rather than trusting this screen.
 */
export default function NewInvoiceScreen() {
  const { api, user } = useSession();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  const router = useRouter();

  const can = (permission: string) => user?.permissions.includes(permission) ?? false;
  const canAdd = can(PERMISSIONS.INVOICES_UPLOAD);
  const canReadPos = can(PERMISSIONS.PURCHASE_ORDERS_READ);
  const canReadCompany = can(PERMISSIONS.SETTINGS_MANAGE);

  const [draft, setDraft] = useState<InvoiceDraft>(() => emptyInvoiceDraft('INR', todayIso()));
  const [baseCurrency, setBaseCurrency] = useState('INR');
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof InvoiceDraft>(key: K, value: InvoiceDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setLine = (index: number, patch: Partial<InvoiceLineDraft>) =>
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));

  useEffect(() => {
    if (!canAdd) return;
    api
      .request<Vendor[]>('/vendors')
      .then((rows) => setVendors(rows ?? []))
      .catch(() => setVendors([]));
    // The PO link is optional, so a failure here only leaves the number box.
    if (canReadPos) {
      api
        .request<PurchaseOrder[]>('/procurement/orders?pageSize=100')
        .then((rows) => setOrders(rows ?? []))
        .catch(() => setOrders([]));
    }
    // GET /company needs settings:manage. Finance usually lacks it, and INR
    // is this product's home currency, so INR stands in rather than failing.
    if (canReadCompany) {
      api
        .request<{ baseCurrency: string }>('/company')
        .then((company) => {
          if (!company?.baseCurrency) return;
          setBaseCurrency(company.baseCurrency);
          // Only while untouched: never overwrite a currency someone chose.
          setDraft((d) => (d.currency === 'INR' ? { ...d, currency: company.baseCurrency } : d));
        })
        .catch(() => undefined);
    }
  }, [api, canAdd, canReadPos, canReadCompany]);

  const preview = useMemo(() => previewInvoice(draft), [draft]);
  const warnings = useMemo(() => previewWarnings(draft), [draft]);
  const currencies = useMemo(
    () =>
      [...new Set([baseCurrency, ...COMMON_CURRENCIES, draft.currency])].map((code) => ({
        id: code,
        name: code,
      })),
    [baseCurrency, draft.currency],
  );

  if (!canAdd) {
    return (
      <Screen>
        <EmptyState
          icon="lock-closed-outline"
          title="Not available"
          message="Adding invoices is for Finance, Office Admin and Super Admin."
        />
      </Screen>
    );
  }

  function choosePurchaseOrder(id: string) {
    const po = orders.find((o) => o.id === id);
    setDraft((d) => ({
      ...d,
      purchaseOrderId: id,
      purchaseOrderNumber: po?.poNumber ?? '',
      // A PO names its supplier; fill it in only if nobody has chosen one yet.
      vendorId: d.vendorId || po?.vendor?.id || '',
    }));
  }

  async function submit() {
    const problem = validateInvoiceDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const created = await api.request<{ id: string }>('/invoices', {
        method: 'POST',
        body: buildCreateInvoicePayload(draft),
      });
      // Straight to the invoice, where the verification result is waiting.
      router.replace(`/invoice/${created.id}`);
    } catch (caught) {
      setError(
        problemMessage(caught, 'Could not save the invoice. Check the fields and try again.'),
      );
    } finally {
      setBusy(false);
    }
  }

  const money = (value: string | null) =>
    value === null ? '—' : formatMoney(value, draft.currency);
  const label = (text: string) => (
    <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>{text}</Text>
  );

  return (
    <Screen scroll>
      <SectionTitle>Vendor</SectionTitle>
      {vendors === null ? (
        <Text style={{ color: c.muted, fontSize: 13, marginBottom: spacing.lg }}>
          Loading vendors…
        </Text>
      ) : vendors.length === 0 ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19 }}>
            No vendors to choose from. Add the vendor on the web (Settings → Vendors) first.
          </Text>
        </Card>
      ) : (
        <View style={{ marginBottom: spacing.lg }}>
          <ChipPicker
            label="Vendor"
            options={vendors}
            value={draft.vendorId}
            onChange={(id) => set('vendorId', id)}
          />
        </View>
      )}

      <SectionTitle>Invoice</SectionTitle>
      <Field
        label="Invoice number"
        placeholder="e.g. INV-2026-0142"
        autoCapitalize="characters"
        maxLength={100}
        value={draft.invoiceNumber}
        onChangeText={(v) => set('invoiceNumber', v)}
      />
      <Field
        label="Invoice date (YYYY-MM-DD)"
        placeholder="2026-09-14"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        value={draft.invoiceDate}
        onChangeText={(v) => set('invoiceDate', v)}
      />
      <Field
        label="Due date (optional)"
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        value={draft.dueDate}
        onChangeText={(v) => set('dueDate', v)}
      />
      <Field
        label="Purchase date (optional)"
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        value={draft.purchaseDate}
        onChangeText={(v) => set('purchaseDate', v)}
      />
      {label('Currency')}
      <View style={{ marginBottom: spacing.lg }}>
        <ChipPicker
          label="Currency"
          options={currencies}
          value={draft.currency}
          onChange={(code) => set('currency', code)}
        />
      </View>

      <SectionTitle>Purchase order</SectionTitle>
      {orders.length > 0 ? (
        <View style={{ marginBottom: spacing.md }}>
          <ChipPicker
            label="Purchase order"
            options={orders.map((o) => ({
              id: o.id,
              name: o.vendor ? `${o.poNumber} · ${o.vendor.name}` : o.poNumber,
            }))}
            value={draft.purchaseOrderId}
            onChange={choosePurchaseOrder}
            allowNone
            noneLabel="No purchase order"
          />
        </View>
      ) : null}
      {!draft.purchaseOrderId ? (
        <Field
          label="PO number (optional)"
          placeholder="As printed on the bill"
          autoCapitalize="characters"
          maxLength={64}
          value={draft.purchaseOrderNumber}
          onChangeText={(v) => set('purchaseOrderNumber', v)}
        />
      ) : null}

      <SectionTitle style={{ marginTop: spacing.sm }}>
        Line items · {draft.lines.length}
      </SectionTitle>
      {draft.lines.map((line, index) => {
        const computed = computedLineTotal(line);
        return (
          <Card key={index} style={{ marginBottom: spacing.md }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: spacing.sm,
              }}
            >
              <Text style={{ color: c.text, fontWeight: '700' }}>Line {index + 1}</Text>
              {draft.lines.length > 1 ? (
                <Pressable
                  onPress={() =>
                    set(
                      'lines',
                      draft.lines.filter((_, i) => i !== index),
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Remove line ${index + 1}`}
                  hitSlop={10}
                >
                  <Ionicons name="trash-outline" size={18} color={c.danger} />
                </Pressable>
              ) : null}
            </View>
            <Field
              label="Description"
              placeholder="e.g. Dell Latitude 7450"
              maxLength={500}
              value={line.description}
              onChangeText={(v) => setLine(index, { description: v })}
            />
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Quantity"
                  keyboardType="decimal-pad"
                  value={line.quantity}
                  onChangeText={(v) => setLine(index, { quantity: v })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Unit price"
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  value={line.unitPrice}
                  onChangeText={(v) => setLine(index, { unitPrice: v })}
                />
              </View>
            </View>
            <Field
              label="Line total"
              // Blank saves quantity x unit price; type a figure only when the
              // bill prints a different one.
              placeholder={computed ?? 'Quantity × unit price'}
              keyboardType="decimal-pad"
              value={line.lineTotal}
              onChangeText={(v) => setLine(index, { lineTotal: v })}
            />
          </Card>
        );
      })}
      {draft.lines.length < MAX_LINES ? (
        <Button
          label="Add line"
          icon="add"
          variant="secondary"
          onPress={() => set('lines', [...draft.lines, emptyLine()])}
          style={{ marginBottom: spacing.xl }}
        />
      ) : null}

      <SectionTitle>Charges</SectionTitle>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Field
            label="Discount"
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={draft.discount}
            onChangeText={(v) => set('discount', v)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Tax"
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={draft.tax}
            onChangeText={(v) => set('tax', v)}
          />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Field
            label="Shipping"
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={draft.shipping}
            onChangeText={(v) => set('shipping', v)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Other charges"
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={draft.otherCharges}
            onChangeText={(v) => set('otherCharges', v)}
          />
        </View>
      </View>

      <SectionTitle style={{ marginTop: spacing.sm }}>Totals</SectionTitle>
      <Card style={{ marginBottom: spacing.md, gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: c.muted }}>Subtotal</Text>
          <Text style={{ color: c.text, fontWeight: '600' }}>{money(preview.subtotal)}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: c.muted }}>Total</Text>
          <Text style={{ color: c.text, fontWeight: '800' }}>{money(preview.total)}</Text>
        </View>
        <Text style={{ color: c.subtle, fontSize: 12 }}>
          A preview. The server checks every figure again when you save.
        </Text>
      </Card>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Field
            label="Subtotal on bill"
            placeholder={preview.computedSubtotal ?? 'From the lines'}
            keyboardType="decimal-pad"
            value={draft.subtotal}
            onChangeText={(v) => set('subtotal', v)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Total on bill"
            placeholder={preview.computedTotal ?? 'Calculated'}
            keyboardType="decimal-pad"
            value={draft.total}
            onChangeText={(v) => set('total', v)}
          />
        </View>
      </View>
      <Text
        style={{ color: c.subtle, fontSize: 12, marginTop: -spacing.sm, marginBottom: spacing.md }}
      >
        Leave these blank to use the calculated figures.
      </Text>

      {warnings.length > 0 ? (
        <View style={{ gap: 6, marginBottom: spacing.md }}>
          {warnings.map((warning) => (
            <Text
              key={warning}
              style={{
                color: palette.warning.fg,
                backgroundColor: palette.warning.bg,
                borderColor: palette.warning.border,
                borderWidth: 1,
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 6,
                fontSize: 13,
              }}
            >
              {warning}
            </Text>
          ))}
        </View>
      ) : null}

      <Field
        label="Notes (optional)"
        multiline
        maxLength={2000}
        value={draft.notes}
        onChangeText={(v) => set('notes', v)}
      />

      {error ? (
        <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text>
      ) : null}

      <Button
        label="Save invoice"
        icon="checkmark"
        onPress={() => void submit()}
        loading={busy}
        disabled={!vendors?.length}
      />
      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}
