import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type {
  AuthUser,
  CreateSpecFieldInput,
  PromoteProposalInput,
  UpdateSpecFieldInput,
} from '@techpioasset/contracts';
import { isWorthAsking, type SpecFieldDefinition } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { denyVendorUsers, tenantFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Spec templates (v2.42).
 *
 * What a category's offers are described by, and therefore what a buyer can
 * compare them on. Administrator-editable on purpose: adding "does it have a
 * numeric keypad" to the laptop template should not require a release.
 *
 * Removing a field is a soft delete. Comparisons already made were snapshotted
 * when the offer was selected, so deleting a field never rewrites a decision
 * somebody has already defended.
 *
 * Every write refuses a supplier outright, on top of the route's permission:
 * a vendor deciding what buyers compare it on would be marking its own
 * homework, and the permission alone could be granted away by an administrator.
 */
@Injectable()
export class SpecTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private static readonly FIELDS = {
    id: true,
    categoryId: true,
    subcategoryId: true,
    key: true,
    label: true,
    dataType: true,
    unit: true,
    intent: true,
    tolerance: true,
    options: true,
    isRequired: true,
    isComparable: true,
    sortOrder: true,
  } as const;

  private async categoryOrThrow(actor: AuthUser, categoryId: string) {
    const category = await this.prisma.client.category.findFirst({
      where: { id: categoryId, ...tenantFilter(actor), deletedAt: null },
      select: { id: true, name: true },
    });
    if (!category) throw AppError.notFound('Category', categoryId);
    return category;
  }

  /**
   * Which fields apply, given a category and optionally a subcategory.
   *
   * A category-level field always applies; a subcategory's fields apply only
   * when that subcategory is the one being asked about. Asking for the
   * category alone therefore returns the shared questions, not every question
   * every subcategory has ever asked - a mouse should not be asked its RAM.
   */
  private scopeWhere(actor: AuthUser, categoryId: string, subcategoryId?: string) {
    return {
      categoryId,
      ...tenantFilter(actor),
      deletedAt: null,
      ...(subcategoryId
        ? { OR: [{ subcategoryId: null }, { subcategoryId }] }
        : { subcategoryId: null }),
    };
  }

  /** The template for one category, in the order an administrator arranged it. */
  async list(actor: AuthUser, categoryId: string, subcategoryId?: string) {
    await this.categoryOrThrow(actor, categoryId);
    return this.prisma.client.categorySpecField.findMany({
      where: this.scopeWhere(actor, categoryId, subcategoryId),
      select: SpecTemplatesService.FIELDS,
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      // Bounded: a template nobody would want to fill in is already too long.
      take: 200,
    });
  }

  /**
   * The comparable fields, in the shape the comparison rules expect.
   *
   * A field can be worth recording without being worth ranking on - a warranty
   * note, a colour - so the template says which is which and only those reach
   * the comparison.
   */
  async definitionsFor(
    actor: AuthUser,
    categoryId: string,
    subcategoryId?: string,
  ): Promise<SpecFieldDefinition[]> {
    const rows = await this.prisma.client.categorySpecField.findMany({
      where: { ...this.scopeWhere(actor, categoryId, subcategoryId), isComparable: true },
      select: SpecTemplatesService.FIELDS,
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      take: 200,
    });
    return rows.map((r) => ({
      key: r.key,
      label: r.label,
      dataType: r.dataType,
      unit: r.unit,
      intent: r.intent,
      tolerance: r.tolerance === null ? null : Number(r.tolerance),
    }));
  }


  /**
   * What suppliers have volunteered that the template never asked for.
   *
   * Grouped by the normalized key and counted by DISTINCT SUPPLIER, not by
   * offer: one supplier listing the same field on eight laptops is one opinion,
   * and counting rows would make it look like eight.
   */
  async proposals(actor: AuthUser, categoryId: string, subcategoryId?: string) {
    await this.categoryOrThrow(actor, categoryId);
    denyVendorUsers(actor, 'see what other suppliers have suggested');

    const rows = await this.prisma.client.vendorProposedSpec.findMany({
      where: {
        ...tenantFilter(actor),
        vendorProduct: {
          categoryId,
          deletedAt: null,
          ...(subcategoryId ? { subcategoryId } : {}),
        },
      },
      select: {
        normalizedKey: true,
        label: true,
        value: true,
        vendorProduct: { select: { vendorId: true, vendor: { select: { name: true } } } },
      },
      take: 2000,
    });

    const groups = new Map<
      string,
      { key: string; label: string; vendors: Set<string>; vendorNames: Set<string>; examples: string[] }
    >();
    for (const row of rows) {
      const group = groups.get(row.normalizedKey) ?? {
        key: row.normalizedKey,
        // The first spelling seen is as good as any; the label is a suggestion
        // an administrator edits when promoting.
        label: row.label,
        vendors: new Set<string>(),
        vendorNames: new Set<string>(),
        examples: [],
      };
      group.vendors.add(row.vendorProduct.vendorId);
      group.vendorNames.add(row.vendorProduct.vendor.name);
      if (group.examples.length < 4 && !group.examples.includes(row.value)) {
        group.examples.push(row.value);
      }
      groups.set(row.normalizedKey, group);
    }

    return [...groups.values()]
      .map((g) => ({
        key: g.key,
        label: g.label,
        vendorCount: g.vendors.size,
        vendors: [...g.vendorNames].sort(),
        examples: g.examples,
        worthAsking: isWorthAsking({ vendorCount: g.vendors.size }),
      }))
      // Most-agreed first: that ordering is the recommendation.
      .sort((a, b) => b.vendorCount - a.vendorCount || a.label.localeCompare(b.label));
  }

  /**
   * Promote a volunteered specification into the template.
   *
   * Two halves, and the second is what makes it worth doing: the field is
   * created, and every offer that already answered it has its answer moved into
   * the compared specification. Without that, promoting a field would compare
   * nothing until every supplier happened to edit their offer again.
   */
  async promote(actor: AuthUser, input: PromoteProposalInput) {
    denyVendorUsers(actor, 'change what offers are described by');
    await this.categoryOrThrow(actor, input.categoryId);

    const clash = await this.prisma.client.categorySpecField.findFirst({
      where: {
        categoryId: input.categoryId,
        subcategoryId: input.subcategoryId ?? null,
        key: input.normalizedKey,
        ...tenantFilter(actor),
        deletedAt: null,
      },
      select: { id: true },
    });
    if (clash) {
      throw new AppError('CONFLICT', 'That specification is already in the template');
    }

    const { normalizedKey, ...rest } = input;

    return this.prisma.client.$transaction(async (tx) => {
      const field = await tx.categorySpecField.create({
        data: {
          ...rest,
          key: normalizedKey,
          companyId: actor.companyId,
          tolerance: input.tolerance === undefined ? null : new Prisma.Decimal(input.tolerance),
          createdById: actor.id,
        },
        select: SpecTemplatesService.FIELDS,
      });

      const answered = await tx.vendorProposedSpec.findMany({
        where: {
          normalizedKey,
          ...tenantFilter(actor),
          vendorProduct: {
            categoryId: input.categoryId,
            deletedAt: null,
            ...(input.subcategoryId ? { subcategoryId: input.subcategoryId } : {}),
          },
        },
        select: { id: true, value: true, vendorProductId: true, vendorProduct: { select: { specs: true } } },
        take: 2000,
      });

      for (const row of answered) {
        const specs = (row.vendorProduct.specs ?? {}) as Record<string, string>;
        await tx.vendorProduct.update({
          where: { id: row.vendorProductId },
          data: { specs: { ...specs, [normalizedKey]: row.value } as Prisma.InputJsonValue },
        });
      }
      // Moved, not copied: leaving them behind would show the same fact twice.
      await tx.vendorProposedSpec.deleteMany({ where: { id: { in: answered.map((r) => r.id) } } });

      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.SETTING_CHANGED,
        entityType: 'CategorySpecField',
        entityId: field.id,
        newValues: {
          promotedFrom: normalizedKey,
          offersBackfilled: answered.length,
          categoryId: input.categoryId,
        },
      });

      return { ...field, offersBackfilled: answered.length };
    });
  }

  async create(actor: AuthUser, input: CreateSpecFieldInput) {
    denyVendorUsers(actor, 'change what offers are described by');
    await this.categoryOrThrow(actor, input.categoryId);

    if (input.subcategoryId) {
      // A subcategory from another category would produce a field nothing can
      // ever reach: the lookup always filters on the category first.
      const sub = await this.prisma.client.subcategory.findFirst({
        where: { id: input.subcategoryId, categoryId: input.categoryId, deletedAt: null },
        select: { id: true },
      });
      if (!sub) {
        throw new AppError('VALIDATION_FAILED', 'That subcategory is not in this category');
      }
    }

    const clash = await this.prisma.client.categorySpecField.findFirst({
      where: {
        categoryId: input.categoryId,
        key: input.key,
        subcategoryId: input.subcategoryId ?? null,
        ...tenantFilter(actor),
        deletedAt: null,
      },
      select: { id: true },
    });
    if (clash) {
      throw new AppError('CONFLICT', `This category already has a field called "${input.key}"`, {
        detail: 'Edit the existing field, or choose another key.',
      });
    }

    const field = await this.prisma.client.categorySpecField.create({
      data: {
        ...input,
        companyId: actor.companyId,
        tolerance: input.tolerance === undefined ? null : new Prisma.Decimal(input.tolerance),
        createdById: actor.id,
      },
      select: SpecTemplatesService.FIELDS,
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'CategorySpecField',
      entityId: field.id,
      newValues: { categoryId: input.categoryId, key: field.key, dataType: field.dataType },
    });
    return field;
  }

  async update(actor: AuthUser, id: string, input: UpdateSpecFieldInput) {
    denyVendorUsers(actor, 'change what offers are described by');
    const existing = await this.prisma.client.categorySpecField.findFirst({
      where: { id, ...tenantFilter(actor), deletedAt: null },
      select: SpecTemplatesService.FIELDS,
    });
    if (!existing) throw AppError.notFound('Spec field', id);

    if (input.key && input.key !== existing.key) {
      // The key is what ties a template field to the values vendors have already
      // entered. Renaming it silently orphans every one of them.
      const anyOffers = await this.prisma.client.vendorProduct.count({
        where: { categoryId: existing.categoryId, ...tenantFilter(actor), deletedAt: null },
      });
      if (anyOffers > 0) {
        throw new AppError('CONFLICT', 'This field cannot be renamed once offers exist in the category', {
          detail: 'Add a new field and retire this one; the values vendors entered are stored against the old key.',
        });
      }
    }

    const field = await this.prisma.client.categorySpecField.update({
      where: { id },
      data: {
        ...input,
        ...(input.tolerance === undefined ? {} : { tolerance: new Prisma.Decimal(input.tolerance) }),
        updatedById: actor.id,
      },
      select: SpecTemplatesService.FIELDS,
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'CategorySpecField',
      entityId: id,
      previousValues: existing,
      newValues: field,
    });
    return field;
  }

  /** Retire a field. The values vendors entered against it are left alone. */
  async remove(actor: AuthUser, id: string) {
    denyVendorUsers(actor, 'change what offers are described by');
    const existing = await this.prisma.client.categorySpecField.findFirst({
      where: { id, ...tenantFilter(actor), deletedAt: null },
      select: { id: true, key: true, categoryId: true },
    });
    if (!existing) throw AppError.notFound('Spec field', id);

    await this.prisma.client.categorySpecField.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actor.id },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'CategorySpecField',
      entityId: id,
      previousValues: existing,
      newValues: { retired: true },
    });
    return { id, retired: true };
  }
}
