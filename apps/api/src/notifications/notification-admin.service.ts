import { Injectable } from '@nestjs/common';
import { AuditAction, type NotificationType, Prisma } from '@prisma/client';
import { PUSH_CATEGORY } from '@techpioasset/domain';
import type { AuthUser } from '@techpioasset/contracts';
import { AppError } from '../common/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { NOTIFICATION_CATALOGUE } from './notification-catalogue.js';
import { DEFAULT_EMAIL_TEMPLATES, VARIABLE_HELP } from './email-template-defaults.js';

/**
 * Admin plane of the notification engine (v2.18): routing rules, email
 * templates, preview/test, and the delivery log. Everything is per-company
 * and SETTINGS_MANAGE-gated at the controller.
 */

const SAMPLE_VARS: Record<string, string> = {
  'subject.name': 'Alex Morgan',
  'subject.email': 'alex.morgan@example.com',
  'subject.department': 'Engineering',
  'asset.name': 'Dell Latitude 7450',
  'asset.asset_tag': 'PIO-01241',
  'asset.serial_number': 'C02XL7PIO14',
  'asset.category': 'IT Assets',
  'asset.manufacturer': 'Dell',
  'asset.model': 'Latitude 7450',
  'asset.status': 'In use',
  'asset.location': 'Head office',
  'asset.assigned_to': 'Alex Morgan',
  'asset.purchase_date': '2026-03-12',
  'warranty.expiry_date': '2026-09-14',
  'warranty.days_remaining': '30',
  'warranty.provider': 'Manufacturer warranty',
  // v2.19 onboarding placeholders, so invite/welcome previews render fully.
  'user.first_name': 'Alex',
  'user.email': 'alex.morgan@example.com',
  'company.name': 'Sample Company',
  'invited_by.name': 'Priya Raman',
  'invitation.expiry_date': '2026-08-21',
  'invitation.accept_url': 'https://pioassets.com/accept-invite',
};

/** v2.86 - which test alerts show buttons on the phone. */
const TEST_PUSH_CATEGORY: Partial<Record<NotificationType, string>> = {
  APPROVAL_REQUIRED: PUSH_CATEGORY.approval,
  APPROVAL_ESCALATED: PUSH_CATEGORY.approval,
  ASSET_ASSIGNED: PUSH_CATEGORY.receipt,
  RECEIPT_CONFIRMATION: PUSH_CATEGORY.receipt,
};

