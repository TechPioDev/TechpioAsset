'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarDays, FileText, Flag, Laptop, Loader2, Plus, Send, Tag, Trash2 } from 'lucide-react';
import {
  ASSET_LINKED_REQUEST_TYPES,
  ISSUE_CATEGORIES,
  PERMISSIONS,
  RAM_UPGRADE_OPTIONS,
  REPLACEMENT_REASONS,
  STORAGE_UPGRADE_OPTIONS,
  UPGRADE_TYPES,
  findIssueCategory,
  stripImageTokens,
} from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { DRAFT_IMAGES_FAILED_MESSAGE, MAX_COMMENT_IMAGES, submittedMessage } from '@/lib/comment-images';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { defaultUpgradeSpec, refusalMessage } from '@/lib/upgrade-default';
import { Button, Card, controlCls as inputCls } from '@/components/ui';
import { AddImagesButton, postComment, usePendingImages } from '@/components/requests/conversation-images';
import { InlineImageEditor, type InlineImageEditorHandle } from '@/components/requests/inline-image-editor';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormDescription,
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

const TYPES = [
  { value: 'ADDITIONAL_EQUIPMENT', label: 'Additional equipment' },
  { value: 'REPLACEMENT', label: 'Replacement' },
  { value: 'UPGRADE', label: 'Upgrade' },
  { value: 'DAMAGE', label: 'Damaged item' },
  { value: 'LOSS', label: 'Lost item' },
  { value: 'REPAIR', label: 'Repair' },
  { value: 'OFFICE_REQUIREMENT', label: 'Office / furniture' },
  { value: 'KITCHEN_REQUIREMENT', label: 'Kitchen / pantry' },
  { value: 'ACCESSIBILITY_REQUIREMENT', label: 'Accessibility' },
  { value: 'PROJECT_REQUIREMENT', label: 'Project requirement' },
] as const;

/** Dot colours mirror the priority tones used across the app. */
const PRIORITIES = [
  { value: 'LOW', label: 'Low', dot: 'var(--color-content-subtle)' },
  { value: 'NORMAL', label: 'Normal', dot: 'var(--tone-success-fg)' },
  { value: 'HIGH', label: 'High', dot: 'var(--tone-warning-fg)' },
  { value: 'URGENT', label: 'Urgent', dot: 'var(--tone-critical-fg)' },
] as const;

const BASE_TIPS = [
  {
    Icon: FileText,
    title: 'Be clear & specific',
    body: 'Provide a detailed reason and item description.',
  },
  {
    Icon: CalendarDays,
    title: 'Set a realistic date',
    body: 'Choose a date for when you really need it.',
  },
  {
    Icon: Flag,
    title: 'Choose priority wisely',
    body: 'High-priority requests are reviewed on an urgent basis.',
  },
] as const;

const COST_TIP = {
  Icon: Tag,
  title: 'Estimate cost',
  body: 'An accurate cost helps with faster finance approval.',
} as const;

const NOTES_TIP = {
  Icon: Tag,
  title: 'Add helpful notes',
  body: 'A model, spec or link helps IT pick exactly the right equipment.',
} as const;

/**
 * v2.61 - the reason box takes pictures inline. What is STORED as the business
 * reason is the words alone (it is quoted in lists, emails and the PDF, which
 * cannot show a picture); the words with the pictures in place become the
 * conversation's first message, from the requester, so approvers see the
 * cracked corner exactly where the sentence mentions it. Tokens live only in
 * messages, which already carry pictures and their visibility rules.
 */
function reasonWords(withTokens: string): string {
  return stripImageTokens(withTokens).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const requestSchema = z
  .object({
    type: z.string().min(1, 'Choose a request type'),
    priority: z.string().min(1),
    // The box holds the words and the picture tokens; the words alone must
    // carry the reason - a picture is not an explanation.
    businessReason: z
      .string()
      .refine((v) => reasonWords(v).length >= 10, 'At least 10 characters — approvers read this first.'),
    requiredBy: z.string().optional(),
    // Dynamic-form fields; which are required depends on the type (below).
    targetAssetId: z.string().optional(),
    upgradeType: z.string().optional(),
    requestedSpec: z.string().optional(),
    replacementReason: z.string().optional(),
    otherText: z.string().optional(),
    items: z
      .array(
        z.object({
          description: z.string().min(1, 'Required'),
          quantity: z.coerce.number().int().min(1, 'Min 1'),
          estimatedCost: z.string().optional(),
          notes: z.string().optional(),
          categoryId: z.string().optional(),
          isUncatalogued: z.boolean().optional(),
          manufacturer: z.string().optional(),
          model: z.string().optional(),
          referenceUrl: z.string().optional(),
        }),
      )
      .max(50),
  })
  .superRefine((v, ctx) => {
    const linked = (ASSET_LINKED_REQUEST_TYPES as readonly string[]).includes(v.type);
    if (linked && !v.targetAssetId) {
      ctx.addIssue({ code: 'custom', path: ['targetAssetId'], message: 'Select which of your assets this is about' });
    }
    if (v.type === 'UPGRADE') {
      if (!v.upgradeType) {
        ctx.addIssue({ code: 'custom', path: ['upgradeType'], message: 'Choose the upgrade type' });
      }
      if ((v.upgradeType === 'RAM' || v.upgradeType === 'STORAGE') && !v.requestedSpec) {
        ctx.addIssue({ code: 'custom', path: ['requestedSpec'], message: 'Choose what you need' });
      }
      if ((v.upgradeType === 'OTHER' || v.requestedSpec === 'OTHER') && !v.otherText?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['otherText'], message: 'Please specify' });
      }
    }
    if (v.type === 'REPLACEMENT') {
      if (!v.replacementReason) {
        ctx.addIssue({ code: 'custom', path: ['replacementReason'], message: 'Choose a reason' });
      }
      if (v.replacementReason === 'OTHER' && !v.otherText?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['otherText'], message: 'Please specify the reason' });
      }
    }
  });

