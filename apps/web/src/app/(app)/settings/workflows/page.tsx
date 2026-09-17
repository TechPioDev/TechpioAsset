'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Lock,
  Pencil,
  Plus,
  PowerOff,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import type {
  CreateWorkflowStepInput,
  WorkflowDefinition,
  WorkflowStep,
} from '@techpioasset/contracts';
import { apiFetch, ApiError } from '@/lib/api-client';
import { canMove, movedOrder } from '@/lib/workflow-order';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { useAuth } from '@/providers/auth-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Field, NativeSelect, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { Breadcrumbs } from '@/components/breadcrumbs';

/**
 * Approval workflows (v2.24, v2.28).
 *
 * The chains have been configurable in the data model since the beginning and
 * editable nowhere - `workflows:configure` was granted and enforced by no
 * route, so a cost threshold could only be changed by editing the database.
 *
 * Each step shows how many people could actually decide it, because that is
 * the failure worth seeing: a step that applies to every request with nobody
 * eligible is worse than one that rarely applies.
 *
 * v2.24 tuned a chain (threshold, later who approves); v2.28 lets the owner
 * change what the process IS: add, rename, remove and reorder approval
 * steps. Two things stay fixed. A chain is copied onto a request when it is
 * submitted, so every structural change reaches only requests raised
 * afterwards - the toasts say so. And the two assessment stages are a locked
 * pair: they leave only via the switch above the chain, and the API places
 * them (before the first thresholded step) after every reorder.
 *
 * Each approval step also has an On/Off switch - the reversible cousin of
 * Remove. Off keeps the step's name, role and threshold; new requests skip it
 * and the row reads "Skipped". The last step still on cannot be switched off
 * or removed, because a chain with nothing on approves everything on
 * submission.
 */

const titleCase = (v: string) =>
  v.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const problem = (e: unknown, fallback: string) =>
  e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : fallback;

