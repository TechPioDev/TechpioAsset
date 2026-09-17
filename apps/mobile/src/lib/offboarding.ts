import { PERMISSIONS, custodyOptions } from '@techpioasset/domain';

/**
 * The Offboard flow's gating on the phone. The arithmetic - N of M returned,
 * what still blocks, which Finish card - lives in @techpioasset/domain
 * offboarding.ts and is shared with the web; this file decides who sees what,
 * kept in step with apps/web/src/lib/offboarding.ts.
 */

/** A row from GET /lifecycle/tasks - only what the badge needs. */
export interface OpenTaskRow {
  id: string;
  subjectUserId: string;
  direction: string;
  status: string;
}

export interface OffboardGates {
  /** The Offboard action on the person page, and the screen itself. */
  canOffboard: boolean;
  /** Per-row "Record return". */
  canReturn: boolean;
  /** Per-row "Hand over" - the reassign endpoint needs both custody rights. */
  canHandOver: boolean;
  /** Reading who is mid-offboarding (the badge). */
  canSeeProgress: boolean;
}

/**
 * Offboard is offered to whoever may complete one, never on yourself (the
 * server refuses to deactivate the actor) and never on a closed account.
 */
export function offboardGates(
  me: { id: string; permissions: readonly string[] } | null,
  person: { id: string; status: string } | null,
): OffboardGates {
  const has = (p: string) => Boolean(me?.permissions.includes(p));
  const custody = custodyOptions({
    canAssign: has(PERMISSIONS.ASSETS_ASSIGN),
    canReturn: has(PERMISSIONS.ASSETS_RETURN),
    status: 'ASSIGNED',
    isHeld: true,
  });
  return {
    canOffboard:
      has(PERMISSIONS.OFFBOARDING_MANAGE) &&
      Boolean(person) &&
      person!.id !== me?.id &&
      person!.status !== 'DEACTIVATED',
    canReturn: custody.recordReturn,
    canHandOver: custody.handOver,
    canSeeProgress: has(PERMISSIONS.EMPLOYEES_READ),
  };
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

/** The action's label depends on whether a task is already under way. */
export function offboardActionLabel(hasOpenTask: boolean): string {
  return hasOpenTask ? 'Continue offboarding' : 'Offboard';
}

/**
 * The success line after Finish. Names the exception so the person reading
 * the banner knows the equipment is still recorded against the leaver.
 */
export function offboardedMessage(name: string, withException: boolean): string {
  return withException
    ? `${name} offboarded with a documented exception. Their account is deactivated; the outstanding equipment stays recorded against them.`
    : `${name} offboarded. Their account is deactivated.`;
}