interface EligibleAsset {
  id: string;
  name: string;
  assetTag: string;
  serialNumber: string | null;
  brand: string | null;
  model: string | null;
  status: string;
  condition: string;
  purchaseDate: string | null;
  warrantyEndDate: string | null;
  category: { id: string; name: string } | null;
  office: { name: string } | null;
  hardwareProfile: {
    manufacturer: string | null;
    cpu: string | null;
    ramGb: string | number | null;
    storageTotalGb: string | number | null;
  } | null;
}

interface Catalog {
  groups: { label: string; items: string[] }[];
  categories: { id: string; name: string; key: string }[];
}

const gb = (v: string | number | null | undefined) => (v == null ? null : `${Number(v)} GB`);
const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
type RequestValues = z.infer<typeof requestSchema>;

/**
 * The request exists (as a draft) but its pictures did not go up. Carries the
 * id so the page can send the person to it rather than to a blank form.
 */
class DraftImagesError extends Error {
  constructor(readonly requestId: string) {
    super(DRAFT_IMAGES_FAILED_MESSAGE);
    this.name = 'DraftImagesError';
  }
}

export default function NewRequestPage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense fallback={null}>
      <NewRequestKeyedForm />
    </Suspense>
  );
}

/**
 * Keys the form by the chosen issue so picking one gives a FRESH form.
 *
 * react-hook-form reads defaultValues once, at mount. Navigating from the
 * issue picker to ?issue=... is a client-side transition that reuses the same
 * component instance, so without this the type and priority the catalogue
 * chose were computed and then ignored - a hardware-damage report was filed
 * as "Additional equipment".
 */
function NewRequestKeyedForm() {
  const params = useSearchParams();
  const issueKey = params.get('issue') ?? params.get('type') ?? 'blank';
  return <NewRequestForm key={issueKey} />;
}