export default function WorkflowSettingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [addingTo, setAddingTo] = useState<WorkflowDefinition | null>(null);

  const workflows = useQuery({
    queryKey: ['workflows'],
    queryFn: () => apiFetch<WorkflowDefinition[]>('/workflows'),
    enabled: can(PERMISSIONS.WORKFLOWS_CONFIGURE),
  });

  const stages = useMutation({
    mutationFn: (input: { definitionId: string; enabled: boolean }) =>
      apiFetch(`/workflows/${input.definitionId}/assessment-stages`, {
        method: 'PATCH',
        body: { enabled: input.enabled },
      }),
    onSuccess: async (_r, input) => {
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      toast.success(
        input.enabled
          ? 'Inventory check and cost assessment added to this workflow'
          : 'Assessment stages removed — requests already in flight keep theirs',
      );
    },
    onError: (e) => toast.error(problem(e, 'Could not change the stages')),
  });

  // The tenant's own roles, so the picker offers what this company actually has.
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiFetch<{ key: string; name: string }[]>('/roles'),
    staleTime: 60_000,
  });

  const setRole = useMutation({
    mutationFn: (input: { stepId: string; approverRoleKey: string }) =>
      apiFetch(`/workflows/steps/${input.stepId}`, {
        method: 'PATCH',
        body: { approverRoleKey: input.approverRoleKey },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      toast.success('Step reassigned — requests already waiting on it moved too');
    },
    onError: (e) => toast.error(problem(e, 'Could not reassign the step')),
  });

  const save = useMutation({
    mutationFn: (input: { stepId: string; costThreshold: string | null }) =>
      apiFetch(`/workflows/steps/${input.stepId}`, {
        method: 'PATCH',
        body: { costThreshold: input.costThreshold },
      }),
    onSuccess: async (_r, input) => {
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setDraft((prev) => {
        const next = { ...prev };
        delete next[input.stepId];
        return next;
      });
      toast.success(
        input.costThreshold === null
          ? 'This step now applies to every request'
          : `This step now applies from ${input.costThreshold}`,
      );
    },
    onError: (e) => toast.error(problem(e, 'Could not save the change')),
  });

  const rename = useMutation({
    mutationFn: (input: { stepId: string; name: string }) =>
      apiFetch(`/workflows/steps/${input.stepId}`, {
        method: 'PATCH',
        body: { name: input.name },
      }),
    onSuccess: async (_r, input) => {
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      toast.success(`Renamed to “${input.name}” — requests already in flight keep the old name`);
    },
    onError: (e) => toast.error(problem(e, 'Could not rename the step')),
  });

  const toggle = useMutation({
    mutationFn: (input: { stepId: string; name: string; isEnabled: boolean }) =>
      apiFetch(`/workflows/steps/${input.stepId}`, {
        method: 'PATCH',
        body: { isEnabled: input.isEnabled },
      }),
    onSuccess: async (_r, input) => {
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      toast.success(
        input.isEnabled
          ? `“${input.name}” is on — requests raised from now on include it`
          : `“${input.name}” is off — new requests skip it; requests already waiting on it keep their chain`,
      );
    },
    onError: (e, input) => toast.error(problem(e, `Could not switch “${input.name}”`)),
  });

  const remove = useMutation({
    mutationFn: (input: { stepId: string; name: string }) =>
      apiFetch(`/workflows/steps/${input.stepId}`, { method: 'DELETE' }),
    onSuccess: async (_r, input) => {
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      toast.success(
        `Removed “${input.name}” — new requests skip it; requests already waiting on it keep their current chain`,
      );
    },
    onError: (e, input) => toast.error(problem(e, `Could not remove “${input.name}”`)),
  });

  const reorder = useMutation({
    mutationFn: (input: {
      definitionId: string;
      stepIds: string[];
      name: string;
      direction: 'up' | 'down';
    }) =>
      apiFetch(`/workflows/${input.definitionId}/steps/order`, {
        method: 'PUT',
        body: { stepIds: input.stepIds },
      }),
    onSuccess: async (_r, input) => {
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      toast.success(`Moved “${input.name}” ${input.direction} — new requests follow the new order`);
    },
    onError: (e, input) => toast.error(problem(e, `Could not move “${input.name}”`)),
  });

  const add = useMutation({
    mutationFn: (input: { definitionId: string; body: CreateWorkflowStepInput }) =>
      apiFetch(`/workflows/${input.definitionId}/steps`, { method: 'POST', body: input.body }),
    onSuccess: async (_r, input) => {
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setAddingTo(null);
      toast.success(`Added “${input.body.name}” — requests raised from now on include it`);
    },
    onError: (e, input) => toast.error(problem(e, `Could not add “${input.body.name}”`)),
  });

  const askToRemove = async (step: WorkflowStep) => {
    const ok = await confirm({
      title: `Remove “${step.name}”?`,
      body: 'New requests skip this step. Requests already waiting on it keep their current chain.',
      confirmLabel: 'Remove step',
      destructive: true,
    });
    if (ok) remove.mutate({ stepId: step.id, name: step.name });
  };

  if (!can(PERMISSIONS.WORKFLOWS_CONFIGURE)) {
    return <ErrorState title="Not available" detail="Configuring approval workflows needs the workflows:configure permission." />;
  }
  if (workflows.isPending) return <Skeleton className="h-96" />;
  if (workflows.isError) {
    return <ErrorState title="Could not load workflows" detail={(workflows.error as Error).message} />;
  }

  const busy =
    save.isPending ||
    setRole.isPending ||
    rename.isPending ||
    remove.isPending ||
    reorder.isPending ||
    toggle.isPending;

  return (
    <div className="grid gap-4">
      <header>
        <Breadcrumbs items={[{ label: 'Settings' }, { label: 'Approval workflows' }]} />
        <h1 className="text-xl font-semibold tracking-tight">Approval workflows</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Which steps a request goes through, in what order, and which requests each step reviews. A
          step with no threshold reviews every request; one with a threshold only sees requests
          estimated at or above it. Changes apply to requests raised from now on.
        </p>
      </header>

      {workflows.data.map((workflow) => (
        <Card key={workflow.id} className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2">
              <h2 className="text-sm font-semibold">{workflow.name}</h2>
              <span className="text-xs text-[var(--color-content-subtle)]">
                {workflow.requestType ? titleCase(workflow.requestType) : 'Every other request type'}
              </span>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setAddingTo(workflow)}>
              <Plus aria-hidden="true" className="size-3.5" />
              Add step
            </Button>
          </div>

          <AssessmentStagesToggle
            hasStages={workflow.steps.some((step) => step.kind !== 'APPROVAL')}
            busy={stages.isPending}
            onToggle={(enabled) => stages.mutate({ definitionId: workflow.id, enabled })}
          />

          <ol className="mt-4 grid gap-2">
            {workflow.steps.map((step) => (
              <StepRow
                key={step.id}
                step={step}
                draft={draft[step.id]}
                onDraft={(v) => setDraft((prev) => ({ ...prev, [step.id]: v }))}
                onSave={(costThreshold) => save.mutate({ stepId: step.id, costThreshold })}
                saving={save.isPending}
                roles={roles.data ?? []}
                onRole={(approverRoleKey) => setRole.mutate({ stepId: step.id, approverRoleKey })}
                settingRole={setRole.isPending}
                canMoveUp={canMove(workflow.steps, step.id, 'up')}
                canMoveDown={canMove(workflow.steps, step.id, 'down')}
                onMove={(direction) => {
                  const stepIds = movedOrder(workflow.steps, step.id, direction);
                  if (stepIds) {
                    reorder.mutate({
                      definitionId: workflow.id,
                      stepIds,
                      name: step.name,
                      direction,
                    });
                  }
                }}
                onRename={(name) => rename.mutate({ stepId: step.id, name })}
                onRemove={() => askToRemove(step)}
                onToggle={(isEnabled) => toggle.mutate({ stepId: step.id, name: step.name, isEnabled })}
                busy={busy}
              />
            ))}
          </ol>
        </Card>
      ))}

      {addingTo ? (
        <AddStepDialog
          workflow={addingTo}
          roles={roles.data ?? []}
          busy={add.isPending}
          onClose={() => setAddingTo(null)}
          onSubmit={(body) => add.mutate({ definitionId: addingTo.id, body })}
        />
      ) : null}
    </div>
  );
}

