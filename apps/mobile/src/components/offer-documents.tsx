import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  PRODUCT_DOCUMENT_KINDS,
  PRODUCT_DOCUMENT_LABELS,
  PRODUCT_DOCUMENT_RULES,
  documentTitle,
  type ProductDocumentKind,
} from '@techpioasset/domain';
import { ApiError } from '../lib/api-client';
import { useSession } from '../providers/session';
import { useTheme } from '../theme';
import { OfferPhotoSheet } from './offer-photo-sheet';
import { Button, Card, SectionTitle } from './ui';

/**
 * The paperwork on an offer, on the phone (v2.55).
 *
 * Opening a document goes through a two-minute signed link handed to the
 * system browser. The phone can open a link but cannot attach a sign-in header
 * to it, and the other way - a native file-handling module - would mean a new
 * app build that everybody has to reinstall.
 *
 * Adding one is by camera. That covers the case that matters most on a phone:
 * a certificate that exists as a sheet of paper. A PDF on the supplier's
 * computer is added from the web app, and the empty state says so.
 */

interface OfferDocument {
  id: string;
  kind: ProductDocumentKind;
  title: string | null;
  sizeBytes: number;
}

const readableSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

export function OfferDocuments({
  productId,
  canManage,
}: {
  productId: string;
  canManage: boolean;
}) {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [documents, setDocuments] = useState<OfferDocument[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<ProductDocumentKind | null>(null);
  const [choosing, setChoosing] = useState(false);

  const load = useCallback(async () => {
    try {
      setDocuments(
        (await api.request<OfferDocument[]>(`/vendor-products/${productId}/documents`)) ?? [],
      );
    } catch {
      setDocuments([]);
    }
  }, [api, productId]);

  useEffect(() => void load(), [load]);

  const open = async (doc: OfferDocument) => {
    setOpening(doc.id);
    try {
      const link = await api.request<{ path: string }>(
        `/vendor-products/${productId}/documents/${doc.id}/link`,
        { method: 'POST' },
      );
      await Linking.openURL(api.absoluteUrl(link.path));
    } catch (error) {
      Alert.alert(
        'Could not open the document',
        error instanceof ApiError ? error.message : 'Please try again.',
      );
    } finally {
      setOpening(null);
    }
  };

  const remove = (doc: OfferDocument) =>
    Alert.alert('Remove this document?', 'It stays on record; it just stops showing here.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void api
            .request(`/vendor-products/${productId}/documents/${doc.id}`, { method: 'DELETE' })
            .then(load)
            .catch((error) =>
              Alert.alert(
                'Could not remove it',
                error instanceof ApiError ? error.message : 'Please try again.',
              ),
            ),
      },
    ]);

  if (documents === null) return null;
  // Nothing to read and nothing to add: no empty card on a buyer's screen.
  if (!canManage && documents.length === 0) return null;

  return (
    <>
      <SectionTitle>Documents</SectionTitle>
      <Card>
        {documents.length === 0 ? (
          <Text style={{ color: c.muted, fontSize: 13, marginBottom: spacing.md }}>
            Nothing attached yet. Photograph a certificate below, or add a PDF from the web app.
          </Text>
        ) : (
          documents.map((doc) => (
            <View
              key={doc.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: c.border,
              }}
            >
              <Pressable
                onPress={() => void open(doc)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${documentTitle(doc)}`}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <Ionicons name="document-text-outline" size={20} color={c.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>
                    {documentTitle(doc)}
                  </Text>
                  <Text style={{ color: c.subtle, fontSize: 12 }}>
                    {opening === doc.id
                      ? 'Opening…'
                      : `${PRODUCT_DOCUMENT_LABELS[doc.kind]} · ${readableSize(doc.sizeBytes)}`}
                  </Text>
                </View>
              </Pressable>
              {canManage ? (
                <Pressable
                  onPress={() => remove(doc)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${documentTitle(doc)}`}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={18} color={c.danger} />
                </Pressable>
              ) : null}
            </View>
          ))
        )}

        {canManage && documents.length < PRODUCT_DOCUMENT_RULES.max ? (
          choosing ? (
            // Inline rather than an Alert: Android's native alert shows at most
            // three buttons and silently drops the rest, so most kinds would
            // simply not have been offered. The server needs the kind because
            // a photograph of a page does not say what the page is.
            <View style={{ marginTop: spacing.md }}>
              <Text style={{ color: c.muted, fontSize: 12, marginBottom: 8 }}>
                What are you photographing?
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {PRODUCT_DOCUMENT_KINDS.map((kind) => (
                  <Pressable
                    key={kind}
                    accessibilityRole="button"
                    onPress={() => {
                      setChoosing(false);
                      setCapturing(kind);
                    }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: c.border,
                      backgroundColor: c.surface,
                    }}
                  >
                    <Text style={{ color: c.text, fontSize: 13 }}>
                      {PRODUCT_DOCUMENT_LABELS[kind]}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={() => setChoosing(false)}
                accessibilityRole="button"
                style={{ paddingVertical: 10 }}
              >
                <Text style={{ color: c.muted, fontSize: 13 }}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <Button
              label="Photograph a document"
              icon="camera-outline"
              variant="secondary"
              onPress={() => setChoosing(true)}
              style={{ marginTop: spacing.md }}
            />
          )
        ) : null}
      </Card>

      {capturing ? (
        <OfferPhotoSheet
          visible
          productId={productId}
          imageCount={documents.length}
          document={{ kind: capturing }}
          onClose={() => setCapturing(null)}
          onUploaded={() => void load()}
        />
      ) : null}
    </>
  );
}
