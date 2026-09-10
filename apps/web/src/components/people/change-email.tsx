'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PencilLine } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, controlCls } from '@/components/ui';

/**
 * Change the address a person signs in with (v2.54).
 *
 * There was no way to do this at all - an email was set at invite and never
 * again - so correcting one meant editing the database by hand, which leaves no
 * audit trail and is available to nobody but a developer.
 *
 * Deliberately not a field on the profile form. Login resolves by email, so
 * this is the account's identity rather than a detail about the person: mistype
 * it and they are locked out, and it is the first move in taking an account
 * over. It gets its own control, its own confirmation, and its own audit entry.
 */
export function ChangeEmail({ userId, current }: { userId: string; current: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);

  const canManage = Boolean(user?.permissions?.includes(PERMISSIONS.USERS_MANAGE));

  const save = useMutation({
    mutationFn: (email: string) =>
      apiFetch<{ id: string; email: string }>(`/users/${userId}/email`, {
        method: 'PATCH',
        body: { email },
      }),
    onSuccess: async (result) => {
      toast.success(`They now sign in with ${result.email}`);
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['person', userId] });
      await queryClient.invalidateQueries({ queryKey: ['people'] });
    },
    // The server names the actual rule - address in use, not an address at all,
    // a platform operator whose access is granted by it - and that is more use
    // than anything generic said here.
    onError: (e) =>
      toast.error(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not change the email address',
      ),
  });

  if (!canManage) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(current);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand)] hover:underline"
      >
        <PencilLine aria-hidden="true" className="size-3.5" /> Change
      </button>
    );
  }

  const trimmed = value.trim().toLowerCase();
  const unchanged = trimmed === current.trim().toLowerCase();

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!unchanged) save.mutate(trimmed);
      }}
    >
      <label className="sr-only" htmlFor="change-email">
        New sign-in email
      </label>
      <input
        id="change-email"
        type="email"
        required
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={controlCls}
      />
      <p className="text-xs text-[var(--color-content-muted)]">
        They will sign in with this address from now on. Their password does not change, and both
        the old and the new address are told.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={save.isPending} disabled={unchanged}>
          Change it
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
