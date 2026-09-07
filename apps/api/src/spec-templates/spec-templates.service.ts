import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type { AuthUser, CreateSpecFieldInput, UpdateSpecFieldInput } from '@techpioasset/contracts';
import type { SpecFieldDefinition } from '@techpioasset/domain';
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

  /** The template for one category, in the order an administrator arranged it. */
  async list(actor: AuthUser, categoryId: string) {
    await this.categoryOrThrow(actor, categoryId);
    return this.prisma.client.categorySpecField.findMany({
      where: { categoryId, ...tenantFilter(actor), deletedAt: null },
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
  async definitionsFor(actor: AuthUser, categoryId: string): Promise<SpecFieldDefinition[]> {
    const rows = await this.prisma.client.categorySpecField.findMany({
      where: { categoryId, ...tenantFilter(actor), deletedAt: null, isComparable: true },
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

  async create(actor: AuthUser, input: CreateSpecFieldInput) {
    denyVendorUsers(actor, 'change what offers are described by');
    await this.categoryOrThrow(actor, input.categoryId);

    const clash = await this.prisma.client.categorySpecField.findFirst({
      where: { categoryId: input.categoryId, key: input.key, ...tenantFilter(actor), deletedAt: null },
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
