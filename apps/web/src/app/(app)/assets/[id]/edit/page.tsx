'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ASSET_STATUSES_IN_EMPLOYEE_CUSTODY,
  manualStatusOptions,
  ASSET_CONDITIONS,
  ASSET_TYPES_BY_KEY,
  type AssetStatus,
} from '@techpioasset/domain';
import { ASSET_STATUS_TOKENS, CONDITION_TOKENS } from '@techpioasset/ui-tokens';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Category {
  id: string;
  name: string;
  subcategories: { id: string; key: string; name: string }[];
}
interface Office {
  id: string;
  name: string;
}
interface AssetDetail {
  id: string;
  assetTag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  macAddress: string | null;
  imei: string | null;
  specs: Record<string, string> | null;
  status: string;
  condition: string;
  purchaseDate: string | null;
  warrantyEndDate: string | null;
  version: number;
  category: { id: string; name: string } | null;
  subcategory: { id: string; key: string; name: string } | null;
  office: { id: string; name: string } | null;
}

const editSchema = z.object({
  name: z.string().min(1, 'Give the asset a name'),
  assetTag: z.string().min(1, 'Required'),
  categoryId: z.string().min(1, 'Choose a category'),
  subcategoryId: z.string().optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  macAddress: z.string().optional(),
  imei: z.string().optional(),
  officeId: z.string().optional(),
  purchaseDate: z.string().optional(),
  warrantyEndDate: z.string().optional(),
  condition: z.string().min(1),
  status: z.string().min(1),
});
type EditValues = z.infer<typeof editSchema>;

const toDateInput = (value: string | null): string => (value ? value.slice(0, 10) : '');

/** The asset's editable fields, in the shape the form holds them. */
function formValues(asset: AssetDetail): EditValues {
  return {
    name: asset.name,
    assetTag: asset.assetTag,
    categoryId: asset.category?.id ?? '',
    subcategoryId: asset.subcategory?.id ?? '',
    brand: asset.brand ?? '',
    model: asset.model ?? '',
    serialNumber: asset.serialNumber ?? '',
    macAddress: asset.macAddress ?? '',
    imei: asset.imei ?? '',
    officeId: asset.office?.id ?? '',
    purchaseDate: toDateInput(asset.purchaseDate),
    warrantyEndDate: toDateInput(asset.warrantyEndDate),
    condition: asset.condition,
    status: asset.status,
  };
}

/**
 * The actual form. It only mounts once the asset, categories and offices are all
 * loaded, and initialises with defaultValues — so every Select's options and its
 * selected value appear together (resetting a Select before its options exist
 * leaves it showing the placeholder).
 */
