'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Tags } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';

/**
 * Asset types (v3.4).
 *
 * The same story as departments before v2.21: the model existed, every asset
 * pointed at one, the list page filtered by them — and nothing in the product
 * could create one. Only IT Assets had any, because they arrived with a seed
 * the production tenant never ran; Furniture, Office Equipment and Consumables
 * were empty for the life of the tenant, so anything filed under them could
 * never be typed or filtered. That is how a record called "Keyboard and Mouse"
 * came to be untypeable.
 *
 * Retiring rather than deleting: assets, inventory items and vendor offers all
 * point at a type. Deleting one would orphan them and rewrite history to say
 * the equipment never had a type. Retiring takes it out of the choices and
 * leaves what already holds it alone — which is what "we stopped buying those"
 * actually means.
 */

interface AssetType {
  id: string;
  name: string;
  key: string;
  isActive: boolean;
  assetCount: number;
}

interface CategoryTypes {
  id: string;
  name: string;
  types: AssetType[];
}

export default function AssetTypesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canManage = can(PERMISSIONS.SETTINGS_MANAGE);

  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<AssetType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: ['asset-types-manage'],
    enabled: canManage,
    queryFn: () => apiFetch<CategoryTypes[]>('/asset-types/manage'),
  });

  const done = (message: string) => {
    void qc.invalidateQueries({ queryKey: ['asset-types-manage'] });
    // The pickers elsewhere read the same tree, so they must not keep showing
    // yesterday's list.
    void qc.invalidateQueries({ queryKey: ['categories'] });
    setAddingTo(null);
    setRenaming(null);
    setName('');
    setError(null);
    toast.success(message);
  };

  const failed = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

  const create = useMutation({
    mutationFn: (body: { categoryId: string; name: string }) =>
      apiFetch('/asset-types', { method: 'POST', body }),
    onSuccess: () => done('Type added'),
    onError: failed,
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; isActive?: boolean } }) =>
      apiFetch(`/asset-types/${id}`, { method: 'PATCH', body }),
    onSuccess: () => done('Type updated'),
    onError: failed,
  });

  if (!canManage) {
    return <ErrorState title="No access" detail="Managing asset types needs settings permission." />;
  }

  const rows = categories.data ?? [];

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <div>
        <h1 className="text-lg font-semibold">Asset types</h1>
        <p className="mt-0.5 text-sm text-[var(--color-content-muted)]">
          The Type filter on the asset list, and the Type field when you add one. A category with
          no types can never be filtered by type.
        </p>
      </div>

      {error ? <ErrorState title="Could not save" detail={error} /> : null}

      {categories.isPending ? (
        <Skeleton className="h-64 rounded-[var(--radius-card)]" />
      ) : categories.isError ? (
        <ErrorState
          title="Could not load asset types"
          detail={(categories.error as Error).message}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No categories" description="Add a category first." />
      ) : (
        rows.map((category) => (
          <Card key={category.id} className="p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-semibold">{category.name}</h2>
              <span className="text-xs text-[var(--color-content-muted)]">
                {category.types.filter((t) => t.isActive).length} in use
                {category.types.some((t) => !t.isActive)
                  ? `, ${category.types.filter((t) => !t.isActive).length} retired`
                  : ''}
              </span>
              <Button
                variant="ghost"
                className="ml-auto"
                onClick={() => {
                  setAddingTo(addingTo === category.id ? null : category.id);
                  setRenaming(null);
                  setName('');
                  setError(null);
                }}
              >
                <Plus aria-hidden="true" className="mr-1.5 size-4" />
                Add type
              </Button>
            </div>

            {addingTo === category.id ? (
              <form
                className="mt-4 flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) create.mutate({ categoryId: category.id, name: name.trim() });
                }}
              >
                <div className="min-w-56 flex-1">
                  <label htmlFor={`type-${category.id}`} className="text-sm font-medium">
                    Type name
                  </label>
                  <Input
                    id={`type-${category.id}`}
                    className="mt-1.5"
                    placeholder="Office chair"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                </div>
                <Button type="submit" disabled={!name.trim() || create.isPending}>
                  {create.isPending ? 'Adding…' : 'Add'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setAddingTo(null)}>
                  Cancel
                </Button>
              </form>
            ) : null}

            {category.types.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--color-content-muted)]">
                No types yet, so nothing filed under {category.name} can be filtered by type.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-[var(--color-border)]">
                {category.types.map((type) => (
                  <li key={type.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    {renaming?.id === type.id ? (
                      <form
                        className="flex flex-1 flex-wrap items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (name.trim()) update.mutate({ id: type.id, body: { name: name.trim() } });
                        }}
                      >
                        <Input
                          className="min-w-48 flex-1"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          aria-label={`New name for ${type.name}`}
                          autoFocus
                        />
                        <Button type="submit" disabled={!name.trim() || update.isPending}>
                          Save
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <>
                        <Tags
                          aria-hidden="true"
                          className="size-4 shrink-0 text-[var(--color-content-subtle)]"
                        />
                        <span className={type.isActive ? 'text-sm' : 'text-sm line-through opacity-60'}>
                          {type.name}
                        </span>
                        {!type.isActive ? (
                          <span className="rounded-full bg-[var(--color-surface-sunken)] px-2 py-0.5 text-[11px] font-medium">
                            Retired
                          </span>
                        ) : null}
                        {/*
                          The one fact worth having before retiring something:
                          "14 assets" is a different decision from "none".
                        */}
                        <span className="text-xs tabular-nums text-[var(--color-content-muted)]">
                          {type.assetCount === 0
                            ? 'no assets'
                            : `${type.assetCount.toLocaleString()} asset${type.assetCount === 1 ? '' : 's'}`}
                        </span>
                        <span className="ml-auto flex gap-1">
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setRenaming(type);
                              setName(type.name);
                              setAddingTo(null);
                              setError(null);
                            }}
                          >
                            Rename
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={update.isPending}
                            onClick={() =>
                              update.mutate({ id: type.id, body: { isActive: !type.isActive } })
                            }
                          >
                            {type.isActive ? 'Retire' : 'Bring back'}
                          </Button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