function NewRequestForm() {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const { can } = useAuth();
  // Quick actions and per-asset buttons land here with the intent pre-filled:
  // /requests/new?type=DAMAGE&about=AST-0201 opens a damage report about that
  // device instead of a blank form.
  // Arriving from "Report an issue" carries a catalogue key, which decides the
  // request type and starting priority so the employee never has to know that
  // a cracked screen is a REPAIR and a dropped laptop is a DAMAGE.
  const issue = findIssueCategory(params.get('issue'));
  const reportingIssue = params.get('report') === 'issue' || Boolean(issue);
  const prefillType = issue
    ? issue.requestType
    : TYPES.some((t) => t.value === params.get('type'))
      ? (params.get('type') as string)
      : 'ADDITIONAL_EQUIPMENT';
  const prefillAbout = params.get('about')?.slice(0, 120) ?? '';
  // Money follows the standing rule: only finance roles enter estimated cost.
  // Everyone else describes the equipment; procurement prices it later. The
  // server refuses cost from anyone else regardless of what the form shows.
  const canEnterCost = can(PERMISSIONS.ASSETS_COST_READ);

  // The same answer the server enforces with, so the page and the API cannot
  // disagree about who may raise a request.
  const raise = useQuery({
    queryKey: ['can-create-request'],
    queryFn: () => apiFetch<{ allowed: boolean; reason?: string }>('/requests/can-create'),
    staleTime: 60_000,
  });

  const form = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
      type: prefillType,
      priority: issue?.priority ?? 'NORMAL',
      businessReason: '',
      requiredBy: '',
      // v2.21 - no empty row up front. An item list is optional, so the table
      // only exists once somebody asks for it. A prefilled item (raised from an
      // issue) still opens with its row, because there the item is the point.
      items: prefillAbout
        ? [
            { description: prefillAbout, quantity: 1, estimatedCost: '', notes: '', categoryId: '', isUncatalogued: false, manufacturer: '', model: '', referenceUrl: '' },
          ]
        : [],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });

  const type = form.watch('type');
  const assetLinked = (ASSET_LINKED_REQUEST_TYPES as readonly string[]).includes(type);
  const targetAssetId = form.watch('targetAssetId');
  const upgradeType = form.watch('upgradeType');
  const requestedSpec = form.watch('requestedSpec');

  // The caller's own assets - fetched only once an asset-linked type is
  // chosen. The API scopes this server-side; the form never filters.
  const eligible = useQuery({
    queryKey: ['eligible-assets'],
    queryFn: () => apiFetch<EligibleAsset[]>('/requests/eligible-assets'),
    enabled: assetLinked,
    staleTime: 60_000,
  });

  const catalog = useQuery({
    queryKey: ['equipment-catalog'],
    queryFn: () => apiFetch<Catalog>('/requests/catalog'),
    staleTime: 300_000,
  });

  const selectedAsset = eligible.data?.find((a) => a.id === targetAssetId) ?? null;

  // One open ticket per problem: check BEFORE submit so the form can point at
  // the existing request instead of bouncing with a 409.
  const firstItemDesc = form.watch('items.0.description') ?? '';
  const dupParams = assetLinked
    ? targetAssetId
      ? `type=${type}&targetAssetId=${targetAssetId}`
      : null
    : firstItemDesc.trim().length > 2
      ? `type=${type}&item=${encodeURIComponent(firstItemDesc.trim())}`
      : null;
  const dupCheck = useQuery({
    queryKey: ['open-duplicate', dupParams],
    queryFn: () =>
      apiFetch<{ duplicate: { id: string; requestNumber: string; status: string } | null }>(
        `/requests/open-duplicate?${dupParams}`,
      ),
    enabled: Boolean(dupParams),
    staleTime: 15_000,
  });
  const duplicate = dupParams ? (dupCheck.data?.duplicate ?? null) : null;

  // One eligible asset: select it for the user instead of asking.
  useEffect(() => {
    const only = eligible.data?.length === 1 ? eligible.data[0] : undefined;
    if (assetLinked && only && !form.getValues('targetAssetId')) {
      form.setValue('targetAssetId', only.id, { shouldValidate: true });
    }
  }, [assetLinked, eligible.data]);

  // Current spec for the chosen upgrade dimension, straight from the record.
  const currentSpec =
    upgradeType === 'RAM'
      ? gb(selectedAsset?.hardwareProfile?.ramGb)
      : upgradeType === 'STORAGE'
        ? gb(selectedAsset?.hardwareProfile?.storageTotalGb)
        : null;

  // Offer the next size up as soon as the machine's own is known. Left empty,
  // the box looked filled in (it named the current size) and the form refused
  // a submit three times for the same person.
  useEffect(() => {
    if (type !== 'UPGRADE' || requestedSpec) return;
    if (upgradeType !== 'RAM' && upgradeType !== 'STORAGE') return;
    const next = defaultUpgradeSpec(
      upgradeType === 'RAM' ? RAM_UPGRADE_OPTIONS : STORAGE_UPGRADE_OPTIONS,
      currentSpec,
    );
    if (next) form.setValue('requestedSpec', next, { shouldValidate: true });
  }, [type, upgradeType, currentSpec, requestedSpec]);

  // Keep the first item's description in step with the upgrade selections so
  // nobody retypes what the form already knows - until they edit it by hand.
  const itemTouched = useRef(false);
  // Which item row's "Asset not in list" dialog is open, if any.
  const [uncataloguedFor, setUncataloguedFor] = useState<number | null>(null);
  useEffect(() => {
    if (type !== 'UPGRADE' || itemTouched.current) return;
    // Only fill a row that exists. The table starts empty (v2.21), and writing
    // to row 0 regardless conjured an item with no quantity that the table did
    // not show - so every upgrade request failed on "Items" with nothing to fix.
    if (fields.length === 0) return;
    const label = UPGRADE_TYPES.find(([k]) => k === upgradeType)?.[1];
    if (!label) return;
    const spec = requestedSpec && requestedSpec !== 'OTHER' ? ` to ${requestedSpec}` : '';
    const about = selectedAsset ? ` — ${selectedAsset.name} (${selectedAsset.assetTag})` : '';
    form.setValue('items.0.description', `${label}${spec}${about}`);
  }, [type, upgradeType, requestedSpec, selectedAsset?.id, fields.length]);

  // v2.61 - pictures of the fault or the item, inline in the reason while
  // raising the request. Same list, editor and limits as the conversation.
  const pictures = usePendingImages(toast);
  const reasonEditorRef = useRef<InlineImageEditorHandle>(null);

  const submit = useMutation({
    mutationFn: async (values: RequestValues) => {
      const images = pictures.images.map((p) => p.file);
      const created = await apiFetch<{ id: string }>('/requests', {
        method: 'POST',
        body: {
          type: values.type,
          priority: values.priority,
          ...(issue ? { issueCategory: issue.key } : {}),
          businessReason: reasonWords(values.businessReason),
          ...(values.requiredBy ? { requiredBy: values.requiredBy } : {}),
          ...(assetLinked && values.targetAssetId
            ? {
                details: {
                  targetAssetId: values.targetAssetId,
                  ...(values.type === 'UPGRADE'
                    ? {
                        upgradeType: values.upgradeType || null,
                        currentSpec: currentSpec ?? null,
                        requestedSpec:
                          (values.requestedSpec === 'OTHER' ? values.otherText : values.requestedSpec) || null,
                        otherText: values.otherText || null,
                      }
                    : {}),
                  ...(values.type === 'REPLACEMENT'
                    ? {
                        replacementReason: values.replacementReason || null,
                        otherText: values.otherText || null,
                      }
                    : {}),
                },
                ...(values.type === 'UPGRADE' && values.upgradeType
                  ? {
                      preferredSpec: [
                        UPGRADE_TYPES.find(([k]) => k === values.upgradeType)?.[1],
                        currentSpec && `current: ${currentSpec}`,
                        (values.requestedSpec === 'OTHER' ? values.otherText : values.requestedSpec) &&
                          `requested: ${values.requestedSpec === 'OTHER' ? values.otherText : values.requestedSpec}`,
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    }
                  : {}),
              }
            : {}),
          items: values.items
            // A row somebody opened and left empty is not an item.
            .filter((item) => item.description.trim().length > 0)
            .map((item) => ({
            description: item.description,
            quantity: item.quantity,
            ...(canEnterCost && item.estimatedCost ? { estimatedCost: item.estimatedCost } : {}),
            ...(item.notes ? { preferredSpec: item.notes } : {}),
            ...(item.categoryId ? { categoryId: item.categoryId } : {}),
            ...(item.isUncatalogued
              ? {
                  isUncatalogued: true,
                  ...(item.manufacturer ? { manufacturer: item.manufacturer } : {}),
                  ...(item.model ? { model: item.model } : {}),
                  ...(item.referenceUrl ? { referenceUrl: item.referenceUrl } : {}),
                }
              : {}),
          })),
        },
      });
      // The pictures go up as the conversation's first message - the reason
      // with the pictures where they were written, from the requester,
      // visible to everyone who can see the request - so there is one storage
      // path and one set of visibility rules. If they fail, the request stays
      // a DRAFT rather than reaching approvers without the evidence it was
      // raised with; the person adds them from the request page and submits
      // from there.
      if (images.length > 0) {
        try {
          await postComment(created.id, { body: values.businessReason.trim(), isInternal: false, images });
        } catch {
          throw new DraftImagesError(created.id);
        }
      }
      // Created as a draft first, then submitted, so a validation failure never
      // leaves a half-built request in an approval queue.
      await apiFetch(`/requests/${created.id}/submit`, { method: 'POST' });
      return { ...created, imageCount: images.length };
    },
    onSuccess: (created) => {
      pictures.clearImages();
      toast.success(submittedMessage(created.imageCount));
      router.push(`/requests/${created.id}`);
    },
    onError: (caught) => {
      if (caught instanceof DraftImagesError) {
        toast.error(caught.message);
        router.push(`/requests/${caught.requestId}`);
        return;
      }
      toast.error('The request was not submitted');
      // Surface server-side field errors on the matching RHF fields.
      if (caught instanceof ApiError) {
        for (const [path, message] of Object.entries(caught.fieldErrors)) {
          form.setError(path as keyof RequestValues, { message });
        }
        form.setError('root', {
          message: caught.problem.detail ?? caught.problem.title,
        });
      } else {
        form.setError('root', { message: 'Could not create the request.' });
      }
    },
  });

  const priorityDot = (value: string) => PRIORITIES.find((p) => p.value === value)?.dot;

  // Asked before the form is offered, not after it is filled in. A company can
  // restrict raising requests to IT and HR, and every "Upgrade", "Replacement"
  // and "Report issue" button on My assets leads straight here - so without
  // this an employee writes the whole thing out and is refused on submit.
  if (raise.data && !raise.data.allowed) {
    return (
      <div className="mx-auto max-w-2xl">
        <nav aria-label="Breadcrumb" className="text-sm">
          <Link href="/requests" className="text-[var(--color-brand)]">
            Requests
          </Link>
          <span className="mx-1.5 text-[var(--color-content-subtle)]">/</span>
          <span className="text-[var(--color-content-muted)]">New Request</span>
        </nav>
        <Card className="mt-4 p-6">
          <h1 className="text-lg font-semibold tracking-tight">You cannot raise this yourself</h1>
          <p className="mt-2 text-sm text-[var(--color-content-muted)]">{raise.data.reason}</p>
          {prefillAbout ? (
            <p className="mt-3 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] p-3 text-sm">
              <span className="text-[var(--color-content-muted)]">Tell them it is about </span>
              <span className="font-medium">{prefillAbout}</span>.
            </p>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Link
              href="/my-assets"
              className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-2 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
            >
              Back to my equipment
            </Link>
            <Link
              href="/requests"
              className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-2 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
            >
              See my requests
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/requests" className="text-[var(--color-brand)]">
          Requests
        </Link>
        <span className="mx-1.5 text-[var(--color-content-subtle)]">/</span>
        <span className="text-[var(--color-content-muted)]">New Request</span>
      </nav>

      <header className="mt-4 flex items-start gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[var(--color-brand)]/10">
          <FileText aria-hidden="true" className="size-6 text-[var(--color-brand)]" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {reportingIssue ? 'Report an issue' : 'New Request'}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {issue
              ? `${issue.label} — tell us what is happening and IT will pick it up.`
              : reportingIssue
                ? 'Pick what is wrong and IT will pick it up.'
                : 'Your request will be routed for approval automatically based on what you ask for and its cost.'}
          </p>
        </div>
      </header>

      {reportingIssue && !issue ? (
        <Card className="mt-6 p-6">
          <h2 className="text-sm font-semibold">What is wrong?</h2>
          <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
            Pick the closest match. It decides who reviews it and how quickly — you can add the
            details on the next screen.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {ISSUE_CATEGORIES.map((category) => (
              <Link
                key={category.key}
                href={`/requests/new?issue=${category.key}${
                  prefillAbout ? `&about=${encodeURIComponent(prefillAbout)}` : ''
                }`}
                className="rounded-[var(--radius-card)] border border-[var(--color-border-strong)] p-3.5 transition hover:border-[var(--color-brand)] hover:bg-[var(--color-surface-sunken)]"
              >
                <span className="block text-sm font-medium">{category.label}</span>
                <span className="mt-0.5 block text-xs text-[var(--color-content-subtle)]">
                  {category.hint}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      ) : (
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(
              (values) => submit.mutate(values),
              // A refused submit used to show only a small line under the
              // field, often above the fold: the button looked dead. Say so,
              // and bring the first problem into view.
              (errors) => {
                const first = Object.keys(errors)[0];
                const detail = first ? (errors as Record<string, { message?: string }>)[first]?.message : undefined;
                toast.error(refusalMessage(first, detail));
                const el = document.querySelector<HTMLElement>(
                  first ? `[name="${first}"], [data-field="${first}"]` : 'form',
                );
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                (el?.querySelector<HTMLElement>('button, input, textarea, [contenteditable]') ?? el)?.focus?.();
              },
            )}
            className="grid content-start gap-4"
            noValidate
          >
            <Card className="grid gap-5 p-6">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      What do you need? <span style={{ color: 'var(--tone-critical-fg)' }}>*</span>
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TYPES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {assetLinked ? (
                <div className="grid gap-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)]/60 p-4">
                  {eligible.isPending ? (
                    <p className="flex items-center gap-2 text-sm text-[var(--color-content-muted)]">
                      <Loader2 aria-hidden="true" className="size-4 animate-spin" /> Loading your assets…
                    </p>
                  ) : eligible.isError ? (
                    <p className="text-sm" style={{ color: 'var(--tone-critical-fg)' }}>
                      Unable to load your assets. Please try again.
                    </p>
                  ) : eligible.data && eligible.data.length === 0 ? (
                    <div className="grid justify-items-start gap-2">
                      <p className="text-sm font-medium">No eligible assets were found.</p>
                      <p className="text-xs text-[var(--color-content-subtle)]">
                        Nothing is currently assigned to you, so there is nothing to{' '}
                        {type === 'UPGRADE' ? 'upgrade' : type === 'REPLACEMENT' ? 'replace' : 'report'}.
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => form.setValue('type', 'ADDITIONAL_EQUIPMENT', { shouldValidate: true })}
                      >
                        Request new equipment instead
                      </Button>
                    </div>
                  ) : (
                    <>
                      <FormField
                        control={form.control}
                        name="targetAssetId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              Which asset is this about?{' '}
                              <span style={{ color: 'var(--tone-critical-fg)' }}>*</span>
                            </FormLabel>
                            <Select value={field.value ?? ''} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select one of your assets" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {(eligible.data ?? []).map((asset) => (
                                  <SelectItem key={asset.id} value={asset.id}>
                                    {asset.name} · {asset.assetTag}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {selectedAsset ? (
                        <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5">
                          <p className="flex items-center gap-2 text-sm font-semibold">
                            <Laptop aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
                            {selectedAsset.name}
                          </p>
                          <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                            {[
                              ['Asset tag', selectedAsset.assetTag],
                              ['Serial number', selectedAsset.serialNumber ?? '—'],
                              ['Manufacturer', selectedAsset.hardwareProfile?.manufacturer ?? selectedAsset.brand ?? '—'],
                              ['Model', selectedAsset.model ?? '—'],
                              ['Category', selectedAsset.category?.name ?? '—'],
                              ['Location', selectedAsset.office?.name ?? '—'],
                              ['RAM', gb(selectedAsset.hardwareProfile?.ramGb) ?? '—'],
                              ['Storage', gb(selectedAsset.hardwareProfile?.storageTotalGb) ?? '—'],
                              ['Condition', selectedAsset.condition],
                              ['Purchased', fmtDate(selectedAsset.purchaseDate)],
                              ['Warranty until', fmtDate(selectedAsset.warrantyEndDate)],
                              ['Status', selectedAsset.status.replaceAll('_', ' ').toLowerCase()],
                            ].map(([k, v]) => (
                              <div key={k}>
                                <dt className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-content-subtle)]">{k}</dt>
                                <dd className="mt-0.5 font-medium">{v}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ) : null}

                      {type === 'UPGRADE' ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <FormField
                            control={form.control}
                            name="upgradeType"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>
                                  What upgrade is required?{' '}
                                  <span style={{ color: 'var(--tone-critical-fg)' }}>*</span>
                                </FormLabel>
                                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Choose an upgrade" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {UPGRADE_TYPES.map(([value, label]) => (
                                      <SelectItem key={value} value={value}>
                                        {label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          {upgradeType === 'RAM' || upgradeType === 'STORAGE' ? (
                            <FormField
                              control={form.control}
                              name="requestedSpec"
                              render={({ field }) => (
                                <FormItem data-field="requestedSpec">
                                  <FormLabel>
                                    Requested {upgradeType === 'RAM' ? 'RAM' : 'storage'}{' '}
                                    <span style={{ color: 'var(--tone-critical-fg)' }}>*</span>
                                  </FormLabel>
                                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue
                                          placeholder={
                                            currentSpec ? `Choose new size (now ${currentSpec})` : 'Choose new size'
                                          }
                                        />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      {(upgradeType === 'RAM' ? RAM_UPGRADE_OPTIONS : STORAGE_UPGRADE_OPTIONS).map((o) => (
                                        <SelectItem key={o} value={o}>
                                          {o}
                                        </SelectItem>
                                      ))}
                                      <SelectItem value="OTHER">Other…</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {currentSpec ? (
                                    <FormDescription>Currently: {currentSpec}</FormDescription>
                                  ) : null}
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          ) : null}
                        </div>
                      ) : null}

                      {type === 'REPLACEMENT' ? (
                        <FormField
                          control={form.control}
                          name="replacementReason"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                Reason for replacement{' '}
                                <span style={{ color: 'var(--tone-critical-fg)' }}>*</span>
                              </FormLabel>
                              <Select value={field.value ?? ''} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Choose a reason" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {REPLACEMENT_REASONS.map(([value, label]) => (
                                    <SelectItem key={value} value={value}>
                                      {label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      ) : null}

                      {(type === 'UPGRADE' && (upgradeType === 'OTHER' || requestedSpec === 'OTHER')) ||
                      (type === 'REPLACEMENT' && form.watch('replacementReason') === 'OTHER') ? (
                        <FormField
                          control={form.control}
                          name="otherText"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                Please specify <span style={{ color: 'var(--tone-critical-fg)' }}>*</span>
                              </FormLabel>
                              <FormControl>
                                <Input placeholder="Describe exactly what you need" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

              <FormField
                control={form.control}
                name="businessReason"
                render={({ field }) => (
                  <FormItem data-field="businessReason">
                    <FormLabel>
                      Why do you need it?{' '}
                      <span style={{ color: 'var(--tone-critical-fg)' }}>*</span>
                    </FormLabel>
                    <FormControl>
                      {/* Pictures go where the cursor is - "Add image", a drop, or a paste. */}
                      <InlineImageEditor
                        ref={reasonEditorRef}
                        aria-label="Why do you need it?"
                        value={field.value}
                        images={pictures.images}
                        previewFor={pictures.previewFor}
                        onChange={({ text, keys }) => {
                          field.onChange(text);
                          pictures.setOrder(keys);
                        }}
                        onAddFiles={pictures.addImages}
                        onRejectedDrop={() => toast.error('Only images can be dropped into the reason.')}
                        disabled={submit.isPending}
                        minRows={4}
                        placeholder="Provide a brief description of why you need this."
                      />
                    </FormControl>
                    <div className="flex flex-wrap items-center gap-3">
                      <AddImagesButton
                        onFiles={(files) => reasonEditorRef.current?.addFiles(files)}
                        disabled={submit.isPending || pictures.images.length >= MAX_COMMENT_IMAGES}
                        label="Add images to the request"
                      />
                      <FormDescription>
                        At least 10 characters. Approvers read this first — photos of the fault or the item
                        help them decide.
                      </FormDescription>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Priority <span style={{ color: 'var(--tone-critical-fg)' }}>*</span>
                      </FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <span className="flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="size-2 rounded-full"
                                style={{ background: priorityDot(field.value) }}
                              />
                              <SelectValue />
                            </span>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {PRIORITIES.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <span className="flex items-center gap-2">
                                <span
                                  aria-hidden="true"
                                  className="size-2 rounded-full"
                                  style={{ background: option.dot }}
                                />
                                {option.label}
                              </span>
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
                  name="requiredBy"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Needed by</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </Card>

            <Card className="grid gap-4 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Items</h2>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="border-[var(--color-brand)] text-[var(--color-brand)]"
                  onClick={() =>
                    append({ description: '', quantity: 1, estimatedCost: '', notes: '', categoryId: '', isUncatalogued: false, manufacturer: '', model: '', referenceUrl: '' })
                  }
                >
                  <Plus aria-hidden="true" className="size-3.5" />
                  Add Item
                </Button>
              </div>

              {fields.length === 0 ? (
                <p className="rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] px-4 py-6 text-center text-sm text-[var(--color-content-muted)]">
                  Optional. Use <span className="font-medium">Add Item</span> to list specific
                  equipment; otherwise the reason above is what approvers read.
                </p>
              ) : (
              <div className="rounded-[var(--radius-control)] border border-[var(--color-border)]">
                <div
                  className={`hidden gap-3 rounded-t-[var(--radius-control)] border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3 py-2 text-xs font-medium text-[var(--color-content-subtle)] sm:grid ${
                    canEnterCost
                      ? 'grid-cols-[1fr_5rem_7rem_10rem_2.5rem]'
                      : 'grid-cols-[1fr_5rem_12rem_2.5rem]'
                  }`}
                >
                  <span>Equipment name</span>
                  <span>Qty</span>
                  {canEnterCost ? <span>Est. cost</span> : null}
                  <span>Notes (optional)</span>
                  <span className="sr-only">Remove</span>
                </div>

                {fields.map((item, index) => (
                  <fieldset
                    key={item.id}
                    className={`grid items-start gap-3 border-b border-[var(--color-border)] px-3 py-3 last:border-0 ${
                      canEnterCost
                        ? 'sm:grid-cols-[1fr_5rem_7rem_10rem_2.5rem]'
                        : 'sm:grid-cols-[1fr_5rem_12rem_2.5rem]'
                    }`}
                  >
                    <legend className="sr-only">Item {index + 1}</legend>

                    <FormField
                      control={form.control}
                      name={`items.${index}.description`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="sm:sr-only">Equipment name</FormLabel>
                          <FormControl>
                            <div>
                              <EquipmentPicker
                                value={field.value}
                                catalog={catalog.data}
                                onChange={(description, categoryName) => {
                                  itemTouched.current = true;
                                  field.onChange(description);
                                  form.setValue(`items.${index}.isUncatalogued`, false);
                                  const match = categoryName
                                    ? catalog.data?.categories.find((c) => c.name === categoryName)
                                    : undefined;
                                  if (match) form.setValue(`items.${index}.categoryId`, match.id);
                                }}
                                onNotInList={() => setUncataloguedFor(index)}
                              />
                              {form.watch(`items.${index}.isUncatalogued`) ? (
                                <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[var(--color-tint-amber)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-tint-amber-fg)]">
                                  Uncatalogued item — admins will review
                                </span>
                              ) : null}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`items.${index}.quantity`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="sm:sr-only">Qty</FormLabel>
                          <FormControl>
                            <Input type="number" min={1} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {canEnterCost ? (
                      <FormField
                        control={form.control}
                        name={`items.${index}.estimatedCost`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="sm:sr-only">Est. cost</FormLabel>
                            <FormControl>
                              <Input inputMode="decimal" placeholder="0.00" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : null}

                    <FormField
                      control={form.control}
                      name={`items.${index}.notes`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="sm:sr-only">Notes (optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="Model, specs or links" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <button
                      type="button"
                      aria-label={`Remove item ${index + 1}`}
                      onClick={() => remove(index)}
                      className="grid size-9 place-items-center justify-self-end rounded-[var(--radius-control)] disabled:opacity-40"
                      style={{
                        color: 'var(--tone-critical-fg)',
                        backgroundColor: 'var(--tone-critical-bg)',
                      }}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  </fieldset>
                ))}
              </div>

              )}

              {fields.length > 0 ? (
                <p className="text-xs text-[var(--color-content-subtle)]">
                  {canEnterCost
                    ? 'Estimated cost decides whether finance approval is needed.'
                    : 'No prices here on purpose — procurement and finance attach costs during approval.'}
                </p>
              ) : null}
            </Card>

            {duplicate ? (
              <div
                className="rounded-[var(--radius-control)] border px-4 py-3 text-sm"
                style={{
                  color: 'var(--tone-warning-fg)',
                  backgroundColor: 'var(--tone-warning-bg)',
                  borderColor: 'var(--tone-warning-border)',
                }}
              >
                <p className="font-semibold">
                  You already have an open request about this — {duplicate.requestNumber}
                </p>
                <p className="mt-0.5 text-xs opacity-90">
                  Ask for an update there instead of raising it again. If it is still unresolved
                  after 10 days, you can submit a new one.
                </p>
                <Link
                  href={`/requests/${duplicate.id}`}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-current px-3 py-1.5 text-xs font-semibold"
                >
                  View request &amp; ask for an update →
                </Link>
              </div>
            ) : null}

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
              <Button type="button" variant="secondary" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" loading={submit.isPending} disabled={Boolean(duplicate)}>
                Submit for approval <Send aria-hidden="true" className="ml-1.5 size-4" />
              </Button>
            </div>
          </form>
        </Form>

        {uncataloguedFor !== null ? (
          <UncataloguedDialog
            catalog={catalog.data}
            canEnterCost={canEnterCost}
            onClose={() => setUncataloguedFor(null)}
            onAdd={(item) => {
              const index = uncataloguedFor;
              itemTouched.current = true;
              form.setValue(`items.${index}.description`, item.name, { shouldValidate: true });
              form.setValue(`items.${index}.quantity`, item.quantity);
              form.setValue(`items.${index}.categoryId`, item.categoryId ?? '');
              form.setValue(`items.${index}.notes`, item.notes);
              if (canEnterCost) form.setValue(`items.${index}.estimatedCost`, item.estimatedCost);
              form.setValue(`items.${index}.isUncatalogued`, true);
              form.setValue(`items.${index}.manufacturer`, item.manufacturer);
              form.setValue(`items.${index}.model`, item.model);
              form.setValue(`items.${index}.referenceUrl`, item.referenceUrl);
              setUncataloguedFor(null);
            }}
          />
        ) : null}

        <aside className="content-start">
          <Card className="grid gap-5 p-5">
            <div className="grid place-items-center rounded-[var(--radius-card)] bg-[var(--color-brand)]/5 py-6">
              <span className="grid size-16 place-items-center rounded-2xl bg-[var(--color-brand)]/10">
                <Send aria-hidden="true" className="size-7 text-[var(--color-brand)]" />
              </span>
            </div>
            <h2 className="text-sm font-semibold">Tips for a smooth approval</h2>
            <ul className="grid gap-4">
              {[...BASE_TIPS.slice(0, 2), canEnterCost ? COST_TIP : NOTES_TIP, BASE_TIPS[2]].map(({ Icon, title, body }) => (
                <li key={title} className="flex gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--color-brand)]/10">
                    <Icon aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-content-subtle)]">
                      {body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
      )}
    </div>
  );
}

/**
 * Searchable equipment picker fed by /requests/catalog: the domain baseline
 * merged with what the company actually owns, grouped by category. Typing
 * filters; anything not in the list is kept as free text via the explicit
 * "Use ..." row, which is the "Other" path.
 */
function EquipmentPicker({
  value,
  catalog,
  onChange,
  onNotInList,
}: {
  value: string;
  catalog: Catalog | undefined;
  onChange: (description: string, categoryName?: string) => void;
  onNotInList?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const q = value.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!catalog) return [];
    return catalog.groups
      .map((g) => ({
        label: g.label,
        items: q ? g.items.filter((i) => i.toLowerCase().includes(q)) : g.items,
      }))
      .filter((g) => g.items.length > 0);
  }, [catalog, q]);

  const exactMatch = filtered.some((g) => g.items.some((i) => i.toLowerCase() === q));

  return (
    <div ref={wrapRef} className="relative">
      <Input
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        placeholder="Search equipment… e.g. HDMI, mouse, laptop"
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
      />
      {open && catalog ? (
        <div className="absolute z-30 mt-1 max-h-64 w-full min-w-64 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] py-1 shadow-lg">
          {filtered.length === 0 && !q ? null : (
            <>
              {filtered.map((group) => (
                <div key={group.label}>
                  <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                    {group.label}
                  </p>
                  {group.items.slice(0, 8).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--color-surface-sunken)]"
                      onClick={() => {
                        onChange(item, group.label);
                        setOpen(false);
                      }}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ))}
              {q && !exactMatch ? (
                <button
                  type="button"
                  className="block w-full border-t border-[var(--color-border)] px-3 py-2 text-left text-sm font-medium text-[var(--color-brand)] hover:bg-[var(--color-surface-sunken)]"
                  onClick={() => setOpen(false)}
                >
                  Other — use &ldquo;{value.trim()}&rdquo;
                </button>
              ) : null}
              {onNotInList ? (
                <button
                  type="button"
                  className="block w-full border-t border-[var(--color-border)] px-3 py-2 text-left text-sm font-semibold text-[var(--color-brand)] hover:bg-[var(--color-surface-sunken)]"
                  onClick={() => {
                    setOpen(false);
                    onNotInList();
                  }}
                >
                  + Asset not in list
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

interface UncataloguedDraft {
  name: string;
  categoryId: string;
  quantity: number;
  estimatedCost: string;
  manufacturer: string;
  model: string;
  referenceUrl: string;
  notes: string;
}

/**
 * "Asset not in list": captures a one-off item the catalog does not carry.
 * Creates NO asset and NO catalog record - the data rides on the request item
 * (isUncatalogued) for admins to review and, if they choose, promote. A live
 * similarity check nudges the user toward an existing entry first.
 */
function UncataloguedDialog({
  catalog,
  canEnterCost,
  onClose,
  onAdd,
}: {
  catalog: Catalog | undefined;
  canEnterCost: boolean;
  onClose: () => void;
  onAdd: (item: { name: string; categoryId: string | null; quantity: number; estimatedCost: string; manufacturer: string; model: string; referenceUrl: string; notes: string }) => void;
}) {
  const [draft, setDraft] = useState<UncataloguedDraft>({
    name: '',
    categoryId: '',
    quantity: 1,
    estimatedCost: '',
    manufacturer: '',
    model: '',
    referenceUrl: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<UncataloguedDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const q = draft.name.trim().toLowerCase();
  const similar = useMemo(() => {
    if (!catalog || q.length < 3) return [];
    return catalog.groups
      .flatMap((g) => g.items.map((i) => ({ item: i, group: g.label })))
      .filter(({ item }) => item.toLowerCase().includes(q) || q.includes(item.toLowerCase()))
      .slice(0, 4);
  }, [catalog, q]);



  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Add uncatalogued item">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl">
        <h2 className="text-[15px] font-semibold">Add uncatalogued item</h2>
        <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
          For equipment the catalog does not carry yet. It stays attached to this request as an
          uncatalogued item — admins review it and decide whether it joins the catalog.
        </p>

        <div className="mt-4 grid gap-3">
          <div>
            <label htmlFor="unc-name" className="text-sm font-medium">
              Asset / equipment name <span style={{ color: 'var(--tone-critical-fg)' }}>*</span>
            </label>
            <input id="unc-name" className={`${inputCls} mt-1`} placeholder="e.g. USB-C to HDMI Adapter" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            {similar.length > 0 ? (
              <div className="mt-1.5 rounded-[var(--radius-control)] bg-[var(--color-tint-amber)]/60 px-3 py-2">
                <p className="text-xs font-medium text-[var(--color-tint-amber-fg)]">
                  A similar item already exists — use it instead?
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {similar.map(({ item }) => (
                    <button
                      key={item}
                      type="button"
                      className="rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
                      onClick={() => {
                        onAdd({ name: item, categoryId: null, quantity: draft.quantity, estimatedCost: '', manufacturer: '', model: '', referenceUrl: '', notes: '' });
                      }}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="unc-cat" className="text-sm font-medium">
                Category <span style={{ color: 'var(--tone-critical-fg)' }}>*</span>
              </label>
              <select id="unc-cat" className={`${inputCls} mt-1`} value={draft.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                <option value="">Choose a category</option>
                {(catalog?.categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="unc-qty" className="text-sm font-medium">
                Quantity <span style={{ color: 'var(--tone-critical-fg)' }}>*</span>
              </label>
              <input id="unc-qty" type="number" min={1} className={`${inputCls} mt-1`} value={draft.quantity} onChange={(e) => set({ quantity: Math.max(1, Number(e.target.value) || 1) })} />
            </div>
            <div>
              <label htmlFor="unc-make" className="text-sm font-medium">Manufacturer</label>
              <input id="unc-make" className={`${inputCls} mt-1`} value={draft.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })} />
            </div>
            <div>
              <label htmlFor="unc-model" className="text-sm font-medium">Model</label>
              <input id="unc-model" className={`${inputCls} mt-1`} value={draft.model} onChange={(e) => set({ model: e.target.value })} />
            </div>
            {canEnterCost ? (
              <div>
                <label htmlFor="unc-cost" className="text-sm font-medium">Estimated cost</label>
                <input id="unc-cost" inputMode="decimal" placeholder="0.00" className={`${inputCls} mt-1`} value={draft.estimatedCost} onChange={(e) => set({ estimatedCost: e.target.value })} />
              </div>
            ) : null}
            <div className={canEnterCost ? '' : 'sm:col-span-2'}>
              <label htmlFor="unc-link" className="text-sm font-medium">Reference / product link</label>
              <input id="unc-link" type="url" placeholder="https://…" className={`${inputCls} mt-1`} value={draft.referenceUrl} onChange={(e) => set({ referenceUrl: e.target.value })} />
            </div>
          </div>

          <div>
            <label htmlFor="unc-notes" className="text-sm font-medium">Description / notes</label>
            <textarea id="unc-notes" rows={2} className={`${inputCls} mt-1 h-auto py-2`} placeholder="Briefly describe the item and why this one." value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>

          {error ? <p className="text-sm" style={{ color: 'var(--tone-critical-fg)' }}>{error}</p> : null}

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              type="button"
              onClick={() => {
                if (draft.name.trim().length < 2) return setError('Name the asset or equipment.');
                if (!draft.categoryId) return setError('Choose a category.');
                setError(null);
                onAdd({
                  name: draft.name.trim(),
                  categoryId: draft.categoryId,
                  quantity: draft.quantity,
                  estimatedCost: draft.estimatedCost,
                  manufacturer: draft.manufacturer.trim(),
                  model: draft.model.trim(),
                  referenceUrl: draft.referenceUrl.trim(),
                  notes: draft.notes.trim(),
                });
              }}
            >
              Add to Request
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
