'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileText, Upload } from 'lucide-react';
import { apiFetch, ApiError, getAccessToken, API_BASE } from '@/lib/api-client';
import { Button, Card, Field } from '@/components/ui';

interface Vendor {
  id: string;
  name: string;
}

/**
 * Upload page. Uses a raw fetch with FormData rather than the JSON api-client,
 * because the body is multipart — but it reuses the same access token and refresh
 * behaviour by reading getAccessToken().
 */
export default function InvoiceUploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [vendorId, setVendorId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: vendors } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => apiFetch<Vendor[]>('/vendors'),
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setError(null);
    setSubmitting(true);

    const form = new FormData();
    form.append('file', file);
    if (vendorId) form.append('vendorId', vendorId);

    try {
      const response = await fetch(`${API_BASE}/invoices/upload`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        body: form,
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => null);
        throw new ApiError(problem, response.status);
      }
      const payload = (await response.json()) as { data: { invoice: { id: string } } };
      router.push(`/invoices/${payload.data.invoice.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.problem?.detail ?? caught.problem?.title ?? 'Upload failed')
          : 'Upload failed.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Upload invoice</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          PDF, JPG, PNG or HEIC. If AI is enabled it will extract the fields for you to review;
          otherwise you can enter them manually on the next screen. No file?{' '}
          <Link
            href="/invoices/new"
            className="font-medium text-[var(--color-brand)] hover:underline"
          >
            Enter the invoice manually
          </Link>
          .
        </p>
      </header>

      <form onSubmit={onSubmit} className="grid gap-4">
        <Card className="grid gap-4 p-5">
          <div>
            <label
              htmlFor="file"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] px-6 py-10 text-center hover:bg-[var(--color-surface-sunken)]"
            >
              {file ? (
                <>
                  <FileText aria-hidden="true" className="size-8 text-[var(--color-brand)]" />
                  <span className="text-sm font-medium">{file.name}</span>
                  <span className="text-xs text-[var(--color-content-subtle)]">
                    {(file.size / 1024).toFixed(0)} KB — click to change
                  </span>
                </>
              ) : (
                <>
                  <Upload
                    aria-hidden="true"
                    className="size-8 text-[var(--color-content-subtle)]"
                  />
                  <span className="text-sm font-medium">Choose a file</span>
                  <span className="text-xs text-[var(--color-content-subtle)]">
                    or drag and drop
                  </span>
                </>
              )}
            </label>
            <input
              id="file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/heic"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <Field
            label="Vendor (optional)"
            htmlFor="vendorId"
            hint="You can set this during review too."
          >
            <select
              id="vendorId"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-sm"
            >
              <option value="">Unknown — assign later</option>
              {vendors?.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </Field>
        </Card>

        {error ? (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
            style={{
              color: 'var(--tone-critical-fg)',
              backgroundColor: 'var(--tone-critical-bg)',
              borderColor: 'var(--tone-critical-border)',
            }}
          >
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting} disabled={!file}>
            Upload and process
          </Button>
        </div>
      </form>
    </div>
  );
}
