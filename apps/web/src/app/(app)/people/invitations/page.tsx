'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Copy, Send } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';

interface InvitationRow {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
  invitedAt: string;
  expiresAt: string | null;
  reminders: number;
  status: 'PENDING' | 'EXPIRED';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * v2.19 — the invitations board. Every account still in the Invited state,
 * with when it was invited, whether the current link is still alive, and how
 * many automatic reminders have already gone out. Resending issues a fresh
 * 7-day link (the old one dies) and copies it for direct hand-over.
 */
export default function InvitationsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['invitations'],
    queryFn: () => apiFetch<InvitationRow[]>('/users/invitations'),
  });

  const resend = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ email: string; inviteUrl: string }>(`/users/${id}/resend-invite`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: async (result, id) => {
      void queryClient.invalidateQueries({ queryKey: ['invitations'] });
      try {
        await navigator.clipboard.writeText(result.inviteUrl);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 3000);
        toast.success(`Invitation re-sent to ${result.email} — link copied`);
      } catch {
        toast.success(`Invitation re-sent to ${result.email}`);
      }
    },
    onError: (caught) => {
      toast.error(
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'Could not resend the invitation.',
      );
    },
  });

  if (!can(PERMISSIONS.USERS_MANAGE)) {
    return (
      <ErrorState
        title="No access"
        detail="Managing invitations needs user management permission."
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/people"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          People
        </Link>
        <h1 className="text-lg font-semibold">Pending invitations</h1>
      </div>

      <p className="max-w-2xl text-sm text-[var(--color-text-secondary)]">
        Accounts that have been invited but not yet activated. Reminders go out automatically on
        days 1, 3 and 6 (configurable under Settings → Notifications), each with a fresh link;
        after the last link expires the person is told to ask for a new invitation.
      </p>

      <Card className="min-w-0 overflow-hidden">
        {isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load invitations" detail={(error as Error).message} />
        ) : !data || data.length === 0 ? (
          <EmptyState
            title="No pending invitations"
            description="Everyone who was invited has activated their account."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Pending invitations, {data.length} in total</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Person
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Role
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Invited
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Link expires
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Reminders
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{row.name ?? row.email}</div>
                      {row.name ? (
                        <div className="text-xs text-[var(--color-text-secondary)]">{row.email}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">{row.roles.join(', ') || '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(row.invitedAt)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(row.expiresAt)}</td>
                    <td className="px-4 py-2.5">{row.reminders}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={
                          row.status === 'PENDING'
                            ? 'inline-flex rounded-full bg-[var(--color-info-subtle,#dbeafe)] px-2 py-0.5 text-xs font-medium text-[var(--color-info,#0040b0)]'
                            : 'inline-flex rounded-full bg-[var(--color-surface-sunken)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]'
                        }
                      >
                        {row.status === 'PENDING' ? 'Pending' : 'Expired'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={resend.isPending && resend.variables === row.id}
                        onClick={() => resend.mutate(row.id)}
                      >
                        {copiedId === row.id ? (
                          <Check aria-hidden="true" className="mr-1.5 size-4" />
                        ) : row.status === 'EXPIRED' ? (
                          <Send aria-hidden="true" className="mr-1.5 size-4" />
                        ) : (
                          <Copy aria-hidden="true" className="mr-1.5 size-4" />
                        )}
                        {copiedId === row.id ? 'Link copied' : 'Resend & copy link'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
