import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  deriveLicenseStatus,
  shouldEscalateWorkOrder,
  expiryBucket,
  expiryState,
  isHighUtilization,
  seatsAvailable,
} from '@techpioasset/domain';
import { AuditAction, Prisma } from '@prisma/client';
import { AppConfig } from '../config/config.module.js';
import { AuditService } from '../audit/audit.service.js';
import { AssetHealthService } from '../asset-health/asset-health.service.js';
import { LenovoWarrantyService } from '../assets/lenovo-warranty.service.js';
import { MaintenanceService } from '../maintenance/maintenance.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../integrations/webhooks.service.js';
import { AuthService } from '../auth/auth.service.js';
import { TokenService } from '../auth/token.service.js';
import { withSpan } from '../observability/tracing.js';
import { VendorNotificationsService } from '../vendor-products/vendor-notifications.service.js';

/**
 * Warranty and maintenance alert sweep (spec section 14).
 *
 * Finds assets whose warranty falls in the 30/60/90-day windows and raises a
 * WARRANTY_EXPIRATION notification, and finds maintenance due today or overdue
 * and raises MAINTENANCE_DUE. Runs on a timer when ENABLE_SCHEDULED_JOBS is set,
 * and is also exposed as a method so it can be triggered and tested directly.
 *
 * De-duplication: it will not raise a second alert for the same asset+window
 * inside a day, so a sweep that runs hourly does not spam.
 */
/** Matches the warning window the batch list reports against. */
const EXPIRY_WARN_DAYS = 30;

/** Days a handover may sit unconfirmed before the first nudge. */
const RECEIPT_GRACE_DAYS = 3;
/** Then weekly, and no more than this many times. */
const RECEIPT_INTERVAL_DAYS = 7;
const RECEIPT_MAX_REMINDERS = 3;
/**
 * Rows one nightly pass will walk. The sweeps here are allowlisted as unbounded
 * because they process their whole working set, but "every open assignment in
 * every tenant" has no natural ceiling, so these two take a bite per night.
 */
const SWEEP_BATCH = 500;

