'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { PERMISSIONS, receiptsWaiting, type ReceiptCandidate } from '@techpioasset/domain';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card } from '@/components/ui';

const SHOWN = 3;

/**
 * "Confirm what you received" on the dashboard (Phase 4, v2.80) - the web's
 * match for the phone's Home card, from the same rule (receiptsWaiting), so
 * the two never disagree. Renders nothing when nothing is waiting, which for
 * most people on most days is the whole of it.
 */
export function ReceiptPrompt() {
  const { user, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const enabled = Boolean(user) && can(PERMISSIONS.ASSETS_READ) && !user?.roles?.includes('VENDOR');

  const mine = useQuery({
    queryKey: ['receipt-prompt', user?.id],
    enabled,
    queryFn: () =>
      apiFetchPage<ReceiptCandidate>(`/assets?assignedUserId=${user!.id}&pageSize=100`),
  });

  const confirm = useMutation({
    mutationFn: (assignmentId: string) =>
      apiFetch(`/assets/assignments/${assignmentId}/acknowledge`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast.success('Receipt confirmed');
      void queryClient.invalidateQueries({ queryKey: ['receipt-prompt'] });
      void queryClient.invalidateQueries({ queryKey: ['my-assets'] });
    },
    onError: () => toast.error('Could not confirm. Please try again.'),
  });

  if (!enabled || !user || !mine.data) return null;
  const waiting = receiptsWaiting(mine.data.data, user.id);
  if (waiting.length === 0) return null;

  return (
    <Card className="border-[var(--tone-warning-fg)] p-5">
      <div className="mb-3 flex items-start gap-3">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 text-[var(--tone-warning-fg)]" />
        <div>
          <h2 className="text-sm font-semibold">Confirm what you received</h2>
          <p className="text-xs text-[var(--color-content-muted)]">
            {waiting.length === 1 ? 'One item was' : `${waiting.length} items were`} handed to you.
            Only confirm what is with you now.
          </p>
        </div>
      </div>
      <ul className="grid gap-2">
        {waiting.slice(0, SHOWN).map((row) => (
          <li key={row.assignmentId} className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/assets/${row.assetId}`} className="min-w-0 hover:underline">
              <span className="block truncate text-sm font-medium">{row.name}</span>
              <span className="block text-xs text-[var(--color-content-subtle)]">
                {row.assetTag}
              </span>
            </Link>
            <Button
              size="sm"
              onClick={() => confirm.mutate(row.assignmentId)}
              disabled={confirm.isPending}
              aria-label={`Confirm you received ${row.name}, ${row.assetTag}`}
            >
              Confirm
            </Button>
          </li>
        ))}
      </ul>
      {waiting.length > SHOWN ? (
        <Link
          href="/my-assets"
          className="mt-3 inline-block text-xs font-semibold text-[var(--color-brand)] hover:underline"
        >
          and {waiting.length - SHOWN} more in My assets
        </Link>
      ) : null}
    </Card>
  );
}
