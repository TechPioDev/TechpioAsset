import { PERMISSIONS, custodyOptions } from '@techpioasset/domain';

/**
 * The person page's Offboard flow: who sees the button, which task is theirs,
 * what each row may offer. The arithmetic (N of M, blocking, finish state) is
 * shared with the phone in @techpioasset/domain offboarding.ts; this file is
 * the web's gating on top of it.
 */

/** A row from GET /lifecycle/tasks - only what the badge and button need. */
export interface OpenTaskRow {
  id: string;
  subjectUserId: string;
  direction: string;
  status: string;
}

/**
 * Offboard is offered to whoever may complete one, never on yourself (the
 * server refuses to deactivate the actor) and never on an account that is
 * already closed - there is nothing left to finish.
 */
export function canOffboard(input: {
  can: (permission: string) => boolean;
  meId: string | null | undefined;
  person: { id: string; status: string };
}): boolean {
  return (
    input.can(PERMISSIONS.OFFBOARDING_MANAGE) &&
    input.person.id !== input.meId &&
    input.person.status !== 'DEACTIVATED'
  );
}

/** The OPEN offboarding task for a person, if one exists. */
export function openOffboardingFor(
  tasks: readonly OpenTaskRow[] | null | undefined,
  userId: string,
): OpenTaskRow | null {
  return (
    (tasks ?? []).find(
      (t) => t.subjectUserId === userId && t.direction === 'OFFBOARDING' && t.status === 'OPEN',
    ) ?? null
  );
}

/**
 * What a row in "Return equipment" may offer. Same rule as the asset page's
 * custody card, so a button that works there works here. The asset is held by
 * definition - it would not be on the list otherwise.
 */
export function offboardingRowActions(input: {
  canAssign: boolean;
  canReturn: boolean;
  status: string;
}): { handOver: boolean; recordReturn: boolean } {
  const offer = custodyOptions({ ...input, isHeld: true });
  return { handOver: offer.handOver, recordReturn: offer.recordReturn };
}

/** The button's label depends on whether a task is already under way. */
export function offboardButtonLabel(hasOpenTask: boolean): string {
  return hasOpenTask ? 'Continue offboarding' : 'Offboard…';
}
