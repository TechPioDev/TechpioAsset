import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import type {
  AdjustStockInput,
  AuthUser,
  BatchListQuery,
  ConvertToAssetInput,
  CountCorrectionInput,
  CreateInventoryItemInput,
  CreateStockLocationInput,
  IssueStockInput,
  ReturnStockInput,
  ReserveStockInput,
  StockMovementQuery,
  TransferStockInput,
  UpdateStockLocationInput,
} from '@techpioasset/contracts';
import {
  batchShortfallMessage,
  expiryState,
  insufficientStockMessage,
  isLowStock,
  PERMISSIONS,
  planBatchIssue,
} from '@techpioasset/domain';
import type { PageQuery } from '@techpioasset/contracts';
import { AppError } from '../common/errors/app-error.js';
import { paginate } from '../common/paginate.js';
import { canSeeCost } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The refusal for a SKU that is already taken, naming what holds it. */
function skuClashMessage(sku: string, holder: { name: string; deletedAt: Date | null } | null) {
  if (!holder) return `SKU ${sku} is already in use`;
  return holder.deletedAt
    ? `SKU ${sku} belonged to "${holder.name}", which was removed - choose a different SKU`
    : `SKU ${sku} is already used by "${holder.name}"`;
}

/** How far ahead a lot counts as "about to go off". */
const EXPIRY_WARN_DAYS = 30;

/**
 * v2.10 S2 — the two shapes of bound.
 *
 * `PICKER_CAP` is for endpoints that fill a dropdown: paginating them would be
 * the wrong shape, and past a few hundred options the UI is the limitation
 * rather than the query. `LIST_CAP` is for lists that are read, not chosen
 * from, and which have no pagination yet.
 *
 * Neither is a substitute for pagination. They exist so that no response can
 * grow without limit while the endpoints that need paging get it.
 */
const PICKER_CAP = 500;
const LIST_CAP = 500;

/** The client shape Prisma passes to interactive-transaction callbacks. */
type Tx = Omit<
  PrismaService['client'],
  '$connect' | '$disconnect' | '$on' | '$use' | '$transaction' | '$extends'
>;

