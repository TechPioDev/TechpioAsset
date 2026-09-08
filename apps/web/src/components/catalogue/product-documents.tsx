'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2, Upload } from 'lucide-react';
import {
  PRODUCT_DOCUMENT_KINDS,
  PRODUCT_DOCUMENT_LABELS,
  PRODUCT_DOCUMENT_RULES,
  documentTitle,
  type ProductDocumentKind,
} from '@techpioasset/domain';
import { API_BASE, apiFetch, getAccessToken } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, controlCls, Field, NativeSelect } from '@/components/ui';

/**
 * The paperwork on a product (v2.49).
 *
 * Readable by anyone who can see the offer, editable by whoever can manage it.
 *
 * Files are fetched with the caller's token and handed to the browser as a
 * blob rather than linked with a bare href: the endpoint is authenticated, so
 * a plain link would open a 401 page instead of the document.
 */

interface ProductDocument {
  id: string;
  kind: ProductDocumentKind;
  title: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

const readableSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

export function ProductDocuments({
  productId,
  canManage,
}: {
  productId: string;
  canManage: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ProductDocumentKind>('DATASHEET');
  const [title, setTitle] = useState('');

  const query = useQuery({
    queryKey: ['product-documents', productId],
    queryFn: () => apiFetch<ProductDocument[]>(`/vendor-products/${productId}/documents`),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      body.append('kind', kind);
      if (title.trim()) body.append('title', title.trim());
      const response = await fetch(`${API_BASE}/vendor-products/${productId}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        body,
      });
      if (!response.ok) {
        // The server names the actual rule - wrong type, too large, too many -
        // which is more use than anything generic said here.
        const problem = await response.json().catch(() => null);
        throw new Error(problem?.detail ?? problem?.title ?? 'Could not add the document');
      }
    },
    onSuccess: async () => {
      toast.success('Document added');
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
      await queryClient.invalidateQueries({ queryKey: ['product-documents', productId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add the document'),
  });

  const remove = useMutation({
    mutationFn: (documentId: string) =>
      apiFetch(`/vendor-products/${productId}/documents/${documentId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Document removed');
      await queryClient.invalidateQueries({ queryKey: ['product-documents', productId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not remove it'),
  });

  const openDocument = async (doc: ProductDocument) => {
    try {
      const response = await fetch(
        `${API_BASE}/vendor-products/${productId}/documents/${doc.id}`,
        { headers: { Authorization: `Bearer ${getAccessToken()}` } },
      );
      if (!response.ok) throw new Error('Could not open the document');
      const url = URL.createObjectURL(await response.blob());
      window.open(url, '_blank', 'noopener,noreferrer');
      // Long enough for the tab to have taken it, short enough not to leak.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open the document');
    }
  };

  const documents = query.data ?? [];
  // Nothing to show and nothing to add: no empty card taking up the page.
  if (!canManage && documents.length === 0) return null;

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">Documents</h2>
      <p className="mb-3 text-xs text-[var(--color-content-muted)]">
        Datasheets, manuals and certificates. PDF or an image, up to{' '}
        {PRODUCT_DOCUMENT_RULES.maxBytes / 1024 / 1024} MB, {PRODUCT_DOCUMENT_RULES.max} per
        product.
      </p>

      {documents.length === 0 ? (
        <p className="text-sm text-[var(--color-content-subtle)]">Nothing attached yet.</p>
      ) : (
        <ul className="grid gap-1">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-2 last:border-0"
            >
              <button
                type="button"
                onClick={() => void openDocument(doc)}
                className="flex min-w-0 items-center gap-2 text-left text-sm hover:underline"
              >
                <FileText aria-hidden="true" className="size-4 shrink-0 text-[var(--color-brand)]" />
                <span className="truncate">{documentTitle(doc)}</span>
              </button>
              <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--color-content-subtle)]">
                {PRODUCT_DOCUMENT_LABELS[doc.kind]} · {readableSize(doc.sizeBytes)}
                {canManage ? (
                  <button
                    type="button"
                    aria-label={`Remove ${documentTitle(doc)}`}
                    onClick={() => remove.mutate(doc.id)}
                    className="text-[var(--color-destructive)] hover:opacity-80"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canManage && documents.length < PRODUCT_DOCUMENT_RULES.max ? (
        <div className="mt-4 grid gap-3 border-t border-[var(--color-border)] pt-4 sm:grid-cols-2">
          <Field label="What is it?" htmlFor="doc-kind">
            <NativeSelect
              id="doc-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as ProductDocumentKind)}
            >
              {PRODUCT_DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PRODUCT_DOCUMENT_LABELS[k]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Title"
            htmlFor="doc-title"
            hint="Optional — the kind is used if you leave it blank"
          >
            <input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Latitude 5420 datasheet"
              className={controlCls}
            />
          </Field>
          <div className="sm:col-span-2">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
              }}
            />
            <Button
              variant="secondary"
              loading={upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <Upload aria-hidden="true" className="mr-1 size-4" /> Add a document
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
