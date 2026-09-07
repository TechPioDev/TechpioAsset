'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import {
  Button,
  Card,
  controlCls,
  EmptyState,
  Field,
  NativeSelect,
  Skeleton,
} from '@/components/ui';

/**
 * Specification templates (v2.42).
 *
 * What a category's offers are described by, and so what buyers can compare
 * them on. Editable here because the fields worth asking a laptop supplier for
 * are not the ones worth asking a chair supplier for, and nobody should need a
 * release to add a row.
 *
 * Behind the catalogue review permission - the people who assess offers decide
 * what an offer is described by. Suppliers can read a template but never edit
 * one, or they would be setting the questions they are marked on.
 */

type Category = { id: string; name: string };
type SpecField = {
  id: string;
  key: string;
  label: string;
  dataType: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'ENUM';
  unit: string | null;
  intent: 'AT_LEAST' | 'AT_MOST' | 'EXACTLY' | null;
  tolerance: string | null;
  options: string[];
  isRequired: boolean;
  isComparable: boolean;
  sortOrder: number;
};

type Draft = {
  key: string;
  label: string;
  dataType: SpecField['dataType'];
  unit: string;
  intent: string;
  tolerance: string;
  options: string;
  isRequired: boolean;
  isComparable: boolean;
};

const EMPTY: Draft = {
  key: '',
  label: '',
  dataType: 'TEXT',
  unit: '',
  intent: 'AT_LEAST',
  tolerance: '',
  options: '',
  isRequired: false,
  isComparable: true,
};

/** "Screen size" -> "screen_size". A machine key nobody should have to invent. */
const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, 'f$1');

function FieldForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(EMPTY);
  const [keyEdited, setKeyEdited] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      <Field label="Label" htmlFor="sf-label" hint="What people see, e.g. “RAM”.">
        <input
          id="sf-label"
          required
          value={draft.label}
          onChange={(e) => {
            set('label', e.target.value);
            if (!keyEdited) set('key', slug(e.target.value));
          }}
          className={controlCls}
        />
      </Field>
      <Field
        label="Key"
        htmlFor="sf-key"
        hint="Cannot be changed once offers exist in this category."
      >
        <input
          id="sf-key"
          required
          pattern="[a-z][a-z0-9_]*"
          value={draft.key}
          onChange={(e) => {
            setKeyEdited(true);
            set('key', e.target.value);
          }}
          className={controlCls}
        />
      </Field>
      <Field label="Kind" htmlFor="sf-type">
        <NativeSelect
          id="sf-type"
          value={draft.dataType}
          onChange={(e) => set('dataType', e.target.value as Draft['dataType'])}
        >
          <option value="TEXT">Text</option>
          <option value="NUMBER">Number</option>
          <option value="BOOLEAN">Yes / no</option>
          <option value="ENUM">Choose from a list</option>
        </NativeSelect>
      </Field>
      {draft.dataType === 'NUMBER' ? (
        <>
          <Field label="Unit" htmlFor="sf-unit" hint="GB, kg, inches…">
            <input
              id="sf-unit"
              value={draft.unit}
              onChange={(e) => set('unit', e.target.value)}
              className={controlCls}
            />
          </Field>
          <Field
            label="Which way it points"
            htmlFor="sf-intent"
            hint="“16 GB” means at least; “1.4 kg” means at most. Getting this wrong inverts the comparison."
          >
            <NativeSelect
              id="sf-intent"
              value={draft.intent}
              onChange={(e) => set('intent', e.target.value)}
            >
              <option value="AT_LEAST">At least this much</option>
              <option value="AT_MOST">At most this much</option>
              <option value="EXACTLY">Exactly this</option>
            </NativeSelect>
          </Field>
          <Field
            label="Tolerance"
            htmlFor="sf-tolerance"
            hint="How far off still counts as a partial match, as a fraction. Blank uses 0.1 (10%)."
          >
            <input
              id="sf-tolerance"
              type="number"
              min={0}
              max={1}
              step="0.01"
              value={draft.tolerance}
              onChange={(e) => set('tolerance', e.target.value)}
              className={controlCls}
            />
          </Field>
        </>
      ) : null}
      {draft.dataType === 'ENUM' ? (
        <div className="sm:col-span-2">
          <Field label="Choices" htmlFor="sf-options" hint="One per line. At least two.">
            <textarea
              id="sf-options"
              rows={3}
              value={draft.options}
              onChange={(e) => set('options', e.target.value)}
              className={controlCls}
            />
          </Field>
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.isRequired}
          onChange={(e) => set('isRequired', e.target.checked)}
          className="size-4"
        />
        Suppliers must fill this in before an offer can go for review
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.isComparable}
          onChange={(e) => set('isComparable', e.target.checked)}
          className="size-4"
        />
        Buyers can compare on it
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" loading={busy}>
          Add field
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function SpecTemplatesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [categoryId, setCategoryId] = useState('');
  const [adding, setAdding] = useState(false);

  const allowed = Boolean(user?.permissions?.includes(PERMISSIONS.VENDOR_PRODUCTS_REVIEW));

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
  });

  const fields = useQuery({
    queryKey: ['spec-templates', categoryId],
    queryFn: () => apiFetch<SpecField[]>(`/spec-templates?categoryId=${categoryId}`),
    enabled: Boolean(categoryId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['spec-templates', categoryId] });

  const create = useMutation({
    mutationFn: (draft: Draft) =>
      apiFetch('/spec-templates', {
        method: 'POST',
        body: {
          categoryId,
          key: draft.key,
          label: draft.label,
          dataType: draft.dataType,
          ...(draft.dataType === 'NUMBER'
            ? {
                intent: draft.intent,
                ...(draft.unit.trim() ? { unit: draft.unit.trim() } : {}),
                ...(draft.tolerance.trim() ? { tolerance: Number(draft.tolerance) } : {}),
              }
            : {}),
          ...(draft.dataType === 'ENUM'
            ? { options: draft.options.split('\n').map((o) => o.trim()).filter(Boolean) }
            : {}),
          isRequired: draft.isRequired,
          isComparable: draft.isComparable,
          sortOrder: (fields.data?.length ?? 0) + 1,
        },
      }),
    onSuccess: async () => {
      toast.success('Field added');
      setAdding(false);
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add the field'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/spec-templates/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Field retired');
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not retire the field'),
  });

  if (!user) return <Skeleton className="h-96" />;
  if (!allowed) {
    return (
      <Card className="mx-auto mt-10 max-w-md p-6 text-sm text-[var(--color-content-muted)]">
        Editing specification templates needs the catalogue review permission. Ask your administrator.
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <ListChecks aria-hidden="true" className="size-5 text-[var(--color-brand)]" /> Specification
          templates
        </h1>
        <p className="text-sm text-[var(--color-content-muted)]">
          What each category's offers are described by, and therefore what buyers can compare them on.
          Suppliers see these fields when they add an offer.
        </p>
      </header>

      <Card className="p-4">
        <Field label="Category" htmlFor="st-category">
          <NativeSelect
            id="st-category"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setAdding(false);
            }}
          >
            <option value="">Choose a category</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </Card>

      {categoryId ? (
        <>
          <div className="flex justify-end">
            {!adding ? (
              <Button onClick={() => setAdding(true)}>
                <Plus aria-hidden="true" className="mr-1 size-4" /> Add field
              </Button>
            ) : null}
          </div>

          {adding ? (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold">New field</h2>
              <FieldForm
                busy={create.isPending}
                onSubmit={(draft) => create.mutate(draft)}
                onCancel={() => setAdding(false)}
              />
            </Card>
          ) : null}

          {fields.isPending ? <Skeleton className="h-40" /> : null}

          {fields.isSuccess && fields.data.length === 0 ? (
            <Card>
              <EmptyState
                title="No fields yet"
                description="Add the things that matter when choosing in this category — RAM, weight, warranty. Until then there is nothing to compare offers on."
              />
            </Card>
          ) : null}

          {fields.isSuccess && fields.data.length > 0 ? (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left">
                    <th scope="col" className="p-3 font-medium">Field</th>
                    <th scope="col" className="p-3 font-medium">Kind</th>
                    <th scope="col" className="p-3 font-medium">Rule</th>
                    <th scope="col" className="p-3 font-medium">Required</th>
                    <th scope="col" className="p-3 font-medium">Compared</th>
                    <th scope="col" className="p-3 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {fields.data.map((field) => (
                    <tr key={field.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="p-3">
                        <span className="font-medium">{field.label}</span>
                        <span className="block text-xs text-[var(--color-content-subtle)]">
                          {field.key}
                        </span>
                      </td>
                      <td className="p-3">
                        {field.dataType === 'BOOLEAN'
                          ? 'Yes / no'
                          : field.dataType === 'ENUM'
                            ? 'List'
                            : field.dataType === 'NUMBER'
                              ? `Number${field.unit ? ` (${field.unit})` : ''}`
                              : 'Text'}
                      </td>
                      <td className="p-3 text-xs text-[var(--color-content-muted)]">
                        {field.intent === 'AT_LEAST'
                          ? 'At least'
                          : field.intent === 'AT_MOST'
                            ? 'At most'
                            : field.intent === 'EXACTLY'
                              ? 'Exactly'
                              : field.options.length > 0
                                ? field.options.join(', ')
                                : '—'}
                        {field.tolerance ? ` · ±${Math.round(Number(field.tolerance) * 100)}%` : ''}
                      </td>
                      <td className="p-3">{field.isRequired ? 'Yes' : 'No'}</td>
                      <td className="p-3">{field.isComparable ? 'Yes' : 'No'}</td>
                      <td className="p-3 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={`Retire ${field.label}`}
                          onClick={() => {
                            if (
                              confirm(
                                `Retire “${field.label}”? Values suppliers already entered are kept, so past comparisons still read.`,
                              )
                            ) {
                              remove.mutate(field.id);
                            }
                          }}
                        >
                          <Trash2 aria-hidden="true" className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