function StepRow({
  step,
  draft,
  onDraft,
  onSave,
  saving,
  roles,
  onRole,
  settingRole,
  canMoveUp,
  canMoveDown,
  onMove,
  onRename,
  onRemove,
  onToggle,
  busy,
}: {
  step: WorkflowStep;
  draft: string | undefined;
  onDraft: (value: string) => void;
  onSave: (costThreshold: string | null) => void;
  saving: boolean;
  roles: { key: string; name: string }[];
  onRole: (approverRoleKey: string) => void;
  settingRole: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: 'up' | 'down') => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onToggle: (isEnabled: boolean) => void;
  busy: boolean;
}) {
  const current = step.costThreshold ?? '';
  const value = draft ?? current;
  const dirty = value.trim() !== current;
  const unstaffed = step.eligibleApprovers === 0;
  const isStage = step.kind !== 'APPROVAL';
  const off = !step.isEnabled;
  const [renaming, setRenaming] = useState<string | null>(null);
  const renamed = renaming?.trim() ?? '';
  const renameValid = renamed.length >= 2 && renamed.length <= 60 && renamed !== step.name;

  return (
    <li
      className="grid gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center"
      // Greyed when off, so the chain reads as what new requests actually go
      // through. The switch itself stays at full strength - it is the way back.
      style={off ? { borderStyle: 'dashed', backgroundColor: 'var(--color-surface-sunken)' } : undefined}
    >
      {/* Order controls. The assessment stages are placed by rule, so they get
          a lock where the arrows would be rather than arrows that do nothing. */}
      <div className="flex gap-1 sm:flex-col">
        {isStage ? (
          <span
            className="grid size-7 place-items-center text-[var(--color-content-subtle)]"
            title="Placed automatically, immediately before the first step with a threshold"
          >
            <Lock aria-hidden="true" className="size-3.5" />
            <span className="sr-only">Position is fixed</span>
          </span>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="size-7 p-0"
              aria-label={`Move ${step.name} up`}
              disabled={!canMoveUp || busy}
              onClick={() => onMove('up')}
            >
              <ChevronUp aria-hidden="true" className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="size-7 p-0"
              aria-label={`Move ${step.name} down`}
              disabled={!canMoveDown || busy}
              onClick={() => onMove('down')}
            >
              <ChevronDown aria-hidden="true" className="size-4" />
            </Button>
          </>
        )}
      </div>

      <div className={off ? 'min-w-0 opacity-60' : 'min-w-0'}>
        {renaming !== null ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!renameValid) return;
              onRename(renamed);
              setRenaming(null);
            }}
          >
            <label className="sr-only" htmlFor={`rename-${step.id}`}>
              New name for {step.name}
            </label>
            <Input
              id={`rename-${step.id}`}
              autoFocus
              value={renaming}
              maxLength={60}
              onChange={(e) => setRenaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setRenaming(null);
              }}
              className="h-9 w-56"
            />
            <Button size="sm" type="submit" disabled={!renameValid || busy}>
              Save name
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
          </form>
        ) : (
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <span>
              {step.stepOrder}. {step.name}
            </span>
            {isStage ? null : (
              <Button
                size="sm"
                variant="ghost"
                className="size-7 p-0"
                aria-label={`Rename ${step.name}`}
                disabled={busy}
                onClick={() => setRenaming(step.name)}
              >
                <Pencil aria-hidden="true" className="size-3.5" />
              </Button>
            )}
          </p>
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-content-muted)]">
          {step.approverType === 'LINE_MANAGER' ? (
            <span>The requester’s manager, or the Manager role</span>
          ) : (
            // v2.26 - who staffs a step is now a choice. It was fixed when the
            // workflow was created, so an owner who decided the Inventory check
            // belonged with the Inventory Manager rather than the Office
            // Administrator had no screen that could say so - they assigned the
            // role and nothing happened.
            <label className="inline-flex items-center gap-1.5">
              <span className="sr-only">Who does {step.name}</span>
              <NativeSelect
                aria-label={`Who does ${step.name}`}
                className="h-7 text-xs"
                disabled={settingRole}
                value={step.approverRoleKey ?? ''}
                onChange={(e) => {
                  if (e.target.value && e.target.value !== step.approverRoleKey) {
                    onRole(e.target.value);
                  }
                }}
              >
                {step.approverRoleKey ? null : (
                  <option value="">{step.approverRoleName ?? titleCase(step.approverType)}</option>
                )}
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
          )}
          {off ? (
            <span className="inline-flex items-center gap-1 font-medium">
              <PowerOff aria-hidden="true" className="size-3.5" />
              Skipped
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1"
              style={unstaffed ? { color: 'var(--tone-critical-fg)' } : undefined}
            >
              {unstaffed ? (
                <AlertTriangle aria-hidden="true" className="size-3.5" />
              ) : (
                <Users aria-hidden="true" className="size-3.5" />
              )}
              {unstaffed
                ? 'nobody holds this — the step is skipped'
                : `${step.eligibleApprovers} can approve`}
            </span>
          )}
          <span>
            {step.costThreshold
              ? `only from ${step.costThreshold}`
              : 'reviews every request'}
          </span>
          {isStage ? (
            <span>part of the assessment pair — removed together with “Remove stages”</span>
          ) : null}
          {!isStage && !step.isEnabled ? (
            <span>skipped — new requests leave this step out; requests already waiting on it keep their chain</span>
          ) : null}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-self-start sm:justify-self-end">
        {isStage ? null : (
          <StepSwitch
            id={step.id}
            name={step.name}
            on={step.isEnabled}
            disabled={busy || (step.isEnabled && !step.canDisable)}
            reason={
              step.isEnabled && !step.canDisable
                ? 'This is the only step still on — a workflow needs one'
                : undefined
            }
            onChange={onToggle}
          />
        )}
        <label className="sr-only" htmlFor={`threshold-${step.id}`}>
          Cost threshold for {step.name}
        </label>
        <Input
          id={`threshold-${step.id}`}
          value={value}
          inputMode="decimal"
          placeholder="No threshold"
          onChange={(e) => onDraft(e.target.value)}
          className="h-9 w-36"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!dirty || saving}
          onClick={() => onSave(value.trim() === '' ? null : value.trim())}
        >
          Save
        </Button>
        {step.costThreshold ? (
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => onSave(null)}>
            Review everything
          </Button>
        ) : null}
        {isStage ? null : (
          <Button
            size="sm"
            variant="ghost"
            className="size-8 p-0"
            aria-label={`Remove ${step.name}`}
            title={
              step.canRemove ? `Remove ${step.name}` : 'A workflow needs at least one approval step'
            }
            disabled={!step.canRemove || busy}
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" className="size-4 text-[var(--tone-critical-fg)]" />
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * The On/Off switch on an approval step (v2.28). Off keeps the step's name,
 * role and threshold - it is the reversible cousin of Remove - and the helper
 * text says exactly how far it reaches.
 */
function StepSwitch({
  id,
  name,
  on,
  disabled,
  reason,
  onChange,
}: {
  id: string;
  name: string;
  on: boolean;
  disabled: boolean;
  reason?: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <span className="inline-flex items-center gap-2" title={reason}>
      {/* Sizes are inline, not utilities: the site's base button rule adds
          padding and the knob was absolutely positioned, so the pill grew and
          the knob landed outside it - a solid blue blob with no knob. */}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${name}: ${on ? 'on' : 'off'}`}
        aria-describedby={`switch-help-${id}`}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className="shrink-0 rounded-full border-0 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: on ? 'flex-end' : 'flex-start',
          boxSizing: 'border-box',
          width: 44,
          height: 24,
          padding: 2,
          margin: 0,
          backgroundColor: on ? 'var(--color-brand)' : 'var(--color-border-strong)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'block',
            width: 20,
            height: 20,
            borderRadius: 9999,
            backgroundColor: '#fff',
            boxShadow: '0 1px 2px rgba(15, 23, 42, 0.35)',
          }}
        />
      </button>
      <span
        id={`switch-help-${id}`}
        className="text-xs font-medium whitespace-nowrap"
        style={{ color: on ? 'var(--color-content)' : 'var(--color-content-muted)' }}
      >
        {on ? 'On' : 'Off'}
      </span>
    </span>
  );
}

/**
 * Whether this workflow asks somebody to check stock and price the request
 * before Finance sees it.
 *
 * Offered as one switch rather than as two editable steps: the pair only makes
 * sense together, in that order, immediately before the thresholded step whose
 * answer they supply. Editing them as arbitrary steps would invite chains that
 * price a request nobody checked stock for.
 */
function AssessmentStagesToggle({
  hasStages,
  busy,
  onToggle,
}: {
  hasStages: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
      <ClipboardList aria-hidden="true" className="size-4 shrink-0 text-[var(--color-brand)]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Inventory check and cost assessment</p>
        <p className="text-xs text-[var(--color-content-muted)]">
          {hasStages
            ? 'The request waits for somebody to check stock and price it before finance approval.'
            : 'Not in this workflow — the cost can be recorded at any point instead.'}
        </p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        onClick={() => onToggle(!hasStages)}
      >
        {hasStages ? 'Remove stages' : 'Add stages'}
      </Button>
    </div>
  );
}

/** Marks the "requester's manager" choice in the approver select. */
const MANAGER_CHOICE = '__LINE_MANAGER__';

/**
 * Add an approval step to one workflow. Position is offered as "First" or
 * "After: <step>" over the approval steps only - the assessment pair is not
 * a place to put things, it finds its own.
 */
function AddStepDialog({
  workflow,
  roles,
  busy,
  onClose,
  onSubmit,
}: {
  workflow: WorkflowDefinition;
  roles: { key: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: CreateWorkflowStepInput) => void;
}) {
  const approvals = workflow.steps.filter((step) => step.kind === 'APPROVAL');
  const [name, setName] = useState('');
  const [approver, setApprover] = useState(MANAGER_CHOICE);
  const [threshold, setThreshold] = useState('');
  // 'first' or the id of the approval step to go after; defaults to last.
  const [after, setAfter] = useState(approvals.at(-1)?.id ?? 'first');
  const [touched, setTouched] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trimmed = name.trim();
  const nameError =
    touched && (trimmed.length < 2 || trimmed.length > 60)
      ? 'Give the step a name of 2 to 60 characters'
      : undefined;
  const thresholdError =
    threshold.trim() !== '' && !/^\d{1,12}(\.\d{1,2})?$/.test(threshold.trim())
      ? 'Enter an amount with at most two decimal places, or leave it empty'
      : undefined;

  const submit = () => {
    setTouched(true);
    if (trimmed.length < 2 || trimmed.length > 60 || thresholdError) return;
    const position = after === 'first' ? 1 : approvals.findIndex((s) => s.id === after) + 2;
    onSubmit({
      name: trimmed,
      approverType: approver === MANAGER_CHOICE ? 'LINE_MANAGER' : 'ROLE',
      ...(approver === MANAGER_CHOICE ? {} : { approverRoleKey: approver }),
      ...(threshold.trim() === '' ? {} : { costThreshold: threshold.trim() }),
      position,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-step-title"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="add-step-title" className="text-[15px] font-semibold">
            Add a step to {workflow.name}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg hover:bg-[var(--color-surface-sunken)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <form
          className="mt-4 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Step name" htmlFor="add-step-name" error={nameError}>
            <Input
              id="add-step-name"
              autoFocus
              value={name}
              maxLength={60}
              placeholder="e.g. Director sign-off"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
            />
          </Field>

          <Field
            label="Who approves"
            htmlFor="add-step-approver"
            hint="The requester's manager falls back to the Manager role when none is recorded."
          >
            <NativeSelect
              id="add-step-approver"
              className="w-full"
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
            >
              <option value={MANAGER_CHOICE}>Requester’s manager</option>
              {roles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field
            label="Cost threshold (optional)"
            htmlFor="add-step-threshold"
            error={thresholdError}
            hint="Leave empty to review every request."
          >
            <Input
              id="add-step-threshold"
              inputMode="decimal"
              placeholder="No threshold"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </Field>

          <Field label="Position" htmlFor="add-step-position">
            <NativeSelect
              id="add-step-position"
              className="w-full"
              value={after}
              onChange={(e) => setAfter(e.target.value)}
            >
              <option value="first">First</option>
              {approvals.map((step) => (
                <option key={step.id} value={step.id}>
                  After: {step.name}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <p className="text-xs text-[var(--color-content-muted)]">
            Requests raised from now on include the new step; requests already in flight keep their
            current chain.
          </p>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={busy}>
              Add step
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