/**
 * v2.4 Warehouse stock. The append-only stock_movements ledger is the truth;
 * StockLevel rows are cached rollups changed ONLY through atomic conditional
 * updates whose WHERE clauses are the guards (never below reservations, never
 * negative), with the DB CHECKs as the last line of defence. Every mutation
 * posts its movement row in the same transaction.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── locations ──────────────────────────────────────────────────────────────

  /** Locations feed pickers too; capped for the same reason as listItems. */
  async listLocations(actor: AuthUser) {
    return this.prisma.client.stockLocation.findMany({
      where: { companyId: actor.companyId, deletedAt: null },
      take: PICKER_CAP,
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        officeId: true,
        isActive: true,
        _count: { select: { levels: true } },
      },
    });
  }

  async createLocation(actor: AuthUser, input: CreateStockLocationInput) {
    if (input.officeId) {
      const office = await this.prisma.client.office.findFirst({
        where: { id: input.officeId, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!office) throw AppError.notFound('Office', input.officeId);
    }
    try {
      return await this.prisma.client.stockLocation.create({
        data: {
          companyId: actor.companyId,
          code: input.code,
          name: input.name,
          officeId: input.officeId ?? null,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppError.conflict('CONFLICT', `A location with code ${input.code} already exists`);
      }
      throw error;
    }
  }

  async updateLocation(actor: AuthUser, id: string, input: UpdateStockLocationInput) {
    const location = await this.prisma.client.stockLocation.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!location) throw AppError.notFound('Stock location', id);
    return this.prisma.client.stockLocation.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.officeId !== undefined ? { officeId: input.officeId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedById: actor.id,
      },
    });
  }

  // ── catalogue ──────────────────────────────────────────────────────────────

  /**
   * Add an item to the stock catalogue. Describes the item only: quantity comes
   * through adjust(), so the ledger stays the single way stock reaches a shelf.
   *
   * The SKU arrives upper-cased from the contract, which makes the per-company
   * unique index case-insensitive for everything created here; the lookup below
   * is case-insensitive too so an older lower-case SKU is still caught, and it
   * includes deleted rows because the unique index does.
   */
  async createItem(actor: AuthUser, input: CreateInventoryItemInput) {
    const hasCost = input.unitCost !== undefined && input.unitCost !== null;
    if (hasCost && !canSeeCost(actor)) {
      throw AppError.forbidden('Only roles allowed to see purchase costs can enter one - leave the cost blank');
    }

    const category = await this.prisma.client.category.findFirst({
      where: { id: input.categoryId, companyId: actor.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!category) throw AppError.notFound('Category', input.categoryId);
    if (input.subcategoryId) {
      const sub = await this.prisma.client.subcategory.findFirst({
        where: { id: input.subcategoryId, categoryId: category.id },
        select: { id: true },
      });
      if (!sub) throw AppError.notFound('Subcategory', input.subcategoryId);
    }

    const clash = await this.prisma.client.inventoryItem.findFirst({
      where: { companyId: actor.companyId, sku: { equals: input.sku, mode: 'insensitive' } },
      select: { name: true, deletedAt: true },
    });
    if (clash) throw AppError.conflict('CONFLICT', skuClashMessage(input.sku, clash));

    let item;
    try {
      item = await this.prisma.client.inventoryItem.create({
        data: {
          companyId: actor.companyId,
          sku: input.sku,
          name: input.name,
          description: input.description ?? null,
          categoryId: category.id,
          subcategoryId: input.subcategoryId ?? null,
          unit: input.unit,
          minStock: input.minStock ?? null,
          reorderLevel: input.reorderLevel ?? null,
          ...(hasCost
            ? { unitCost: new Prisma.Decimal(input.unitCost!), currency: input.currency ?? 'INR' }
            : {}),
          createdById: actor.id,
          updatedById: actor.id,
        },
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          minStock: true,
          reorderLevel: true,
          quantityOnHand: true,
          batchTracked: true,
          categoryId: true,
          subcategoryId: true,
          unitCost: true,
          currency: true,
        },
      });
    } catch (error) {
      // Two people creating the same SKU at once: the index decides.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppError.conflict('CONFLICT', skuClashMessage(input.sku, null));
      }
      throw error;
    }

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.INVENTORY_ADJUSTED,
      entityType: 'InventoryItem',
      entityId: item.id,
      newValues: {
        kind: 'ITEM_CREATED',
        sku: item.sku,
        name: item.name,
        unit: item.unit,
        minStock: input.minStock ?? null,
        ...(hasCost ? { unitCost: input.unitCost, currency: item.currency } : {}),
      },
    });

    // Cost leaves only for the roles that may see it, same as the asset register.
    const { unitCost, currency, ...rest } = item;
    return canSeeCost(actor) ? { ...rest, unitCost, currency } : rest;
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  /**
   * The tenant's stock-item catalogue (for intake and adjustment pickers).
   *
   * v2.10 S2: capped, and searchable so the cap is survivable. A picker is not
   * a data list - nobody scrolls 5,000 options - so paginating it would be the
   * wrong shape. The honest limitation is that a tenant past the cap needs the
   * UI to send `q`; the cap is stated in the response header rather than the
   * list quietly stopping.
   */
  async listItems(actor: AuthUser, q?: string) {
    return this.prisma.client.inventoryItem.findMany({
      where: {
        companyId: actor.companyId,
        deletedAt: null,
        isActive: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                { sku: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      take: PICKER_CAP,
      orderBy: { name: 'asc' },
      // batchTracked so the receiving screen knows to ask for a lot number.
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        minStock: true,
        quantityOnHand: true,
        batchTracked: true,
      },
    });
  }

  /**
   * Stock levels — one row per item/location pair, so it grows as the product
   * of both. v2.10 S2: paginated. At the rig's volume this endpoint returned
   * 589 KB in a single response for only 2,000 levels, and a real estate is
   * far past that.
   */
  async listLevels(actor: AuthUser, query: PageQuery, inventoryItemId?: string, stockLocationId?: string) {
    const where = {
      companyId: actor.companyId,
      ...(inventoryItemId ? { inventoryItemId } : {}),
      ...(stockLocationId ? { stockLocationId } : {}),
    };
    return paginate(query, {
      count: () => this.prisma.client.stockLevel.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.stockLevel.findMany({
          where,
          skip,
          take,
          orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        quantity: true,
        reserved: true,
        updatedAt: true,
          inventoryItem: { select: { id: true, sku: true, name: true, unit: true, minStock: true } },
          stockLocation: { select: { id: true, code: true, name: true } },
        },
        }),
    });
  }

  async listMovements(actor: AuthUser, query: StockMovementQuery) {
    const where: Prisma.StockMovementWhereInput = {
      companyId: actor.companyId,
      ...(query.inventoryItemId ? { inventoryItemId: query.inventoryItemId } : {}),
      ...(query.stockLocationId ? { stockLocationId: query.stockLocationId } : {}),
    };
    return paginate(query, {
      count: () => this.prisma.client.stockMovement.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.stockMovement.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            quantity: true,
            refType: true,
            refId: true,
            reason: true,
            actorId: true,
            createdAt: true,
            stockLocationId: true,
            inventoryItem: { select: { id: true, sku: true, name: true } },
          },
        }),
    });
  }

  // ── guarded mutations ──────────────────────────────────────────────────────

  /** Hand stock out (consumables leaving the shelf). */
  async issue(actor: AuthUser, input: IssueStockInput) {
    const { item } = await this.assertRefs(actor, input.inventoryItemId, input.stockLocationId);
    // v2.9 C4: a batch-tracked item leaves the shelf lot by lot, oldest first.
    if (item.batchTracked) return this.issueFromBatches(actor, input, item);
    await this.takeStock(actor, {
      ...input,
      movementType: 'ISSUE',
      reason: input.reason ?? null,
      // v2.21 - the recipient IS the reference, so the movement ledger can
      // answer "what consumables does this person hold" without a second table.
      refType: input.issuedToUserId ? 'User' : null,
      refId: input.issuedToUserId ?? null,
      bumpGlobal: true,
    });
    await this.auditMovement(actor, input.inventoryItemId, 'ISSUE', input.quantity, input.reason);
    await this.maybeLowStockAlert(actor, input.inventoryItemId, input.stockLocationId);
    return this.levelOf(input.inventoryItemId, input.stockLocationId);
  }

  /**
   * v2.21 - a consumable comes back. The mirror of issue(): stock returns to
   * the shelf and the person's holding drops, both from the same ledger.
   */
  async returnFromUser(actor: AuthUser, input: ReturnStockInput) {
    await this.assertRefs(actor, input.inventoryItemId, input.stockLocationId);
    const held = await this.heldBy(actor, input.returnedByUserId);
    const current = held.find((h) => h.inventoryItemId === input.inventoryItemId);
    if (!current || current.quantity < input.quantity) {
      throw new AppError('VALIDATION_FAILED', 'That is more than this person is holding', {
        detail: `They currently hold ${current?.quantity ?? 0}.`,
      });
    }

    await this.addStock(actor, {
      inventoryItemId: input.inventoryItemId,
      stockLocationId: input.stockLocationId,
      quantity: input.quantity,
      movementType: 'RETURN',
      reason: input.reason ?? null,
      refType: 'User',
      refId: input.returnedByUserId,
      bumpGlobal: true,
    });
    await this.auditMovement(actor, input.inventoryItemId, 'RETURN', input.quantity, input.reason);
    return this.levelOf(input.inventoryItemId, input.stockLocationId);
  }

  /**
   * What a person is currently holding, summed from the movement ledger:
   * issues add to their holding, returns take it away. Derived rather than
   * stored, so it can never disagree with the movements behind it.
   */
  /**
   * What one person is holding. Your own holdings need no permission - a mouse
   * issued to you is your own record, and an employee had no way to see the
   * consumables in their name because the route asked for inventory:read.
   * Reading someone else's still does. Company scoping below is unconditional.
   */
  async heldBy(actor: AuthUser, userId: string) {
    if (userId !== actor.id && !actor.permissions.includes(PERMISSIONS.INVENTORY_READ)) {
      throw AppError.forbidden('Reading another person’s holdings needs inventory:read.');
    }

    const rows = await this.prisma.client.stockMovement.groupBy({
      by: ['inventoryItemId', 'type'],
      where: {
        companyId: actor.companyId,
        refType: 'User',
        refId: userId,
        type: { in: ['ISSUE', 'RETURN'] },
      },
      _sum: { quantity: true },
    });

    const net = new Map<string, number>();
    for (const r of rows) {
      const q = Number(r._sum.quantity ?? 0);
      net.set(r.inventoryItemId, (net.get(r.inventoryItemId) ?? 0) + (r.type === 'ISSUE' ? q : -q));
    }

    const outstanding = [...net.entries()].filter(([, q]) => q > 0);
    if (outstanding.length === 0) return [];

    const items = await this.prisma.client.inventoryItem.findMany({
      where: { id: { in: outstanding.map(([id]) => id) } },
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        category: { select: { name: true } },
        subcategory: { select: { key: true, name: true } },
      },
    });
    const byId = new Map(items.map((i) => [i.id, i]));

    return outstanding
      .map(([inventoryItemId, quantity]) => {
        const item = byId.get(inventoryItemId);
        return item ? { inventoryItemId, quantity, ...item } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }

  /** Manual correction, up or down, always with a reason. */
  async adjust(actor: AuthUser, input: AdjustStockInput) {
    await this.assertRefs(actor, input.inventoryItemId, input.stockLocationId);
    const quantity = Math.abs(input.delta);
    if (input.delta > 0) {
      await this.addStock(actor, {
        inventoryItemId: input.inventoryItemId,
        stockLocationId: input.stockLocationId,
        quantity,
        movementType: 'ADJUST_UP',
        reason: input.reason,
        refType: null,
        refId: null,
        bumpGlobal: true,
      });
    } else {
      await this.takeStock(actor, {
        inventoryItemId: input.inventoryItemId,
        stockLocationId: input.stockLocationId,
        quantity,
        movementType: 'ADJUST_DOWN',
        reason: input.reason,
        refType: null,
        refId: null,
        bumpGlobal: true,
      });
    }
    await this.auditMovement(
      actor,
      input.inventoryItemId,
      input.delta > 0 ? 'ADJUST_UP' : 'ADJUST_DOWN',
      quantity,
      input.reason,
    );
    await this.maybeLowStockAlert(actor, input.inventoryItemId, input.stockLocationId);
    return this.levelOf(input.inventoryItemId, input.stockLocationId);
  }

  /** Move stock between locations: one transaction, two ledger rows. */
  async transfer(actor: AuthUser, input: TransferStockInput) {
    await this.assertRefs(actor, input.inventoryItemId, input.fromLocationId);
    const to = await this.prisma.client.stockLocation.findFirst({
      where: { id: input.toLocationId, companyId: actor.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!to) throw AppError.notFound('Destination location', input.toLocationId);

    await this.prisma.client.$transaction(async (tx) => {
      await this.guardedTake(tx, actor, input.inventoryItemId, input.fromLocationId, input.quantity);
      await tx.stockMovement.create({
        data: {
          companyId: actor.companyId,
          inventoryItemId: input.inventoryItemId,
          stockLocationId: input.fromLocationId,
          type: 'TRANSFER_OUT',
          quantity: new Prisma.Decimal(input.quantity),
          reason: input.note ?? null,
          actorId: actor.id,
        },
      });
      await this.upsertAdd(tx, actor, input.inventoryItemId, input.toLocationId, input.quantity);
      const transfer = await tx.stockTransfer.create({
        data: {
          companyId: actor.companyId,
          inventoryItemId: input.inventoryItemId,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          quantity: new Prisma.Decimal(input.quantity),
          note: input.note ?? null,
          movedById: actor.id,
        },
        select: { id: true },
      });
      await tx.stockMovement.create({
        data: {
          companyId: actor.companyId,
          inventoryItemId: input.inventoryItemId,
          stockLocationId: input.toLocationId,
          type: 'TRANSFER_IN',
          quantity: new Prisma.Decimal(input.quantity),
          refType: 'StockTransfer',
          refId: transfer.id,
          reason: input.note ?? null,
          actorId: actor.id,
        },
      });
    });
    await this.auditMovement(actor, input.inventoryItemId, 'TRANSFER', input.quantity, input.note);
    await this.maybeLowStockAlert(actor, input.inventoryItemId, input.fromLocationId);
    return {
      from: await this.levelOf(input.inventoryItemId, input.fromLocationId),
      to: await this.levelOf(input.inventoryItemId, input.toLocationId),
    };
  }

  /** Earmark stock (e.g. for an approved request) without removing it. */
  async reserve(actor: AuthUser, input: ReserveStockInput) {
    await this.assertRefs(actor, input.inventoryItemId, input.stockLocationId);
    const affected = await this.prisma.client.$executeRaw`
      UPDATE "stock_levels"
         SET "reserved" = "reserved" + ${new Prisma.Decimal(input.quantity)}
       WHERE "inventoryItemId" = ${input.inventoryItemId}
         AND "stockLocationId" = ${input.stockLocationId}
         AND "companyId" = ${actor.companyId}
         AND "reserved" + ${new Prisma.Decimal(input.quantity)} <= "quantity"`;
    if (affected === 0) {
      const level = await this.levelOf(input.inventoryItemId, input.stockLocationId);
      throw AppError.conflict(
        'CONFLICT',
        insufficientStockMessage(level?.quantity.toString() ?? 0, level?.reserved.toString() ?? 0, input.quantity),
      );
    }
    return this.levelOf(input.inventoryItemId, input.stockLocationId);
  }

  async release(actor: AuthUser, input: ReserveStockInput) {
    const affected = await this.prisma.client.$executeRaw`
      UPDATE "stock_levels"
         SET "reserved" = "reserved" - ${new Prisma.Decimal(input.quantity)}
       WHERE "inventoryItemId" = ${input.inventoryItemId}
         AND "stockLocationId" = ${input.stockLocationId}
         AND "companyId" = ${actor.companyId}
         AND "reserved" - ${new Prisma.Decimal(input.quantity)} >= 0`;
    if (affected === 0) {
      throw AppError.conflict('CONFLICT', 'Cannot release more than is reserved');
    }
    return this.levelOf(input.inventoryItemId, input.stockLocationId);
  }

  /** A physical count overrides the shelf: post the signed difference. */
  async countCorrection(actor: AuthUser, input: CountCorrectionInput) {
    await this.assertRefs(actor, input.inventoryItemId, input.stockLocationId);
    const level = await this.levelOf(input.inventoryItemId, input.stockLocationId);
    const current = Number(level?.quantity ?? 0);
    const delta = input.countedQuantity - current;
    if (delta === 0) return { level, corrected: false as const };

    const shared = {
      inventoryItemId: input.inventoryItemId,
      stockLocationId: input.stockLocationId,
      quantity: Math.abs(delta),
      reason: 'Cycle-count correction',
      refType: 'PhysicalInventorySession',
      refId: input.sessionId ?? null,
      bumpGlobal: true,
    };
    if (delta > 0) await this.addStock(actor, { ...shared, movementType: 'ADJUST_UP' });
    else await this.takeStock(actor, { ...shared, movementType: 'ADJUST_DOWN' });

    await this.auditMovement(
      actor,
      input.inventoryItemId,
      delta > 0 ? 'ADJUST_UP' : 'ADJUST_DOWN',
      Math.abs(delta),
      `Cycle count: shelf said ${input.countedQuantity}, system said ${current}`,
    );
    return { level: await this.levelOf(input.inventoryItemId, input.stockLocationId), corrected: true as const };
  }

  /**
   * One unit of stock becomes a tracked asset — decrement and draft creation
   * in a single transaction, so the unit exists exactly once at all times.
   */
  async convertToAsset(actor: AuthUser, input: ConvertToAssetInput) {
    const item = await this.prisma.client.inventoryItem.findFirst({
      where: { id: input.inventoryItemId, companyId: actor.companyId, deletedAt: null },
      select: { id: true, name: true, categoryId: true, subcategoryId: true, unitCost: true, currency: true },
    });
    if (!item) throw AppError.notFound('Inventory item', input.inventoryItemId);
    await this.assertRefs(actor, input.inventoryItemId, input.stockLocationId);

    const asset = await this.prisma.client.$transaction(async (tx) => {
      await this.guardedTake(tx, actor, input.inventoryItemId, input.stockLocationId, 1);
      const created = await tx.asset.create({
        data: {
          companyId: actor.companyId,
          assetTag: input.assetTag,
          name: input.name ?? item.name,
          categoryId: item.categoryId,
          subcategoryId: item.subcategoryId,
          trackingType: 'INDIVIDUAL',
          serialNumber: input.serialNumber ?? null,
          qrToken: ulid(),
          purchaseCost: null,
          currency: item.currency ?? null,
          notes: input.notes ?? `Converted from stock item ${item.name}`,
          createdById: actor.id,
          updatedById: actor.id,
        },
        select: { id: true, assetTag: true, name: true, status: true },
      });
      await tx.stockMovement.create({
        data: {
          companyId: actor.companyId,
          inventoryItemId: input.inventoryItemId,
          stockLocationId: input.stockLocationId,
          type: 'CONVERT_TO_ASSET',
          quantity: new Prisma.Decimal(1),
          refType: 'Asset',
          refId: created.id,
          actorId: actor.id,
        },
      });
      await tx.inventoryItem.update({
        where: { id: input.inventoryItemId },
        data: { quantityOnHand: { decrement: 1 } },
      });
      return created;
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_CREATED,
      entityType: 'Asset',
      entityId: asset.id,
      newValues: { assetTag: asset.assetTag, convertedFrom: input.inventoryItemId },
      reason: 'Converted from stock',
    });
    await this.maybeLowStockAlert(actor, input.inventoryItemId, input.stockLocationId);
    return { asset, level: await this.levelOf(input.inventoryItemId, input.stockLocationId) };
  }

  /**
   * v2.5 H3 — draw a part for a work order. The exact same guarded take and
   * ledger discipline as issue(), but the movement row carries the work-order
   * reference so the record shows what was used to fix what.
   */
  async consumeForWorkOrder(
    actor: AuthUser,
    input: {
      inventoryItemId: string;
      stockLocationId: string;
      quantity: number;
      workOrderId: string;
      note?: string | null;
    },
  ) {
    await this.assertRefs(actor, input.inventoryItemId, input.stockLocationId);
    await this.takeStock(actor, {
      inventoryItemId: input.inventoryItemId,
      stockLocationId: input.stockLocationId,
      quantity: input.quantity,
      movementType: 'ISSUE',
      reason: input.note ?? null,
      refType: 'MaintenanceRecord',
      refId: input.workOrderId,
      bumpGlobal: true,
    });
    await this.auditMovement(
      actor,
      input.inventoryItemId,
      'WORK_ORDER_PART',
      input.quantity,
      input.note,
    );
    await this.maybeLowStockAlert(actor, input.inventoryItemId, input.stockLocationId);
    return this.levelOf(input.inventoryItemId, input.stockLocationId);
  }

  /** The parts drawn against one work order, newest first. */
  async partsForWorkOrder(companyId: string, workOrderId: string) {
    return this.prisma.client.stockMovement.findMany({
      where: { companyId, refType: 'MaintenanceRecord', refId: workOrderId, type: 'ISSUE' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        quantity: true,
        reason: true,
        createdAt: true,
        actorId: true,
        inventoryItem: { select: { id: true, sku: true, name: true, unit: true } },
      },
    });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  // -- batches and expiry (v2.9 C4) -------------------------------------------

  async listBatches(actor: AuthUser, query: BatchListQuery) {
    const now = new Date();
    const horizon = query.expiringWithinDays !== undefined ? new Date(now) : null;
    if (horizon) horizon.setDate(horizon.getDate() + (query.expiringWithinDays ?? 0));

    // v2.10 S2: capped. Lots grow with every delivery and never shrink until
    // consumed, so an uncapped list is unbounded by construction.
    const batches = await this.prisma.client.stockBatch.findMany({
      where: {
        companyId: actor.companyId,
        ...(query.inventoryItemId ? { inventoryItemId: query.inventoryItemId } : {}),
        ...(query.stockLocationId ? { stockLocationId: query.stockLocationId } : {}),
        ...(query.includeEmpty ? {} : { quantity: { gt: 0 } }),
        ...(horizon ? { expiryDate: { not: null, lte: horizon } } : {}),
      },
      take: LIST_CAP,
      orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
      select: {
        id: true,
        batchNumber: true,
        quantity: true,
        expiryDate: true,
        receivedAt: true,
        notes: true,
        inventoryItem: { select: { id: true, sku: true, name: true } },
        stockLocation: { select: { id: true, name: true } },
      },
    });
    // The state is computed, never stored: a batch expires because the calendar
    // moved, not because anything happened to the row.
    return batches.map((b) => ({ ...b, expiryState: expiryState(b, now, EXPIRY_WARN_DAYS) }));
  }

  /**
   * Issue from a batch-tracked item: FIFO by expiry, one ledger row per lot.
   *
   * The draw is planned first and then applied under guarded conditional
   * updates, so a concurrent issue that empties a lot in between makes this one
   * fail rather than quietly over-draw it.
   */
  private async issueFromBatches(
    actor: AuthUser,
    input: IssueStockInput,
    item: { id: string; name: string },
  ) {
    if (input.allowExpired && !input.expiredReason) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Issuing expired stock needs a reason - it is recorded against the movement',
      );
    }
    const now = new Date();
    const batches = await this.prisma.client.stockBatch.findMany({
      where: {
        companyId: actor.companyId,
        inventoryItemId: input.inventoryItemId,
        stockLocationId: input.stockLocationId,
        quantity: { gt: 0 },
      },
      select: { id: true, batchNumber: true, quantity: true, expiryDate: true, receivedAt: true },
    });
    const plan = planBatchIssue(batches, input.quantity, {
      on: now,
      allowExpired: input.allowExpired ?? false,
    });
    if (Number(plan.shortfall) > 0) {
      throw AppError.conflict('CONFLICT', batchShortfallMessage(item.name, input.quantity, plan));
    }

    await this.prisma.client.$transaction(async (tx) => {
      // The location total is guarded exactly as it always was; the lots are a
      // dimension of that same movement, not a separate accounting of it.
      await this.guardedTake(tx, actor, input.inventoryItemId, input.stockLocationId, input.quantity);
      for (const pick of plan.picks) {
        const taken = await tx.$executeRaw`
          UPDATE "stock_batches"
             SET "quantity" = "quantity" - ${new Prisma.Decimal(pick.quantity)}
           WHERE "id" = ${pick.batchId}
             AND "companyId" = ${actor.companyId}
             AND "quantity" - ${new Prisma.Decimal(pick.quantity)} >= 0`;
        if (taken === 0) {
          // Somebody else drew this lot down between the plan and the apply.
          throw AppError.conflict(
            'CONFLICT',
            `Lot ${pick.batchNumber} was drawn down by someone else while this issue was being prepared - try again`,
          );
        }
        await tx.stockMovement.create({
          data: {
            companyId: actor.companyId,
            inventoryItemId: input.inventoryItemId,
            stockLocationId: input.stockLocationId,
            stockBatchId: pick.batchId,
            type: 'ISSUE',
            quantity: new Prisma.Decimal(pick.quantity),
            reason: pick.expired
              ? `EXPIRED STOCK ISSUED: ${input.expiredReason}`
              : (input.reason ?? null),
            actorId: actor.id,
          },
        });
      }
      await tx.inventoryItem.update({
        where: { id: input.inventoryItemId },
        data: { quantityOnHand: { decrement: input.quantity } },
      });
    });

    await this.auditMovement(actor, input.inventoryItemId, 'ISSUE', input.quantity, input.reason);
    if (plan.usedExpired) {
      // Separately audited: "we handed out expired stock, and here is who said
      // it was fine" is a different question from "stock went out".
      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.STOCK_EXPIRED_ISSUED,
        entityType: 'InventoryItem',
        entityId: input.inventoryItemId,
        newValues: {
          item: item.name,
          lots: plan.picks.filter((p) => p.expired).map((p) => `${p.batchNumber} x ${p.quantity}`),
        },
        reason: input.expiredReason ?? undefined,
      });
    }
    await this.maybeLowStockAlert(actor, input.inventoryItemId, input.stockLocationId);
    const level = await this.levelOf(input.inventoryItemId, input.stockLocationId);
    return { ...level, batchesDrawn: plan.picks, usedExpired: plan.usedExpired };
  }

  /**
   * Receive into a lot. Called from inside the goods-receipt transaction, so
   * the batch and the receipt that created it cannot exist without each other.
   */
  async receiveIntoBatch(
    tx: Tx,
    actor: AuthUser,
    params: {
      inventoryItemId: string;
      stockLocationId: string;
      quantity: Prisma.Decimal;
      batchNumber: string;
      expiryDate: Date | null;
      sourceGrnLineId: string | null;
    },
  ) {
    const existing = await tx.stockBatch.findUnique({
      where: {
        inventoryItemId_stockLocationId_batchNumber: {
          inventoryItemId: params.inventoryItemId,
          stockLocationId: params.stockLocationId,
          batchNumber: params.batchNumber,
        },
      },
      select: { id: true, expiryDate: true },
    });
    if (existing) {
      // A lot number is the vendor's identity for a physical batch. The same
      // number arriving with a different expiry date means one of the two is
      // wrong, and guessing which would corrupt the issue order silently.
      const had = existing.expiryDate ? existing.expiryDate.toISOString().slice(0, 10) : null;
      const now = params.expiryDate ? params.expiryDate.toISOString().slice(0, 10) : null;
      if (had !== now) {
        throw AppError.conflict(
          'CONFLICT',
          `Lot ${params.batchNumber} already exists here with a different expiry date (${had ?? 'none'})`,
        );
      }
      await tx.stockBatch.update({
        where: { id: existing.id },
        data: { quantity: { increment: params.quantity } },
      });
      return existing.id;
    }
    const created = await tx.stockBatch.create({
      data: {
        companyId: actor.companyId,
        inventoryItemId: params.inventoryItemId,
        stockLocationId: params.stockLocationId,
        batchNumber: params.batchNumber,
        expiryDate: params.expiryDate,
        quantity: params.quantity,
        sourceGrnLineId: params.sourceGrnLineId,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Whether this item demands a lot number on receipt. */
  async batchTrackingFor(companyId: string, inventoryItemId: string) {
    return this.prisma.client.inventoryItem.findFirst({
      where: { id: inventoryItemId, companyId },
      select: { batchTracked: true, name: true },
    });
  }

  private async assertRefs(actor: AuthUser, inventoryItemId: string, stockLocationId: string) {
    const [item, location] = await Promise.all([
      this.prisma.client.inventoryItem.findFirst({
        where: { id: inventoryItemId, companyId: actor.companyId, deletedAt: null },
        select: { id: true, name: true, batchTracked: true },
      }),
      this.prisma.client.stockLocation.findFirst({
        where: { id: stockLocationId, companyId: actor.companyId, deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);
    if (!item) throw AppError.notFound('Inventory item', inventoryItemId);
    if (!location) throw AppError.notFound('Stock location', stockLocationId);
    return { item, location };
  }

  private levelOf(inventoryItemId: string, stockLocationId: string) {
    return this.prisma.client.stockLevel.findUnique({
      where: { inventoryItemId_stockLocationId: { inventoryItemId, stockLocationId } },
      select: { id: true, quantity: true, reserved: true },
    });
  }

  /** Conditional decrement — the WHERE clause keeps quantity >= reserved. */
  private async guardedTake(
    tx: Tx,
    actor: AuthUser,
    inventoryItemId: string,
    stockLocationId: string,
    quantity: number,
  ) {
    const affected = await tx.$executeRaw`
      UPDATE "stock_levels"
         SET "quantity" = "quantity" - ${new Prisma.Decimal(quantity)}
       WHERE "inventoryItemId" = ${inventoryItemId}
         AND "stockLocationId" = ${stockLocationId}
         AND "companyId" = ${actor.companyId}
         AND "quantity" - ${new Prisma.Decimal(quantity)} >= "reserved"`;
    if (affected === 0) {
      const level = await this.levelOf(inventoryItemId, stockLocationId);
      throw AppError.conflict(
        'CONFLICT',
        insufficientStockMessage(level?.quantity.toString() ?? 0, level?.reserved.toString() ?? 0, quantity),
      );
    }
  }

  private async upsertAdd(
    tx: Tx,
    actor: AuthUser,
    inventoryItemId: string,
    stockLocationId: string,
    quantity: number,
  ) {
    await tx.stockLevel.upsert({
      where: { inventoryItemId_stockLocationId: { inventoryItemId, stockLocationId } },
      create: {
        companyId: actor.companyId,
        inventoryItemId,
        stockLocationId,
        quantity: new Prisma.Decimal(quantity),
      },
      update: { quantity: { increment: new Prisma.Decimal(quantity) } },
    });
  }

  private async addStock(
    actor: AuthUser,
    input: {
      inventoryItemId: string;
      stockLocationId: string;
      quantity: number;
      movementType: 'ADJUST_UP' | 'RETURN';
      reason: string | null;
      refType: string | null;
      refId: string | null;
      bumpGlobal: boolean;
    },
  ) {
    await this.prisma.client.$transaction(async (tx) => {
      await this.upsertAdd(tx, actor, input.inventoryItemId, input.stockLocationId, input.quantity);
      await tx.stockMovement.create({
        data: {
          companyId: actor.companyId,
          inventoryItemId: input.inventoryItemId,
          stockLocationId: input.stockLocationId,
          type: input.movementType,
          quantity: new Prisma.Decimal(input.quantity),
          refType: input.refType,
          refId: input.refId,
          reason: input.reason,
          actorId: actor.id,
        },
      });
      if (input.bumpGlobal) {
        await tx.inventoryItem.update({
          where: { id: input.inventoryItemId },
          data: { quantityOnHand: { increment: input.quantity } },
        });
      }
    });
  }

  private async takeStock(
    actor: AuthUser,
    input: {
      inventoryItemId: string;
      stockLocationId: string;
      quantity: number;
      movementType: 'ISSUE' | 'ADJUST_DOWN';
      reason: string | null;
      refType: string | null;
      refId: string | null;
      bumpGlobal: boolean;
    },
  ) {
    await this.prisma.client.$transaction(async (tx) => {
      await this.guardedTake(tx, actor, input.inventoryItemId, input.stockLocationId, input.quantity);
      await tx.stockMovement.create({
        data: {
          companyId: actor.companyId,
          inventoryItemId: input.inventoryItemId,
          stockLocationId: input.stockLocationId,
          type: input.movementType,
          quantity: new Prisma.Decimal(input.quantity),
          refType: input.refType,
          refId: input.refId,
          reason: input.reason,
          actorId: actor.id,
        },
      });
      if (input.bumpGlobal) {
        await tx.inventoryItem.update({
          where: { id: input.inventoryItemId },
          data: { quantityOnHand: { decrement: input.quantity } },
        });
      }
    });
  }

  private async auditMovement(
    actor: AuthUser,
    inventoryItemId: string,
    kind: string,
    quantity: number,
    reason?: string | null,
  ) {
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.INVENTORY_ADJUSTED,
      entityType: 'InventoryItem',
      entityId: inventoryItemId,
      newValues: { kind, quantity },
      reason: reason ?? undefined,
    });
  }

  /** LOW_STOCK once per (level, day) when the location drops to the minimum. */
  private async maybeLowStockAlert(actor: AuthUser, inventoryItemId: string, stockLocationId: string) {
    const level = await this.prisma.client.stockLevel.findUnique({
      where: { inventoryItemId_stockLocationId: { inventoryItemId, stockLocationId } },
      select: {
        id: true,
        quantity: true,
        inventoryItem: { select: { name: true, minStock: true, createdById: true } },
        stockLocation: { select: { name: true } },
      },
    });
    if (!level || !isLowStock(level.quantity.toString(), level.inventoryItem.minStock?.toString())) return;
    const recipientId = level.inventoryItem.createdById;
    if (!recipientId) return;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const already = await this.prisma.client.notification.findFirst({
      where: { entityId: level.id, type: 'LOW_STOCK', createdAt: { gte: startOfDay } },
      select: { id: true },
    });
    if (already) return;

    await this.notifications.notify({
      companyId: actor.companyId,
      userId: recipientId,
      type: 'LOW_STOCK',
      title: `Low stock: ${level.inventoryItem.name}`,
      body: `${level.stockLocation.name} is down to ${Number(level.quantity)} (minimum ${Number(level.inventoryItem.minStock)}).`,
      linkPath: `/inventory`,
      entityType: 'StockLevel',
      entityId: level.id,
    });
  }
}