@Injectable()
export class AlertSweepService implements OnModuleInit {
  private readonly logger = new Logger(AlertSweepService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly maintenance: MaintenanceService,
    private readonly assetHealth: AssetHealthService,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly lenovoWarranty: LenovoWarrantyService,
    private readonly webhooks: WebhooksService,
    private readonly vendorNotifications: VendorNotificationsService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('ENABLE_SCHEDULED_JOBS')) return;
    // Run shortly after boot, then daily. A cron system (BullMQ repeatable jobs)
    // would replace this in a clustered deployment; a single timer is correct for
    // one instance and keeps the dev path dependency-free.
    const daily = () => {
      // One span per nightly pass, so a slow or failing sweep is visible
      // rather than inferred from log timestamps.
      void withSpan('sweep.daily', async () => {
      void this.runWarrantySweep();
      void this.runApprovalEscalationSweep();
      void this.runLicenseSweep();
      void this.runStockSweep();
      void this.runExpirySweep();
      void this.runWorkOrderSweep();
      void this.runHealthSweep();
      void this.runDiscoveryStalenessSweep();
      void this.runReceiptSweep();
      void this.runReturnOverdueSweep();
      void this.runVendorOfferSweep();
      // Zero-touch warranty refresh: Lenovo answers serial lookups directly,
      // so those dates never need a human. Summary is logged by the service.
      void this.lenovoWarranty.sweep();
      void this.runDailyDigest();
      void this.runInviteSweep();
      // Retention: delete refresh tokens that have been dead for over a week.
      // Nothing ever removed them before, so the table only grew.
      void this.tokens.purgeDeadTokens();
      });
    };
    this.timer = setInterval(daily, 24 * 60 * 60 * 1000);
    this.timer.unref?.();
    setTimeout(daily, 5000).unref?.();
  }

  /**
   * Raises warranty-expiry alerts. Returns the number raised, so a test can
   * assert the sweep did its job.
   */
  async runWarrantySweep(now: Date = new Date()): Promise<number> {
    const horizon = new Date(now.getTime() + 181 * 86_400_000);

    const assets = await this.prisma.client.asset.findMany({
      where: {
        deletedAt: null,
        warrantyEndDate: { gte: now, lte: horizon },
        status: { notIn: ['DISPOSED', 'DONATED', 'RETIRED'] },
      },
      select: {
        id: true,
        companyId: true,
        assetTag: true,
        name: true,
        warrantyEndDate: true,
        assignedUserId: true,
        createdById: true,
      },
    });

    // v2.18: thresholds are configurable per company (default 90/60/30/15/7/1/0).
    // An alert fires only on the exact day-mark, which is also what makes the
    // sweep idempotent across days; the same-day guard covers restarts.
    const thresholdsByCompany = new Map<string, number[]>();
    const thresholdsFor = async (companyId: string): Promise<number[]> => {
      if (!thresholdsByCompany.has(companyId)) {
        const rule = await this.prisma.client.notificationRule.findUnique({
          where: { companyId_type: { companyId, type: 'WARRANTY_EXPIRATION' } },
          select: { thresholds: true, enabled: true },
        });
        thresholdsByCompany.set(
          companyId,
          rule && !rule.enabled ? [] : rule?.thresholds?.length ? rule.thresholds : [90, 60, 30, 15, 7, 1, 0],
        );
      }
      return thresholdsByCompany.get(companyId)!;
    };

    let raised = 0;
    for (const asset of assets) {
      if (!asset.warrantyEndDate) continue;
      const daysRemaining = Math.ceil((asset.warrantyEndDate.getTime() - now.getTime()) / 86_400_000);
      const thresholds = await thresholdsFor(asset.companyId);
      if (!thresholds.includes(daysRemaining)) continue;

      if (await this.alreadyAlertedToday(asset.id, 'WARRANTY_EXPIRATION', now)) continue;

      const expiresToday = daysRemaining === 0;
      const recipientId = asset.assignedUserId ?? asset.createdById;
      if (!recipientId) continue;

      await this.notifications.notify({
        companyId: asset.companyId,
        userId: recipientId,
        type: 'WARRANTY_EXPIRATION',
        title: expiresToday
          ? `Warranty expires today: ${asset.name}`
          : `Warranty expiring in ${daysRemaining} days: ${asset.name}`,
        body: expiresToday
          ? `${asset.assetTag}'s warranty ends today. Review the asset and decide the appropriate action.`
          : `${asset.assetTag}'s warranty ends ${asset.warrantyEndDate.toISOString().slice(0, 10)}. Review whether it should be renewed, replaced, or retired.`,
        linkPath: `/assets/${asset.id}`,
        entityType: 'Asset',
        entityId: asset.id,
        expand: true,
        escalate: daysRemaining <= 7,
        vars: {
          'asset.name': asset.name,
          'asset.asset_tag': asset.assetTag,
          'warranty.expiry_date': asset.warrantyEndDate.toISOString().slice(0, 10),
          'warranty.days_remaining': String(daysRemaining),
        },
        emailRows: [
          ['Asset', asset.name],
          ['Asset tag', asset.assetTag],
          ['Warranty ends', asset.warrantyEndDate.toISOString().slice(0, 10)],
          ['Days remaining', String(daysRemaining)],
        ],
      });
      raised += 1;
    }

    if (raised > 0) this.logger.log(`Warranty sweep raised ${raised} alert(s)`);
    return raised;
  }

  /** Raises maintenance-due alerts for work scheduled today or overdue. */
  async runMaintenanceSweep(now: Date = new Date()): Promise<number> {
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const due = await this.prisma.client.maintenanceRecord.findMany({
      where: { status: 'SCHEDULED', scheduledFor: { lte: endOfDay } },
      select: {
        id: true,
        title: true,
        requestedById: true,
        asset: { select: { companyId: true, assetTag: true } },
      },
    });

    let raised = 0;
    for (const record of due) {
      if (!record.requestedById) continue;
      if (await this.alreadyAlertedToday(record.id, 'MAINTENANCE_DUE', now)) continue;

      await this.notifications.notify({
        companyId: record.asset.companyId,
        userId: record.requestedById,
        type: 'MAINTENANCE_DUE',
        title: `Maintenance due: ${record.title}`,
        body: `Scheduled maintenance for ${record.asset.assetTag} is due.`,
        linkPath: `/maintenance/${record.id}`,
        entityType: 'MaintenanceRecord',
        entityId: record.id,
      });
      raised += 1;
    }

    return raised;
  }

  /**
   * v2.2 Workstream D — escalates approval steps whose SLA has lapsed.
   *
   * A PENDING step past its `slaDueAt` raises an APPROVAL_ESCALATED
   * notification and is marked `escalatedAt`, so it escalates exactly once
   * however often the sweep runs.
   *
   * v2.26 — it used to escalate ONLY to the request's manager or the
   * requester's line manager, and do nothing at all when there was neither.
   * Since nothing could write a line manager until now, that was every request:
   * the step was quietly stamped escalated, nobody was told, and because
   * `escalatedAt` bars a rescan the alert was gone for good. An overdue
   * approval that notifies nobody is worse than one that is merely overdue,
   * because the status says it was handled.
   *
   * So the recipient is now the first of: the manager it should go up to, or
   * failing that whoever the step is actually waiting on - a chase rather than
   * an escalation, but it reaches a desk that can move the request.
   */
  private async escalationRecipients(approval: {
    approverId: string | null;
    approverType: string;
    approverRoleId: string | null;
    request: {
      companyId: string;
      managerId: string | null;
      requesterId: string;
      requester: { profile: { managerId: string | null } | null };
    };
  }): Promise<string[]> {
    const upward = approval.request.managerId ?? approval.request.requester.profile?.managerId;
    if (upward) return [upward];

    // Self-approval is refused at the decide guard, so escalating to the
    // requester would send somebody to a button they cannot press.
    const notRequester = (ids: string[]) =>
      ids.filter((id) => id !== approval.request.requesterId);

    if (approval.approverId) return notRequester([approval.approverId]);

    // Mirrors RequestsService.resolveStepApprovers: a LINE_MANAGER step with no
    // recorded manager falls back to the Manager role, which is exactly who has
    // been carrying these approvals in practice.
    const where =
      approval.approverType === 'LINE_MANAGER'
        ? { role: { companyId: approval.request.companyId, key: 'MANAGER' } }
        : approval.approverRoleId
          ? { roleId: approval.approverRoleId }
          : null;
    if (!where) return [];

    const holders = await this.prisma.client.userRole.findMany({
      where: { ...where, user: { deletedAt: null, status: 'ACTIVE' as const } },
      select: { userId: true },
      take: 25,
    });
    return notRequester(holders.map((h) => h.userId));
  }

  async runApprovalEscalationSweep(now: Date = new Date()): Promise<number> {
    const overdue = await this.prisma.client.requestApproval.findMany({
      where: { decision: 'PENDING', escalatedAt: null, slaDueAt: { lt: now } },
      select: {
        id: true,
        stepName: true,
        requestId: true,
        approverId: true,
        approverType: true,
        approverRoleId: true,
        request: {
          select: {
            companyId: true,
            managerId: true,
            requesterId: true,
            requester: { select: { profile: { select: { managerId: true } } } },
          },
        },
      },
    });

    let raised = 0;
    for (const approval of overdue) {
      const recipients = await this.escalationRecipients(approval);
      for (const userId of recipients) {
        await this.notifications.notify({
          companyId: approval.request.companyId,
          userId,
          type: 'APPROVAL_ESCALATED',
          title: 'Approval overdue',
          body: `The "${approval.stepName}" approval step has passed its SLA and needs attention.`,
          linkPath: `/requests/${approval.requestId}`,
          entityType: 'AssetRequest',
          entityId: approval.requestId,
        });
      }
      // Counts STEPS escalated, not notifications sent - a step waiting on a
      // three-person role is one overdue approval, not three.
      if (recipients.length > 0) raised += 1;
      else {
        // Genuinely nobody to tell. Rare now, but it must not pass in silence:
        // this is a request that will sit until a human goes looking.
        this.logger.warn(
          `Overdue approval ${approval.id} ("${approval.stepName}") has no one to escalate to`,
        );
      }
      // Marked regardless, so an orphaned step is not rescanned every sweep.
      await this.prisma.client.requestApproval.update({
        where: { id: approval.id },
        data: { escalatedAt: now },
      });
    }

    if (raised > 0) this.logger.log(`Approval escalation sweep raised ${raised} alert(s)`);
    return raised;
  }

  /**
   * v2.3 L6 — licence housekeeping in one daily pass:
   * 1. refresh each licence's cached status from its expiry date;
   * 2. raise LICENSE_EXPIRING inside the 90/60/30-day buckets (once a day);
   * 3. raise SEAT_LIMIT_REACHED when a pool is full or at >=90% utilisation;
   * 4. reconcile the seat counter against actual ACTIVE assignments and WARN on
   *    drift - the counter stays authoritative for the limit, assignments for
   *    "who", and a mismatch means a bug worth investigating, not hiding.
   */
  async runLicenseSweep(
    now: Date = new Date(),
  ): Promise<{ expiring: number; capacity: number; drift: number }> {
    const licenses = await this.prisma.client.softwareLicense.findMany({
      where: { deletedAt: null, status: { not: 'RETIRED' } },
      select: {
        id: true,
        companyId: true,
        name: true,
        status: true,
        expiryDate: true,
        seatsPurchased: true,
        createdById: true,
        updatedById: true,
        pools: { select: { id: true, seatsAllocated: true, seatsReserved: true } },
      },
    });

    let expiring = 0;
    let capacity = 0;
    let drift = 0;

    for (const license of licenses) {
      // 1. Cached status follows the calendar.
      const derived = deriveLicenseStatus(license.expiryDate, now);
      if (derived !== license.status) {
        await this.prisma.client.softwareLicense.update({
          where: { id: license.id },
          data: { status: derived },
        });
      }

      const recipientId = license.createdById ?? license.updatedById;

      // 2. Expiry buckets.
      if (license.expiryDate && recipientId) {
        const bucket = expiryBucket(license.expiryDate, now);
        if (bucket && !(await this.alreadyAlertedToday(license.id, 'LICENSE_EXPIRING', now))) {
          await this.notifications.notify({
            companyId: license.companyId,
            userId: recipientId,
            type: 'LICENSE_EXPIRING',
            title: `License expiring: ${license.name}`,
            body: `${license.name} expires ${license.expiryDate.toDateString()} (within ${bucket} days). Plan the renewal.`,
            linkPath: `/licenses/${license.id}`,
            entityType: 'SoftwareLicense',
            entityId: license.id,
          });
          expiring += 1;
        }
      }

      // 3 + 4. Seat capacity and counter drift, per pool.
      for (const pool of license.pools) {
        const active = await this.prisma.client.licenseAssignment.count({
          where: { seatPoolId: pool.id, status: 'ACTIVE' },
        });
        if (active !== pool.seatsReserved) {
          drift += 1;
          this.logger.warn(
            `Seat counter drift on license ${license.id} pool ${pool.id}: reserved=${pool.seatsReserved}, active=${active}`,
          );
        }

        if (
          recipientId &&
          isHighUtilization(pool.seatsAllocated, pool.seatsReserved) &&
          !(await this.alreadyAlertedToday(license.id, 'SEAT_LIMIT_REACHED', now))
        ) {
          const free = seatsAvailable(pool.seatsAllocated, pool.seatsReserved);
          await this.notifications.notify({
            companyId: license.companyId,
            userId: recipientId,
            type: 'SEAT_LIMIT_REACHED',
            title: `License seats ${free === 0 ? 'exhausted' : 'nearly exhausted'}: ${license.name}`,
            body:
              free === 0
                ? `Every one of ${pool.seatsAllocated} seats is assigned. New assignments will be refused until seats are added or reclaimed.`
                : `Only ${free} of ${pool.seatsAllocated} seats remain.`,
            linkPath: `/licenses/${license.id}`,
            entityType: 'SoftwareLicense',
            entityId: license.id,
          });
          capacity += 1;
        }
      }
    }

    if (expiring + capacity + drift > 0) {
      this.logger.log(
        `License sweep: ${expiring} expiring alert(s), ${capacity} capacity alert(s), ${drift} drift warning(s)`,
      );
    }
    return { expiring, capacity, drift };
  }

  /**
   * v2.4 P7 - warehouse housekeeping in one daily pass:
   * 1. reconcile every StockLevel cache against the signed sum of its ledger
   *    and WARN on drift - never silently repair (the ledger is the truth and
   *    a mismatch is a bug to investigate, exactly like seat counters);
   * 2. raise LOW_STOCK for locations at or below the item minimum, once a day
   *    (catches levels that drifted low without a triggering mutation).
   */
  /**
   * The nightly stock pass: ledger-vs-cache drift, and low-stock alerts.
   *
   * v2.10 S3 — this used to load every stock level, then for EACH ONE load
   * every movement ever recorded for that item and location and sum them in
   * JavaScript. At 100,000 levels that is 100,000 round trips: 45 seconds
   * against a local database, and far worse across a network.
   *
   * Now the ledger is summed by the database, one grouped query per batch of
   * levels. The batch is what keeps memory bounded — a tenant with millions of
   * pairs must not need all of them resident at once — and BATCH_SIZE is the
   * stated bound.
   *
   * The arithmetic is unchanged: the SQL CASE is generated from the same sign
   * map the JavaScript used, so the two cannot drift apart. A movement type
   * with no sign still counts as zero, exactly as `sign[m.type] ?? 0` did.
   */
  async runStockSweep(now: Date = new Date()): Promise<{ drift: number; lowStock: number }> {
    /** How many stock levels are held in memory, and summed, at a time. */
    const BATCH_SIZE = 5_000;

    let drift = 0;
    let lowStock = 0;
    let cursor: string | undefined;

    // One query for the whole day's LOW_STOCK notifications instead of one per
    // low level: the old code asked the database "did I already warn about this
    // one?" separately for every level that was low.
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const alertedToday = new Set(
      (
        await this.prisma.client.notification.findMany({
          where: { type: 'LOW_STOCK', createdAt: { gte: startOfDay } },
          select: { entityId: true },
        })
      ).map((n) => n.entityId),
    );

    for (;;) {
      const levels = await this.prisma.client.stockLevel.findMany({
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: {
          id: true,
          companyId: true,
          quantity: true,
          inventoryItemId: true,
          stockLocationId: true,
          inventoryItem: { select: { name: true, minStock: true, createdById: true } },
          stockLocation: { select: { name: true } },
        },
      });
      if (levels.length === 0) break;
      cursor = levels.at(-1)!.id;

      const balances = await this.ledgerBalances(levels);

      for (const level of levels) {
        const balance = balances.get(`${level.inventoryItemId}:${level.stockLocationId}`) ?? 0;
        if (balance !== Number(level.quantity)) {
          drift += 1;
          this.logger.warn(
            `Stock ledger drift on level ${level.id}: cache=${Number(level.quantity)}, ledger=${balance}`,
          );
        }

        const min = level.inventoryItem.minStock;
        const recipientId = level.inventoryItem.createdById;
        if (
          min !== null &&
          Number(level.quantity) <= Number(min) &&
          recipientId &&
          !alertedToday.has(level.id)
        ) {
          await this.notifications.notify({
            companyId: level.companyId,
            userId: recipientId,
            type: 'LOW_STOCK',
            title: `Low stock: ${level.inventoryItem.name}`,
            body: `${level.stockLocation.name} is down to ${Number(level.quantity)} (minimum ${Number(min)}).`,
            linkPath: '/inventory',
            entityType: 'StockLevel',
            entityId: level.id,
          });
          // Within one run the same level must not be alerted twice either.
          alertedToday.add(level.id);
          lowStock += 1;
        }
      }

      if (levels.length < BATCH_SIZE) break;
    }

    if (drift + lowStock > 0) {
      this.logger.log(`Stock sweep: ${drift} drift warning(s), ${lowStock} low-stock alert(s)`);
    }
    return { drift, lowStock };
  }

  /**
   * The signed value of each movement type, and the single source of truth for
   * it. A type absent from this map contributes nothing — which is deliberate
   * for COUNT_CORRECTION, and was the behaviour of `sign[m.type] ?? 0` before.
   */
  private static readonly MOVEMENT_SIGN: Readonly<Record<string, 1 | -1>> = {
    RECEIPT: 1,
    ISSUE: -1,
    // v2.21 - a consumable handed back puts stock on the shelf exactly as a
    // receipt does. Omitting it here would have counted every return as zero
    // and reported permanent drift against a perfectly correct level.
    RETURN: 1,
    ADJUST_UP: 1,
    ADJUST_DOWN: -1,
    TRANSFER_IN: 1,
    TRANSFER_OUT: -1,
    CONVERT_TO_ASSET: -1,
  };

  /** Ledger balance per item/location pair, summed by the database. */
  private async ledgerBalances(
    levels: readonly { inventoryItemId: string; stockLocationId: string }[],
  ): Promise<Map<string, number>> {
    const signs = AlertSweepService.MOVEMENT_SIGN;
    // Generated from the map above so the SQL and the JS can never disagree.
    const positive = Object.keys(signs).filter((t) => signs[t] === 1);
    const negative = Object.keys(signs).filter((t) => signs[t] === -1);
    const caseSql = Prisma.sql`
      CASE
        WHEN "type"::text IN (${Prisma.join(positive)}) THEN "quantity"
        WHEN "type"::text IN (${Prisma.join(negative)}) THEN -"quantity"
        ELSE 0
      END`;

    const pairs = Prisma.join(
      levels.map((l) => Prisma.sql`(${l.inventoryItemId}, ${l.stockLocationId})`),
    );
    const rows = await this.prisma.client.$queryRaw<
      { inventoryItemId: string; stockLocationId: string; balance: string | number }[]
    >(Prisma.sql`
      SELECT "inventoryItemId", "stockLocationId", SUM(${caseSql}) AS balance
        FROM "stock_movements"
       WHERE ("inventoryItemId", "stockLocationId") IN (${pairs})
       GROUP BY "inventoryItemId", "stockLocationId"`);

    return new Map(rows.map((r) => [`${r.inventoryItemId}:${r.stockLocationId}`, Number(r.balance)]));
  }

  /**
   * v2.9 C4 - lots about to go off, and lots that already have.
   *
   * Expiry is the one stock problem nobody discovers by looking: the number on
   * the shelf does not change on the day it stops being usable. So the sweep
   * says so, once per lot per day, while there is still time to use it up.
   */
  async runExpirySweep(now: Date = new Date()): Promise<{ expiring: number; expired: number }> {
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + EXPIRY_WARN_DAYS);

    const batches = await this.prisma.client.stockBatch.findMany({
      where: { quantity: { gt: 0 }, expiryDate: { not: null, lte: horizon } },
      orderBy: { expiryDate: 'asc' },
      select: {
        id: true,
        companyId: true,
        batchNumber: true,
        quantity: true,
        expiryDate: true,
        inventoryItem: { select: { name: true, createdById: true } },
        stockLocation: { select: { name: true } },
      },
    });

    let expiring = 0;
    let expired = 0;
    for (const batch of batches) {
      const state = expiryState(batch, now, EXPIRY_WARN_DAYS);
      if (state !== 'EXPIRED' && state !== 'EXPIRING_SOON') continue;
      const recipientId = batch.inventoryItem.createdById;
      if (!recipientId) continue;
      if (await this.alreadyAlertedToday(batch.id, 'STOCK_EXPIRING', now)) continue;

      const day = batch.expiryDate!.toISOString().slice(0, 10);
      await this.notifications.notify({
        companyId: batch.companyId,
        userId: recipientId,
        type: 'STOCK_EXPIRING',
        title:
          state === 'EXPIRED'
            ? `Expired stock: ${batch.inventoryItem.name}`
            : `Stock expiring: ${batch.inventoryItem.name}`,
        body:
          `Lot ${batch.batchNumber} at ${batch.stockLocation.name} holds ${Number(batch.quantity)} ` +
          (state === 'EXPIRED' ? `and expired on ${day}.` : `and expires on ${day}.`),
        linkPath: '/inventory',
        entityType: 'StockBatch',
        entityId: batch.id,
      });
      if (state === 'EXPIRED') expired += 1;
      else expiring += 1;
    }

    if (expiring + expired > 0) {
      this.logger.log(`Expiry sweep: ${expiring} expiring soon, ${expired} already expired`);
    }
    return { expiring, expired };
  }

  /**
   * v2.5 H3 — work-order housekeeping in one daily pass:
   * 1. spawn work orders for due preventive schedules (idempotent: the due date
   *    advances strictly into the future in the same transaction);
   * 2. escalate overdue work orders EXACTLY ONCE (the approvals pattern):
   *    notify, audit, stamp escalatedAt.
   */
  async runWorkOrderSweep(now: Date = new Date()): Promise<{ spawned: number; escalated: number }> {
    const spawned = await this.maintenance.spawnDueSchedules(now);

    const candidates = await this.prisma.client.maintenanceRecord.findMany({
      where: {
        escalatedAt: null,
        slaDueAt: { lt: now },
        status: { in: ['SCHEDULED', 'IN_PROGRESS', 'ON_HOLD'] },
      },
      select: {
        id: true,
        title: true,
        status: true,
        slaDueAt: true,
        escalatedAt: true,
        technicianId: true,
        requestedById: true,
        asset: { select: { companyId: true, assetTag: true, createdById: true } },
      },
    });

    let escalated = 0;
    for (const order of candidates) {
      if (!shouldEscalateWorkOrder(order, now)) continue;

      // The technician on the hook first; the requester, then whoever manages
      // the asset, as fallbacks.
      const recipientId = order.technicianId ?? order.requestedById ?? order.asset.createdById;
      if (recipientId) {
        await this.notifications.notify({
          companyId: order.asset.companyId,
          userId: recipientId,
          type: 'WORK_ORDER_ESCALATED',
          title: `Work order overdue: ${order.title}`,
          body: `${order.asset.assetTag}: the SLA deadline (${order.slaDueAt?.toDateString()}) has passed.`,
          linkPath: `/maintenance/${order.id}`,
          entityType: 'MaintenanceRecord',
          entityId: order.id,
        });
      }
      await this.audit.record({
        companyId: order.asset.companyId,
        action: AuditAction.WORK_ORDER_ESCALATED,
        entityType: 'MaintenanceRecord',
        entityId: order.id,
        newValues: { slaDueAt: order.slaDueAt, status: order.status },
      });
      // Stamp regardless of recipient so an orphaned order is not rescanned.
      await this.prisma.client.maintenanceRecord.update({
        where: { id: order.id },
        data: { escalatedAt: now },
      });
      // v2.24: escalation crosses the product boundary too - the on-call
      // system watching this event is exactly the audience an overdue SLA is
      // for. The escalatedAt stamp above is what makes this exactly-once.
      void this.webhooks.publish(order.asset.companyId, 'workorder.escalated', {
        workOrderId: order.id,
        title: order.title,
        status: order.status,
        assetTag: order.asset.assetTag,
        slaDueAt: order.slaDueAt,
      });
      escalated += 1;
    }

    if (spawned > 0 || escalated > 0) {
      this.logger.log(`Work-order sweep spawned ${spawned}, escalated ${escalated}`);
    }
    return { spawned, escalated };
  }

  /**
   * v2.5 H7 - discovery staleness. A machine last reported more than 30 days
   * ago is running blind: its health score rests on old facts. The sweep WARNS
   * (it never fabricates a fresher picture) and returns the stale count so
   * operators and tests can see it.
   */
  async runDiscoveryStalenessSweep(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 30 * 86_400_000);
    const stale = await this.prisma.client.hardwareProfile.findMany({
      where: { lastDiscoveredAt: { lt: cutoff }, asset: { deletedAt: null } },
      select: { assetId: true, lastDiscoveredAt: true, asset: { select: { assetTag: true } } },
    });
    for (const profile of stale) {
      this.logger.warn(
        `Discovery stale: ${profile.asset.assetTag} last reported ` +
          `${profile.lastDiscoveredAt.toISOString().slice(0, 10)} (>30 days) - health rests on old facts`,
      );
    }
    return stale.length;
  }

  /** v2.5 H4 - daily recompute keeps every cached health score honest. */
  async runHealthSweep(now: Date = new Date()): Promise<number> {
    return this.assetHealth.recomputeAll(now);
  }

  /**
   * Chases receipts nobody has confirmed (v2.15).
   *
   * RECEIPT_CONFIRMATION is a mandatory notification that nothing emitted, so
   * an unconfirmed handover simply sat there: the record said a laptop was
   * issued and no one had ever asked the holder to agree.
   *
   * It waits three days before the first nudge - people are on leave, devices
   * are collected on a Monday - and stops after three. A reminder that has been
   * ignored three times is a conversation for a manager, not a fourth email,
   * and a notification that never stops is one users learn to filter.
   */
  async runReceiptSweep(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - RECEIPT_GRACE_DAYS * 86_400_000);

    const pending = await this.prisma.client.assetAssignment.findMany({
      where: {
        returnedAt: null,
        acknowledgedAt: null,
        assignedAt: { lte: cutoff },
        asset: { deletedAt: null },
      },
      select: {
        id: true,
        userId: true,
        assignedAt: true,
        asset: { select: { id: true, companyId: true, assetTag: true, name: true } },
      },
      orderBy: { assignedAt: 'asc' },
      take: SWEEP_BATCH,
    });

    let raised = 0;
    for (const assignment of pending) {
      const sent = await this.prisma.client.notification.count({
        where: { entityId: assignment.id, type: 'RECEIPT_CONFIRMATION' },
      });
      if (sent >= RECEIPT_MAX_REMINDERS) continue;
      if (await this.remindedWithin(assignment.id, 'RECEIPT_CONFIRMATION', RECEIPT_INTERVAL_DAYS, now))
        continue;

      const waiting = Math.floor((now.getTime() - assignment.assignedAt.getTime()) / 86_400_000);
      await this.notifications.notify({
        companyId: assignment.asset.companyId,
        userId: assignment.userId,
        type: 'RECEIPT_CONFIRMATION',
        title: `Confirm you received ${assignment.asset.name}`,
        body: `${assignment.asset.assetTag} was issued to you ${waiting} day(s) ago and you have not confirmed you have it. If you do not have this device, tell IT rather than confirming.`,
        linkPath: '/my-assets',
        // Keyed to the assignment, not the asset: the count above is what stops
        // this at three, and an asset reassigned later deserves its own three.
        entityType: 'AssetAssignment',
        entityId: assignment.id,
      });
      raised += 1;
    }

    if (raised > 0) this.logger.log(`Receipt sweep chased ${raised} unconfirmed handover(s)`);
    return raised;
  }

  /**
   * Raises RETURN_OVERDUE for equipment past its expected return date (v2.15).
   *
   * Both the holder and whoever issued it are told. Telling only the holder
   * makes an overdue loan invisible to the person accountable for it, and
   * telling only IT means the one person who can fix it in a minute never
   * hears. RETURN_OVERDUE is also a team-alert type, so the shared channel
   * gets a single post per asset per hour however many people are notified.
   */
  async runReturnOverdueSweep(now: Date = new Date()): Promise<number> {
    const overdue = await this.prisma.client.assetAssignment.findMany({
      where: {
        returnedAt: null,
        expectedReturnAt: { lt: now },
        asset: { deletedAt: null },
      },
      select: {
        id: true,
        userId: true,
        assignedById: true,
        expectedReturnAt: true,
        asset: { select: { id: true, companyId: true, assetTag: true, name: true } },
      },
      orderBy: { expectedReturnAt: 'asc' },
      take: SWEEP_BATCH,
    });

    let raised = 0;
    for (const assignment of overdue) {
      if (await this.alreadyAlertedToday(assignment.asset.id, 'RETURN_OVERDUE', now)) continue;

      const days = Math.floor(
        (now.getTime() - (assignment.expectedReturnAt as Date).getTime()) / 86_400_000,
      );
      // The holder and the issuer, deduplicated: self-issued kit would
      // otherwise notify the same person twice about one device.
      const recipients = new Set(
        [assignment.userId, assignment.assignedById].filter((v): v is string => Boolean(v)),
      );

      for (const userId of recipients) {
        await this.notifications.notify({
          companyId: assignment.asset.companyId,
          userId,
          type: 'RETURN_OVERDUE',
          title: `Return overdue: ${assignment.asset.name}`,
          body: `${assignment.asset.assetTag} was due back ${(assignment.expectedReturnAt as Date).toDateString()} - ${days} day(s) ago.`,
          linkPath: `/assets/${assignment.asset.id}`,
          entityType: 'Asset',
          entityId: assignment.asset.id,
        });
      }
      raised += 1;
    }

    if (raised > 0) this.logger.log(`Return sweep raised ${raised} overdue alert(s)`);
    return raised;
  }


  /**
   * Supplier offers that are about to stop being buyable (v2.50).
   *
   * Two ways an approved offer quietly leaves the buyable list: its end date
   * passes, or its stock reaches zero. Neither told anybody. The catalogue
   * simply got smaller, and the first sign was a buyer asking where something
   * had gone.
   *
   * The supplier is the only party who can fix either, and they are not sitting
   * in the app, so this goes out by email. Once a week per offer: a daily
   * reminder about a date three weeks out is how people learn to filter you.
   */
  async runVendorOfferSweep(now: Date = new Date()): Promise<number> {
    const soon = new Date(now.getTime() + 7 * 86_400_000);
    let raised = 0;

    const offers = await this.prisma.client.vendorProduct.findMany({
      where: {
        deletedAt: null,
        status: 'APPROVED',
        OR: [
          // Coming off sale within the week, or already past it.
          { availableUntil: { lte: soon } },
          // In date, but nothing left to sell.
          { availableUntil: { gt: now }, availableQuantity: { lte: 0 } },
        ],
      },
      select: {
        id: true,
        companyId: true,
        vendorId: true,
        name: true,
        availableUntil: true,
        availableQuantity: true,
      },
      take: 500,
    });

    for (const offer of offers) {
      const daysLeft = Math.ceil((offer.availableUntil.getTime() - now.getTime()) / 86_400_000);
      const expiring = offer.availableUntil <= soon;
      const empty = offer.availableQuantity <= 0 && offer.availableUntil > now;

      // The date first when both are true: an offer that has ended is not
      // buyable whatever its stock says, and two emails about one listing in
      // one morning is how a supplier learns to ignore both.
      if (expiring) {
        if (await this.remindedWithin(offer.id, 'VENDOR_PRODUCT_EXPIRING', 7, now)) continue;
        await this.vendorNotifications.expiring(offer, daysLeft);
        raised += 1;
      } else if (empty) {
        if (await this.remindedWithin(offer.id, 'VENDOR_PRODUCT_OUT_OF_STOCK', 7, now)) continue;
        await this.vendorNotifications.outOfStock(offer);
        raised += 1;
      }
    }

    if (raised > 0) this.logger.log(`Vendor offer sweep raised ${raised} alert(s)`);
    return raised;
  }

  /** Was this exact thing already chased inside the window? */
  private async remindedWithin(
    entityId: string,
    type: 'RECEIPT_CONFIRMATION' | 'VENDOR_PRODUCT_EXPIRING' | 'VENDOR_PRODUCT_OUT_OF_STOCK',
    days: number,
    now: Date,
  ): Promise<boolean> {
    const since = new Date(now.getTime() - days * 86_400_000);
    const recent = await this.prisma.client.notification.findFirst({
      where: { entityId, type, createdAt: { gte: since } },
      select: { id: true },
    });
    return recent !== null;
  }

  private async alreadyAlertedToday(
    entityId: string,
    type:
      | 'WARRANTY_EXPIRATION'
      | 'MAINTENANCE_DUE'
      | 'LICENSE_EXPIRING'
      | 'SEAT_LIMIT_REACHED'
      | 'LOW_STOCK'
      | 'STOCK_EXPIRING'
      | 'RETURN_OVERDUE',
    now: Date,
  ): Promise<boolean> {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const existing = await this.prisma.client.notification.findFirst({
      where: { entityId, type, createdAt: { gte: startOfDay } },
      select: { id: true },
    });
    return existing !== null;
  }
  /**
   * v2.18 - opt-in daily digest. Only companies whose DAILY_DIGEST rule is
   * enabled with configured roles receive it; once per calendar day.
   */
  async runDailyDigest(now: Date = new Date()): Promise<number> {
    const rules = await this.prisma.client.notificationRule.findMany({
      where: { type: 'DAILY_DIGEST', enabled: true },
      select: { companyId: true, recipientRoleKeys: true },
    });
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const in30 = new Date(now.getTime() + 30 * 86_400_000);
    let sent = 0;

    for (const rule of rules) {
      if (rule.recipientRoleKeys.length === 0) continue;
      const already = await this.prisma.client.notification.count({
        where: { companyId: rule.companyId, type: 'DAILY_DIGEST', createdAt: { gte: dayStart } },
      });
      if (already > 0) continue;

      const companyFilter = { companyId: rule.companyId, deletedAt: null } as const;
      const [expiring, expired, newAssets, assignments, missing, openRequests] = await Promise.all([
        this.prisma.client.asset.count({ where: { ...companyFilter, warrantyEndDate: { gte: now, lte: in30 } } }),
        this.prisma.client.asset.count({ where: { ...companyFilter, warrantyEndDate: { lt: now }, status: { notIn: ['RETIRED', 'DISPOSED'] } } }),
        this.prisma.client.asset.count({ where: { ...companyFilter, createdAt: { gte: dayAgo } } }),
        this.prisma.client.assetAssignment.count({ where: { assignedAt: { gte: dayAgo }, asset: { companyId: rule.companyId } } }),
        this.prisma.client.asset.count({ where: { ...companyFilter, status: 'LOST' } }),
        this.prisma.client.assetRequest.count({ where: { companyId: rule.companyId, createdAt: { gte: dayAgo }, status: { not: 'DRAFT' } } }),
      ]);

      await this.notifications.notifyRoles(rule.companyId, {
        type: 'DAILY_DIGEST',
        title: 'PioAssets daily summary',
        body: 'Here is what needs attention across the fleet today.',
        linkPath: '/dashboard',
        emailRows: [
          ['Warranties expiring (30 days)', String(expiring)],
          ['Warranties expired', String(expired)],
          ['New assets (24h)', String(newAssets)],
          ['Assignments (24h)', String(assignments)],
          ['Missing assets', String(missing)],
          ['New requests (24h)', String(openRequests)],
        ],
      });
      sent += 1;
    }
    if (sent > 0) this.logger.log(`Daily digest sent for ${sent} company(ies)`);
    return sent;
  }

  /**
   * v2.19 - invitation follow-up. An INVITED account that nobody activates is
   * either a person who lost the email or an account that should be cleaned up;
   * both deserve a nudge rather than silence.
   *
   * Reminder stages (days since the invite was created) come from the company's
   * INVITE_REMINDER rule thresholds, default [1, 3, 6]. The count of prior
   * INVITE_REMINDER email-log rows for the user is the stage cursor, so the
   * sweep is idempotent across restarts. Each reminder issues a FRESH 7-day
   * token (replacing the old one), matching the template's wording. Once the
   * outstanding token has expired and the account is still INVITED, a single
   * INVITE_EXPIRED notice goes out, guarded by its own email-log row.
   */
  async runInviteSweep(now: Date = new Date()): Promise<number> {
    const invited = await this.prisma.client.user.findMany({
      where: { status: 'INVITED', deletedAt: null },
      select: {
        id: true,
        email: true,
        companyId: true,
        createdAt: true,
        profile: { select: { firstName: true } },
      },
      take: SWEEP_BATCH,
    });
    if (invited.length === 0) return 0;

    // Stored INVITE_REMINDER rules per company: disabled means no reminders
    // (and no token churn); thresholds override the default stages.
    const reminderRules = await this.prisma.client.notificationRule.findMany({
      where: { type: 'INVITE_REMINDER', companyId: { in: [...new Set(invited.map((u) => u.companyId))] } },
      select: { companyId: true, enabled: true, thresholds: true },
    });
    const ruleByCompany = new Map(reminderRules.map((r) => [r.companyId, r]));

    let sent = 0;
    for (const user of invited) {
      const daysSince = Math.floor((now.getTime() - user.createdAt.getTime()) / 86_400_000);
      // Stale-invite guard: accounts invited over 30 days ago (bulk imports,
      // forgotten joiners) get neither reminders nor a months-late "expired"
      // notice - re-engaging them is an explicit Resend, not a 4am surprise.
      if (daysSince > 30) continue;
      const rule = ruleByCompany.get(user.companyId);
      const stages = (rule?.thresholds?.length ? rule.thresholds : [1, 3, 6]).slice().sort((a, b) => a - b);
      const firstName = user.profile?.firstName ?? user.email;

      const reminderCount = await this.prisma.client.emailLog.count({
        where: { toUserId: user.id, type: 'INVITE_REMINDER', status: { not: 'FAILED' } },
      });

      // Cooldown: the boot-time sweep must not advance a stage the nightly
      // pass already sent - for invites older than every stage threshold the
      // count-based cursor would otherwise fire once per API restart.
      const lastReminder = await this.prisma.client.emailLog.findFirst({
        where: { toUserId: user.id, type: 'INVITE_REMINDER', status: { not: 'FAILED' } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const cooledDown =
        !lastReminder || now.getTime() - lastReminder.createdAt.getTime() > 20 * 3_600_000;

      const nextStage = stages[reminderCount];
      if ((rule?.enabled ?? true) && cooledDown && nextStage !== undefined && daysSince >= nextStage) {
        const token = await this.auth.issueInviteToken(user.id);
        const expiry = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
        const acceptPath = `/accept-invite?token=${token}`;
        await this.notifications.sendTransactional({
          companyId: user.companyId,
          type: 'INVITE_REMINDER',
          toEmail: user.email,
          toUserId: user.id,
          recipientName: firstName,
          title: 'Reminder: your PioAssets invitation is waiting',
          body: 'Your PioAssets invitation has not been used yet.',
          linkPath: acceptPath,
          vars: {
            'user.first_name': firstName,
            'invited_by.name': 'your administrator',
            'invitation.expiry_date': expiry,
            'invitation.accept_url': `${this.config.get('WEB_URL')}${acceptPath}`,
          },
          emailRows: [
            ['Account email', user.email],
            ['Link expires', expiry],
          ],
          entityType: 'User',
          entityId: user.id,
        });
        sent += 1;
        continue;
      }

      // Expiry notice: only when every outstanding invite token is dead and we
      // have not said so already.
      const liveToken = await this.prisma.client.verificationToken.findFirst({
        where: { userId: user.id, purpose: 'INVITE', consumedAt: null, expiresAt: { gt: now } },
        select: { id: true },
      });
      if (liveToken) continue;
      const alreadyTold = await this.prisma.client.emailLog.count({
        where: { toUserId: user.id, type: 'INVITE_EXPIRED' },
      });
      if (alreadyTold > 0) continue;

      await this.notifications.sendTransactional({
        companyId: user.companyId,
        type: 'INVITE_EXPIRED',
        toEmail: user.email,
        toUserId: user.id,
        recipientName: firstName,
        title: 'Your PioAssets invitation has expired',
        body: 'The invitation link sent to you has expired and can no longer be used.',
        vars: { 'user.first_name': firstName },
        emailRows: [['Account email', user.email]],
        entityType: 'User',
        entityId: user.id,
      });
      sent += 1;
    }
    if (sent > 0) this.logger.log(`Invite sweep: ${sent} reminder/expiry email(s)`);
    return sent;
  }

}