@Injectable()
export class NotificationAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Every event with its effective rule (stored row or implicit default). */
  async listRules(actor: AuthUser) {
    const [stored, roles] = await Promise.all([
      this.prisma.client.notificationRule.findMany({ where: { companyId: actor.companyId } }),
      this.prisma.client.role.findMany({
        where: { companyId: actor.companyId },
        orderBy: { name: 'asc' },
        select: { key: true, name: true },
      }),
    ]);
    const byType = new Map(stored.map((r) => [r.type, r]));
    const rules = Object.values(NOTIFICATION_CATALOGUE).map((definition) => {
      const row = byType.get(definition.type);
      return {
        type: definition.type,
        label: definition.title,
        mandatory: definition.mandatory,
        channels: definition.channels,
        enabled: row?.enabled ?? true,
        notifyPrimary: row?.notifyPrimary ?? true,
        recipientRoleKeys: row?.recipientRoleKeys ?? [],
        ccRoleKeys: row?.ccRoleKeys ?? [],
        escalationRoleKeys: row?.escalationRoleKeys ?? [],
        thresholds:
          row?.thresholds ??
          (definition.type === 'WARRANTY_EXPIRATION' ? [90, 60, 30, 15, 7, 1, 0] : []),
        stored: Boolean(row),
        updatedAt: row?.updatedAt ?? null,
      };
    });
    return { rules, roles };
  }

  async upsertRule(
    actor: AuthUser,
    type: NotificationType,
    input: {
      enabled: boolean;
      notifyPrimary: boolean;
      recipientRoleKeys: string[];
      ccRoleKeys: string[];
      escalationRoleKeys: string[];
      thresholds: number[];
    },
  ) {
    if (!NOTIFICATION_CATALOGUE[type]) throw AppError.notFound('Notification event', type);
    const definition = NOTIFICATION_CATALOGUE[type];
    if (definition.mandatory && !input.enabled) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${definition.title} is mandatory and cannot be disabled`,
      );
    }
    const rule = await this.prisma.client.notificationRule.upsert({
      where: { companyId_type: { companyId: actor.companyId, type } },
      create: { companyId: actor.companyId, type, ...input, updatedById: actor.id },
      update: { ...input, updatedById: actor.id },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'NotificationRule',
      entityId: rule.id,
      newValues: { type, ...input } as Prisma.InputJsonValue,
    });
    this.notifications.bustRuleCache(actor.companyId, type);
    return rule;
  }

  async listTemplates(actor: AuthUser) {
    const stored = await this.prisma.client.emailTemplate.findMany({
      where: { companyId: actor.companyId },
    });
    const byType = new Map(stored.map((t) => [t.type, t]));
    const templates = Object.values(NOTIFICATION_CATALOGUE)
      .filter((d) => d.channels.includes('EMAIL'))
      .map((definition) => {
        const row = byType.get(definition.type);
        const fallback = DEFAULT_EMAIL_TEMPLATES[definition.type];
        return {
          type: definition.type,
          label: definition.title,
          customized: Boolean(row),
          enabled: row?.enabled ?? true,
          subject: row?.subject ?? fallback?.subject ?? definition.title,
          heading: row?.heading ?? fallback?.heading ?? definition.title,
          body: row?.body ?? fallback?.body ?? 'Uses the live event text.',
          ctaLabel: row?.ctaLabel ?? fallback?.ctaLabel ?? 'Open PioAssets',
          updatedAt: row?.updatedAt ?? null,
        };
      });
    return { templates, variables: VARIABLE_HELP };
  }

  async upsertTemplate(
    actor: AuthUser,
    type: NotificationType,
    input: {
      subject: string;
      heading?: string | null;
      body: string;
      ctaLabel?: string | null;
      enabled: boolean;
    },
  ) {
    if (!NOTIFICATION_CATALOGUE[type]) throw AppError.notFound('Notification event', type);
    const template = await this.prisma.client.emailTemplate.upsert({
      where: { companyId_type: { companyId: actor.companyId, type } },
      create: {
        companyId: actor.companyId,
        type,
        subject: input.subject,
        heading: input.heading ?? null,
        body: input.body,
        ctaLabel: input.ctaLabel ?? null,
        enabled: input.enabled,
        updatedById: actor.id,
      },
      update: {
        subject: input.subject,
        heading: input.heading ?? null,
        body: input.body,
        ctaLabel: input.ctaLabel ?? null,
        enabled: input.enabled,
        updatedById: actor.id,
      },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'EmailTemplate',
      entityId: template.id,
      newValues: { type, subject: input.subject },
    });
    this.notifications.bustTemplateCache(actor.companyId, type);
    return template;
  }

  /** Reset to the code default by deleting the override. */
  async resetTemplate(actor: AuthUser, type: NotificationType) {
    await this.prisma.client.emailTemplate.deleteMany({
      where: { companyId: actor.companyId, type },
    });
    this.notifications.bustTemplateCache(actor.companyId, type);
    return { reset: true };
  }

  /** Rendered HTML with sample data - for the template editor's preview pane. */
  async preview(actor: AuthUser, type: NotificationType) {
    const rendered = await this.notifications.renderEmail(
      {
        companyId: actor.companyId,
        type,
        title: NOTIFICATION_CATALOGUE[type]?.title ?? 'Notification',
        body: 'This is a sample of the live event text for this notification.',
        linkPath: '/dashboard',
        vars: SAMPLE_VARS,
        emailRows: [
          ['Asset', 'Dell Latitude 7450'],
          ['Asset tag', 'PIO-01241'],
          ['Warranty ends', '2026-09-14 (30 days)'],
        ],
      },
      { name: 'Sample Recipient', email: actor.email },
    );
    return rendered;
  }

  /** Send the sample to the caller's own inbox. */
  async sendTest(actor: AuthUser, type: NotificationType) {
    await this.notifications.notify({
      companyId: actor.companyId,
      userId: actor.id,
      type,
      title: `[Test] ${NOTIFICATION_CATALOGUE[type]?.title ?? type}`,
      body: 'This is a test of the email template with sample data.',
      linkPath: '/dashboard',
      // v2.86 - a test of an alert that carries buttons shows those buttons on
      // the phone, so push and the buttons can be proved without waiting for a
      // real approval to land. The buttons act on nothing: with no request or
      // asset id, tapping one simply opens the app.
      ...(TEST_PUSH_CATEGORY[type] ? { push: { categoryId: TEST_PUSH_CATEGORY[type] } } : {}),
      vars: SAMPLE_VARS,
      emailRows: [
        ['Asset', 'Dell Latitude 7450'],
        ['Asset tag', 'PIO-01241'],
        ['Warranty ends', '2026-09-14 (30 days)'],
      ],
    });
    return { sent: true };
  }

  async emailLogs(
    actor: AuthUser,
    query: { page: number; pageSize: number; status?: string; type?: NotificationType; q?: string },
  ) {
    const where: Prisma.EmailLogWhereInput = {
      companyId: actor.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.q
        ? {
            OR: [
              { toEmail: { contains: query.q, mode: 'insensitive' } },
              { subject: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.client.emailLog.count({ where }),
      this.prisma.client.emailLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { rows, total, page: query.page, pageSize: query.pageSize };
  }

  /** Dashboard widget numbers. */
  async overview(actor: AuthUser) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const [sentToday, failedToday, warrantyToday] = await Promise.all([
      this.prisma.client.emailLog.count({
        where: {
          companyId: actor.companyId,
          createdAt: { gte: dayStart },
          status: { in: ['SENT', 'SIMULATED'] },
        },
      }),
      this.prisma.client.emailLog.count({
        where: { companyId: actor.companyId, createdAt: { gte: dayStart }, status: 'FAILED' },
      }),
      this.prisma.client.emailLog.count({
        where: {
          companyId: actor.companyId,
          createdAt: { gte: dayStart },
          type: 'WARRANTY_EXPIRATION',
        },
      }),
    ]);
    return { sentToday, failedToday, warrantyToday };
  }
}