function EditAssetForm({
  id,
  asset,
  categories,
  offices,
}: {
  id: string;
  asset: AssetDetail;
  categories: Category[];
  offices: Office[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: formValues(asset),
  });

  // When a fresh copy of the asset arrives underneath the form (the refetch on
  // mount, or the refetch a failed save triggers), bring its values in without
  // discarding what the user has typed: fields they edited keep their edits,
  // everything else updates to the server's latest. The version for the lock is
  // read from the prop at save time, so it is always the fresh one.
  // Keyed to the version alone on purpose: the reset should fire when a fresh
  // copy arrives, not on every render that recreates the form object.
  useEffect(() => {
    form.reset(formValues(asset), { keepDirtyValues: true });
  }, [asset.version]);

  const selectedCategory = categories.find((c) => c.id === form.watch('categoryId'));
  // v2.20 - same type-driven fields as the create form, pre-filled from the
  // record. Changing type keeps nothing from the old one, since the fields mean
  // different things.
  const selectedSubcategoryId = form.watch('subcategoryId');
  const selectedType = selectedCategory?.subcategories.find(
    (sub) => sub.id === selectedSubcategoryId,
  );
  const typeDef = selectedType ? ASSET_TYPES_BY_KEY[selectedType.key] : undefined;
  const [specs, setSpecs] = useState<Record<string, string>>(asset.specs ?? {});
  const originalTypeId = asset.subcategory?.id ?? '';
  useEffect(() => {
    setSpecs(selectedSubcategoryId === originalTypeId ? (asset.specs ?? {}) : {});
  }, [selectedSubcategoryId, originalTypeId, asset.specs]);

  const save = useMutation({
    mutationFn: async (values: EditValues) => {
      return apiFetch<{ id: string }>(`/assets/${id}`, {
        method: 'PATCH',
        body: {
          name: values.name,
          assetTag: values.assetTag,
          categoryId: values.categoryId,
          subcategoryId: values.subcategoryId || null,
          brand: values.brand || null,
          model: values.model || null,
          serialNumber: values.serialNumber || null,
          macAddress: values.macAddress || null,
          imei: values.imei || null,
          // Always sent, so clearing a field actually clears it.
          specs: Object.fromEntries(Object.entries(specs).filter(([, v]) => v.trim())),
          officeId: values.officeId || null,
          purchaseDate: values.purchaseDate || null,
          warrantyEndDate: values.warrantyEndDate || null,
          condition: values.condition,
          status: values.status,
          version: asset.version,
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['asset', id] });
      toast.success('Asset updated');
      router.push(`/assets/${id}`);
    },
    onError: (caught) => {
      if (caught instanceof ApiError) {
        for (const [path, message] of Object.entries(caught.fieldErrors)) {
          form.setError(path as keyof EditValues, { message });
        }
        if (caught.problem.status === 409) {
          // Pull the latest copy; the version-keyed reset keeps the user's
          // edits and re-arms the lock, so "save again" genuinely works.
          void queryClient.invalidateQueries({ queryKey: ['asset', id] });
        }
        form.setError('root', {
          message:
            caught.problem.status === 409
              ? 'This asset changed since the form loaded. Its latest values have been brought in - your edits are kept. Review and save again.'
              : (caught.problem.detail ?? caught.problem.title),
        });
      } else {
        form.setError('root', { message: 'Could not save the asset.' });
      }
    },
  });

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header>
        <Breadcrumbs
          items={[
            { label: 'Assets', href: '/assets' },
            { label: asset.assetTag, href: `/assets/${id}` },
            { label: 'Edit' },
          ]}
        />
        <h1 className="text-xl font-semibold tracking-tight">Edit asset</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          {asset.assetTag} · {asset.name}. The price is managed separately and is not editable here.
        </p>
      </header>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4" noValidate>
          <Card className="grid gap-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Asset name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="assetTag"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Asset tag</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="subcategoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select
                      value={field.value ?? ''}
                      onValueChange={field.onChange}
                      disabled={!selectedCategory?.subcategories.length}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="e.g. Laptop" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(selectedCategory?.subcategories ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="serialNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Serial number</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* v2.20 - identity fields for this type. Unique per company, so a
                value already on another asset is refused with its tag named. */}
            {typeDef &&
            (typeDef.identity.includes('macAddress') || typeDef.identity.includes('imei')) ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {typeDef.identity.includes('imei') ? (
                  <FormField
                    control={form.control}
                    name="imei"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>IMEI</FormLabel>
                        <FormControl>
                          <Input inputMode="numeric" placeholder="359874102345678" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
                {typeDef.identity.includes('macAddress') ? (
                  <FormField
                    control={form.control}
                    name="macAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>MAC address</FormLabel>
                        <FormControl>
                          <Input placeholder="A4:BB:6D:1E:22:9F" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
              </div>
            ) : null}

            {typeDef && typeDef.fields.length > 0 ? (
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-4">
                <p className="text-sm font-semibold">{typeDef.name} details</p>
                <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">
                  Clearing a box removes that detail from the asset.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  {typeDef.fields.map((f) => (
                    <div key={f.key}>
                      <label htmlFor={`spec-${f.key}`} className="text-sm font-medium">
                        {f.label}
                        {f.unit ? (
                          <span className="ml-1 font-normal text-[var(--color-content-muted)]">
                            ({f.unit})
                          </span>
                        ) : null}
                      </label>
                      {f.kind === 'select' ? (
                        <select
                          id={`spec-${f.key}`}
                          value={specs[f.key] ?? ''}
                          onChange={(e) =>
                            setSpecs((prev) => ({ ...prev, [f.key]: e.target.value }))
                          }
                          className="mt-1.5 h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 text-sm"
                        >
                          <option value="">—</option>
                          {(f.options ?? []).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          id={`spec-${f.key}`}
                          className="mt-1.5"
                          inputMode={f.kind === 'number' ? 'decimal' : undefined}
                          placeholder={f.placeholder}
                          value={specs[f.key] ?? ''}
                          onChange={(e) =>
                            setSpecs((prev) => ({ ...prev, [f.key]: e.target.value }))
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="officeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Office</FormLabel>
                    <Select value={field.value ?? ''} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Where it lives" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {offices.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="purchaseDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchased on</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="warrantyEndDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Warranty ends</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="condition"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Condition</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ASSET_CONDITIONS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {CONDITION_TOKENS[c].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {/* v3.13 - only the moves this asset can make. The
                            menu listed every status, so "In use" to
                            "Available" looked selectable and was refused on
                            save. Custody statuses still come only from Assign,
                            Returned only from Return, and the current status
                            stays first so an untouched form saves unchanged. */}
                        {manualStatusOptions(asset.status as AssetStatus).map((s) => (
                          <SelectItem key={s} value={s}>
                            {ASSET_STATUS_TOKENS[s].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* Why the menu is short, when it is: the next step. */}
                    {ASSET_STATUSES_IN_EMPLOYEE_CUSTODY.includes(asset.status as AssetStatus) ? (
                      <p className="text-xs text-[var(--color-content-muted)]">
                        This asset is with a person. To make it available, use Return on the asset
                        page - that also closes their record.
                      </p>
                    ) : asset.status === 'DISPOSED' || asset.status === 'DONATED' ? (
                      <p className="text-xs text-[var(--color-content-muted)]">
                        Disposed is final; the record is kept for history.
                      </p>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </Card>

          {form.formState.errors.root ? (
            <p
              role="alert"
              className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
              style={{
                color: 'var(--tone-critical-fg)',
                backgroundColor: 'var(--tone-critical-bg)',
                borderColor: 'var(--tone-critical-border)',
              }}
            >
              {form.formState.errors.root.message}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => router.push(`/assets/${id}`)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save changes
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

export default function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: () => apiFetch<AssetDetail>(`/assets/${id}`),
    // The form carries the asset's version for the optimistic lock, and the
    // ['asset', id] cache is shared with the detail page - initialising from a
    // 30-second-old copy made the very first save fail with "someone else
    // changed this asset" when the someone was the same person, one page ago.
    refetchOnMount: 'always',
  });
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
  });
  const officesQuery = useQuery({
    queryKey: ['offices'],
    queryFn: () => apiFetch<Office[]>('/offices'),
  });

  if (assetQuery.isError) {
    return (
      <ErrorState title="Could not load the asset" detail={(assetQuery.error as Error).message} />
    );
  }
  // Wait for all three: the form initialises from them and must not mount early.
  if (!assetQuery.data || !categoriesQuery.data || !officesQuery.data) {
    return (
      <div className="mx-auto grid max-w-2xl gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <EditAssetForm
      id={id}
      asset={assetQuery.data}
      categories={categoriesQuery.data}
      offices={officesQuery.data}
    />
  );
}
