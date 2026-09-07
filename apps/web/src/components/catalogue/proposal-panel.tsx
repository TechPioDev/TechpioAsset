'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lightbulb } from 'lucide-react';
import { PROPOSAL_SIGNAL_THRESHOLD } from '@techpioasset/domain';
import { apiFetch } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, controlCls, Field, NativeSelect, Skeleton } from '@/components/ui';

/**
 * What suppliers are offering that you never asked for (v2.44).
 *
 * A template can only ask what somebody already thought to ask, so this is the
 * other direction: the market telling you what it now considers worth stating.
 * One supplier volunteering a field is that supplier's marketing; several
 * independently doing it is a signal, which is why the count here is of
 * suppliers rather than offers and why the list leads with the most agreed.
 */

type Proposal = {
  key: string;
  label: string;
  vendorCount: number;
  vendors: string[];
  examples: string[];
  worthAsking: boolean;
};

type Draft = {
  label: string;
  dataType: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'ENUM';
  unit: string;
  intent: string;
  options: string;
};

export function ProposalPanel({
  categoryId,
  subcategoryId,
}: {
  categoryId: string;
  subcategoryId: string;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({
    label: '',
    dataType: 'TEXT',
    unit: '',
    intent: 'AT_LEAST',
    options: '',
  });

  const proposals = useQuery({
    queryKey: ['spec-proposals', categoryId, subcategoryId],
    queryFn: () =>
      apiFetch<Proposal[]>(
        `/spec-templates/proposals?categoryId=${categoryId}` +
          (subcategoryId ? `&subcategoryId=${subcategoryId}` : ''),
      ),
    enabled: Boolean(categoryId),
  });

  const start = (proposal: Proposal) => {
    setOpenKey(proposal.key);
    // The supplier's own wording is the starting point, not the decision — an
    // administrator names it for everybody.
    setDraft({ label: proposal.label, dataType: 'TEXT', unit: '', intent: 'AT_LEAST', options: '' });
  };

  const promote = useMutation({
    mutationFn: (key: string) =>
      apiFetch<{ offersBackfilled: number }>('/spec-templates/promote', {
        method: 'POST',
        body: {
          normalizedKey: key,
          categoryId,
          ...(subcategoryId ? { subcategoryId } : {}),
          label: draft.label.trim(),
          dataType: draft.dataType,
          ...(draft.dataType === 'NUMBER'
            ? { intent: draft.intent, ...(draft.unit.trim() ? { unit: draft.unit.trim() } : {}) }
            : {}),
          ...(draft.dataType === 'ENUM'
            ? { options: draft.options.split('\n').map((o) => o.trim()).filter(Boolean) }
            : {}),
        },
      }),
    onSuccess: async (result) => {
      toast.success(
        result.offersBackfilled > 0
          ? `Added to the template. ${result.offersBackfilled} existing offer(s) already answer it.`
          : 'Added to the template.',
      );
      setOpenKey(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['spec-proposals'] }),
        qc.invalidateQueries({ queryKey: ['spec-templates'] }),
      ]);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add it to the template'),
  });

  if (proposals.isPending) return <Skeleton className="h-28" />;
  if (proposals.isError || !proposals.data?.length) return null;

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Lightbulb aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
        Suggested by suppliers
      </h2>
      <p className="mb-4 mt-0.5 text-xs text-[var(--color-content-muted)]">
        Things suppliers stated that this template does not ask for. When{' '}
        {PROPOSAL_SIGNAL_THRESHOLD} or more suppliers volunteer the same thing, it is usually worth
        asking everybody.
      </p>

      <ul className="grid gap-3">
        {proposals.data.map((proposal) => (
          <li key={proposal.key} className="border-t border-[var(--color-border)] pt-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">
                  {proposal.label}
                  {proposal.worthAsking ? (
                    <span
                      className="ml-2 rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{
                        color: 'var(--tone-warning-fg)',
                        backgroundColor: 'var(--tone-warning-bg)',
                      }}
                    >
                      {proposal.vendorCount} suppliers
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-[var(--color-content-muted)]">
                  {proposal.vendors.join(', ')}
                  {proposal.examples.length ? ` · e.g. ${proposal.examples.join(', ')}` : ''}
                </p>
              </div>
              {openKey === proposal.key ? null : (
                <Button variant="secondary" size="sm" onClick={() => start(proposal)}>
                  Add to template
                </Button>
              )}
            </div>

            {openKey === proposal.key ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Name it for everybody" htmlFor={`pp-label-${proposal.key}`}>
                  <input
                    id={`pp-label-${proposal.key}`}
                    value={draft.label}
                    onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                    className={controlCls}
                  />
                </Field>
                <Field
                  label="Kind"
                  htmlFor={`pp-type-${proposal.key}`}
                  hint="A number can be compared as more-is-better or less-is-better; text can only match."
                >
                  <NativeSelect
                    id={`pp-type-${proposal.key}`}
                    value={draft.dataType}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, dataType: e.target.value as Draft['dataType'] }))
                    }
                  >
                    <option value="TEXT">Text</option>
                    <option value="NUMBER">Number</option>
                    <option value="BOOLEAN">Yes / no</option>
                    <option value="ENUM">Choose from a list</option>
                  </NativeSelect>
                </Field>
                {draft.dataType === 'NUMBER' ? (
                  <>
                    <Field label="Unit" htmlFor={`pp-unit-${proposal.key}`}>
                      <input
                        id={`pp-unit-${proposal.key}`}
                        value={draft.unit}
                        onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
                        className={controlCls}
                      />
                    </Field>
                    <Field label="Which way it points" htmlFor={`pp-intent-${proposal.key}`}>
                      <NativeSelect
                        id={`pp-intent-${proposal.key}`}
                        value={draft.intent}
                        onChange={(e) => setDraft((d) => ({ ...d, intent: e.target.value }))}
                      >
                        <option value="AT_LEAST">At least this much</option>
                        <option value="AT_MOST">At most this much</option>
                        <option value="EXACTLY">Exactly this</option>
                      </NativeSelect>
                    </Field>
                  </>
                ) : null}
                {draft.dataType === 'ENUM' ? (
                  <div className="sm:col-span-2">
                    <Field label="Choices" htmlFor={`pp-opts-${proposal.key}`} hint="One per line.">
                      <textarea
                        id={`pp-opts-${proposal.key}`}
                        rows={3}
                        value={draft.options}
                        onChange={(e) => setDraft((d) => ({ ...d, options: e.target.value }))}
                        className={controlCls}
                      />
                    </Field>
                  </div>
                ) : null}
                <div className="flex gap-2 sm:col-span-2">
                  <Button
                    loading={promote.isPending}
                    disabled={!draft.label.trim()}
                    onClick={() => promote.mutate(proposal.key)}
                  >
                    Add to template
                  </Button>
                  <Button variant="secondary" onClick={() => setOpenKey(null)}>
                    Cancel
                  </Button>
                </div>
                <p className="text-xs text-[var(--color-content-subtle)] sm:col-span-2">
                  Answers suppliers have already given move across, so it compares straight away.
                </p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
