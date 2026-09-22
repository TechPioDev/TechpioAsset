import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { NotificationChannel, NotificationType } from '@prisma/client';
import type { AuthUser, PageQuery } from '@techpioasset/contracts';
import { AppError } from '../common/errors/app-error.js';
import { paginate } from '../common/paginate.js';
import { AppConfig } from '../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheProvider } from '../providers/cache/cache.provider.js';
import { ChatProvider } from '../providers/chat/chat.provider.js';
import { MailProvider } from '../providers/mail/mail.provider.js';
import { PushProvider } from '../providers/push/push.provider.js';
import { QueueProvider } from '../providers/queue/queue.provider.js';
import { NOTIFICATION_CATALOGUE, isMandatory } from './notification-catalogue.js';
import { interpolate, renderBrandedEmail } from './email-layout.js';
import {
  BRAND_LOGO_BASE64,
  BRAND_LOGO_CID,
  BRAND_LOGO_CONTENT_TYPE,
  BRAND_LOGO_FILENAME,
  BRAND_LOGO_HEIGHT,
  BRAND_LOGO_WIDTH,
} from './brand-logo.generated.js';
import { DEFAULT_EMAIL_TEMPLATES } from './email-template-defaults.js';

export /** Fallback audiences until an admin stores a rule. Keys are system roles. */
const DEFAULT_RULE_ROLES: Partial<Record<NotificationType, string[]>> = {
  USER_CREATED: ['HR', 'IT_ADMIN'],
  USER_DEACTIVATED: ['HR', 'IT_ADMIN'],
  ASSET_RETURNED: ['IT_ADMIN'],
  ASSET_TRANSFERRED: ['IT_ADMIN'],
  ASSET_MISSING: ['IT_ADMIN', 'SUPER_ADMIN'],
  USER_ACTIVATED: ['HR', 'IT_ADMIN'],
  // v2.78 - the Monday summary goes to whoever runs the system until an
  // admin routes it elsewhere under Settings -> Notifications.
  WEEKLY_SUMMARY: ['SUPER_ADMIN', 'IT_ADMIN'],
  // DAILY_DIGEST is deliberately opt-in: no audience until configured.
};

const SEND_NOTIFICATION_JOB = 'notification.send';
export const SEND_PUSH_JOB = 'notification.push';
export const SEND_CHAT_JOB = 'notification.chat';

/**
 * Team alerts (v2.12): the notification types worth interrupting a shared
 * Teams/Slack channel for. Personal traffic (your request was approved, your
 * asset is ready) stays out - a channel that repeats every user's inbox gets
 * muted within a week, and then the alerts that matter are muted with it.
 */
const TEAM_ALERT_TYPES: ReadonlySet<NotificationType> = new Set([
  'APPROVAL_ESCALATED',
  'RETURN_OVERDUE',
  'INVOICE_MISMATCH',
  'WARRANTY_EXPIRATION',
  'LOW_STOCK',
  'STOCK_EXPIRING',
  'LICENSE_EXPIRING',
  'SEAT_LIMIT_REACHED',
  'SECURITY_ALERT',
  'WORK_ORDER_ESCALATED',
  'AI_PROCESSING_FAILED',
  'REPORT_FAILED',
] as NotificationType[]);

export interface NotifyInput {
  companyId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  linkPath?: string;
  entityType?: string;
  entityId?: string;
  /** Template variables ({{asset.name}} etc.) for the email rendering. */
  vars?: Record<string, string>;
  /** Extra key-value rows for the email's information card. */
  emailRows?: [string, string][];
  /** Expand recipients via the company's routing rule (roles, CC). */
  expand?: boolean;
  /** Also include the rule's escalation roles (thresholds crossed). */
  escalate?: boolean;
  /**
   * v2.78 - phone-only extras: the buttons to draw (a PUSH_CATEGORY) and
   * the ids those buttons act on. Never shown to anyone; strings only,
   * because FCM refuses anything else.
   */
  push?: { categoryId?: string; data?: Record<string, string> };
}

interface SendJobPayload {
  /** Absent for transactional sends (invites, resets) with no in-app row. */
  notificationId?: string;
  companyId: string;
  type: NotificationType;
  userId: string;
  entityType?: string;
  entityId?: string;
  html?: string;
  email: string;
  subject: string;
  text: string;
}

interface PushJobPayload {
  userId: string;
  title: string;
  body: string;
  linkPath?: string;
  categoryId?: string;
  data?: Record<string, string>;
}

interface ChatJobPayload {
  companyId: string;
  title: string;
  body: string;
  linkPath?: string;
}

/**
 * One shared attachment object - the bytes never change, so it is built once
 * rather than per message.
 */
const BRAND_LOGO_ATTACHMENT = {
  filename: BRAND_LOGO_FILENAME,
  content: BRAND_LOGO_BASE64,
  contentType: BRAND_LOGO_CONTENT_TYPE,
  encoding: 'base64' as const,
  cid: BRAND_LOGO_CID,
};

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProvider,
    private readonly mail: MailProvider,
    private readonly push: PushProvider,
    private readonly chat: ChatProvider,
    private readonly cache: CacheProvider,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.queue.register<SendJobPayload>(SEND_NOTIFICATION_JOB, async (payload) => {
      try {
        const result = await this.mail.send({
          to: payload.email,
          subject: payload.subject,
          text: payload.text,
          // The logo is attached here rather than carried in the job payload:
          // it is the same 9KB on every message, and the queue should not be
          // storing a copy of it per queued email.
          ...(payload.html ? { html: payload.html, attachments: [BRAND_LOGO_ATTACHMENT] } : {}),
        });

        if (payload.notificationId) {
          await this.prisma.client.notification.update({
            where: { id: payload.notificationId },
            data: { deliveredAt: new Date(), simulated: result.simulated },
          });
        }
        await this.logEmail(payload, result.simulated ? 'SIMULATED' : 'SENT', null);
      } catch (error) {
        await this.logEmail(payload, 'FAILED', (error as Error).message);
        throw error;
      }
    });

    // Team alerts post to the company's Teams/Slack webhook off the request
    // path. No webhook configured is a no-op, not an error.
    this.queue.register<ChatJobPayload>(SEND_CHAT_JOB, async (payload) => {
      const company = await this.prisma.client.company.findUnique({
        where: { id: payload.companyId },
        select: { teamAlertWebhookUrl: true },
      });
      if (!company?.teamAlertWebhookUrl) return;
      await this.chat.post(company.teamAlertWebhookUrl, {
        title: payload.title,
        text: payload.body,
        ...(payload.linkPath
          ? { linkUrl: `${this.config.get('WEB_URL')}${payload.linkPath}` }
          : {}),
      });
    });

    // Push delivery runs off the request path too. A recipient with no registered
    // device is a no-op, not an error — most users are web-only.
    this.queue.register<PushJobPayload>(SEND_PUSH_JOB, async (payload) => {
      const devices = await this.prisma.client.deviceToken.findMany({
        where: { userId: payload.userId, revokedAt: null },
        select: { token: true },
      });
      if (devices.length === 0) return;

      const result = await this.push.send({
        tokens: devices.map((d) => d.token),
        title: payload.title,
        body: payload.body,
        ...(payload.linkPath || payload.data
          ? {
              data: {
                ...(payload.data ?? {}),
                ...(payload.linkPath ? { linkPath: payload.linkPath } : {}),
              },
            }
          : {}),
        ...(payload.categoryId ? { categoryId: payload.categoryId } : {}),
      });

      // Prune tokens the push service reported as dead, so they stop being retried.
      if (result.invalidTokens.length > 0) {
        await this.prisma.client.deviceToken.updateMany({
          where: { token: { in: result.invalidTokens } },
          data: { revokedAt: new Date() },
        });
      }
    });
  }

  /**
   * Records an in-app notification and queues email where permitted.
   *
   * The in-app row is written synchronously so the bell is correct the moment the
   * triggering action returns; only delivery is deferred. Doing both in the job
   * would make notifications appear seconds late for no benefit.
   */
  async notify(input: NotifyInput): Promise<void> {
    const definition = NOTIFICATION_CATALOGUE[input.type];

    // v2.18: the company's routing rule. Disabled switches the whole event off
    // (mandatory types excepted); expand fans out to the configured roles.
    const rule = await this.getRule(input.companyId, input.type);
    if (rule && !rule.enabled && !definition.mandatory) return;

    if (input.expand) {
      const roleKeys = [
        ...(rule?.recipientRoleKeys ?? []),
        ...(rule?.ccRoleKeys ?? []),
        ...(input.escalate ? (rule?.escalationRoleKeys ?? []) : []),
      ];
      const extra = roleKeys.length
        ? await this.prisma.client.userRole.findMany({
            where: {
              role: { companyId: input.companyId, key: { in: roleKeys } },
              user: { deletedAt: null, status: 'ACTIVE' },
            },
            select: { userId: true },
            distinct: ['userId'],
            take: 100,
          })
        : [];
      const recipients = new Set<string>(extra.map((e) => e.userId));
      if (rule?.notifyPrimary !== false) recipients.add(input.userId);
      for (const userId of recipients) {
        await this.notify({ ...input, userId, expand: false, escalate: false });
      }
      return;
    }

    const notification = await this.prisma.client.notification.create({
      data: {
        companyId: input.companyId,
        userId: input.userId,
        type: input.type,
        channel: 'IN_APP',
        title: input.title,
        body: input.body,
        linkPath: input.linkPath,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });

    // High-signal types also go to the company's team channel - once per
    // event, not once per recipient. The same escalation may notify five
    // people; the cache key collapses them into a single channel post per
    // hour, which also survives the sweep re-raising an unresolved alert.
    if (TEAM_ALERT_TYPES.has(input.type)) {
      const dedupeKey = `team-alert:${input.companyId}:${input.type}:${input.entityId ?? input.title}`;
      await this.cache.wrap(dedupeKey, 3600, async () => {
        await this.queue.enqueue<ChatJobPayload>(SEND_CHAT_JOB, {
          companyId: input.companyId,
          title: input.title,
          body: input.body,
          ...(input.linkPath ? { linkPath: input.linkPath } : {}),
        });
        return 1;
      });
    }

    // Push runs alongside email where the type and the user's preference allow.
    if (
      definition.channels.includes('PUSH') &&
      (await this.wants(input.userId, input.type, 'PUSH'))
    ) {
      await this.queue.enqueue<PushJobPayload>(SEND_PUSH_JOB, {
        userId: input.userId,
        title: input.title,
        body: input.body,
        ...(input.linkPath ? { linkPath: input.linkPath } : {}),
        ...(input.push?.categoryId ? { categoryId: input.push.categoryId } : {}),
        ...(input.push?.data ? { data: input.push.data } : {}),
      });
    }

    if (!definition.channels.includes('EMAIL')) return;
    if (!(await this.wants(input.userId, input.type, 'EMAIL'))) return;

    const user = await this.prisma.client.user.findUnique({
      where: { id: input.userId },
      select: { email: true, profile: { select: { firstName: true, lastName: true } } },
    });
    if (!user) return;

    const rendered = await this.renderEmail(input, {
      name: user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.email,
      email: user.email,
    });

    await this.queue.enqueue<SendJobPayload>(SEND_NOTIFICATION_JOB, {
      notificationId: notification.id,
      companyId: input.companyId,
      type: input.type,
      userId: input.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      email: user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  }

  /**
   * Role-routed event (v2.18): no natural single recipient - the audience is
   * whatever the company's rule says, with sensible role defaults until an
   * admin configures it. Used by hooks like user-created, asset-returned,
   * transfers, missing assets and the digest.
   */
  async notifyRoles(
    companyId: string,
    input: Omit<NotifyInput, 'userId' | 'companyId' | 'expand'>,
    options: { escalate?: boolean; excludeUserIds?: string[] } = {},
  ): Promise<void> {
    const definition = NOTIFICATION_CATALOGUE[input.type];
    const rule = await this.getRule(companyId, input.type);
    if (rule && !rule.enabled && !definition.mandatory) return;

    const roleKeys = [
      ...(rule?.recipientRoleKeys?.length
        ? rule.recipientRoleKeys
        : (DEFAULT_RULE_ROLES[input.type] ?? [])),
      ...(rule?.ccRoleKeys ?? []),
      ...(options.escalate ? (rule?.escalationRoleKeys ?? []) : []),
    ];
    if (roleKeys.length === 0) return;

    const holders = await this.prisma.client.userRole.findMany({
      where: {
        role: { companyId, key: { in: roleKeys } },
        user: { deletedAt: null, status: 'ACTIVE' },
      },
      select: { userId: true },
      distinct: ['userId'],
      take: 100,
    });
    const excluded = new Set(options.excludeUserIds ?? []);
    await this.notifyMany(
      holders.map((h) => h.userId).filter((uid) => !excluded.has(uid)),
      { ...input, companyId },
    );
  }

  /** Admin writes call these so their next read is fresh, not 30s stale. */
  bustRuleCache(companyId: string, type: NotificationType): void {
    void this.cache.del(`notify-rule:${companyId}:${type}`);
  }

  bustTemplateCache(companyId: string, type: NotificationType): void {
    void this.cache.del(`notify-tpl:${companyId}:${type}`);
  }

  /** Routing rule with a short cache; null when the company keeps defaults. */
  private async getRule(companyId: string, type: NotificationType) {
    return this.cache.wrap(`notify-rule:${companyId}:${type}`, 30, () =>
      this.prisma.client.notificationRule.findUnique({
        where: { companyId_type: { companyId, type } },
      }),
    );
  }

  /**
   * Branded, templated email: company override -> code default -> the event's
   * own title/body. Variables interpolate into subject, heading and body.
   */
  async renderEmail(
    input: Pick<
      NotifyInput,
      'companyId' | 'type' | 'title' | 'body' | 'linkPath' | 'vars' | 'emailRows'
    >,
    recipient: { name: string; email: string },
  ): Promise<{ subject: string; text: string; html: string }> {
    const override = await this.cache.wrap(`notify-tpl:${input.companyId}:${input.type}`, 30, () =>
      this.prisma.client.emailTemplate.findUnique({
        where: { companyId_type: { companyId: input.companyId, type: input.type } },
      }),
    );
    const fallback = DEFAULT_EMAIL_TEMPLATES[input.type];
    const template =
      override && override.enabled
        ? {
            subject: override.subject,
            heading: override.heading ?? override.subject,
            body: override.body,
            ctaLabel: override.ctaLabel ?? undefined,
          }
        : fallback
          ? {
              subject: fallback.subject,
              heading: fallback.heading,
              body: fallback.body,
              ctaLabel: fallback.ctaLabel,
            }
          : { subject: input.title, heading: input.title, body: input.body, ctaLabel: undefined };

    const company = await this.cache.wrap(`company-name:${input.companyId}`, 300, async () => {
      const row = await this.prisma.client.company.findUnique({
        where: { id: input.companyId },
        select: { name: true },
      });
      return row?.name ?? 'PioAssets';
    });
    const now = new Date();
    const vars: Record<string, string> = {
      'user.name': recipient.name,
      'user.email': recipient.email,
      'company.name': company,
      'system.name': 'PioAssets',
      'system.url': this.config.get('WEB_URL'),
      'notification.date': now.toISOString().slice(0, 10),
      'notification.time': now.toISOString().slice(11, 16),
      ...(input.vars ?? {}),
    };

    const subject = interpolate(template.subject, vars);
    const paragraphs = interpolate(template.body, vars)
      .split(/\n\n+/)
      .filter((par) => par.trim().length > 0);
    const url = input.linkPath
      ? `${this.config.get('WEB_URL')}${input.linkPath}`
      : this.config.get('WEB_URL');
    const html = renderBrandedEmail({
      heading: interpolate(template.heading, vars),
      paragraphs,
      rows: input.emailRows,
      cta: { label: template.ctaLabel ?? 'Open PioAssets', url },
      companyName: company,
      productUrl: this.config.get('WEB_URL'),
      logo: { cid: BRAND_LOGO_CID, width: BRAND_LOGO_WIDTH, height: BRAND_LOGO_HEIGHT },
    });
    const rowsText = (input.emailRows ?? []).map(([k, v]) => `${k}: ${v}`).join('\n');
    const text = [paragraphs.join('\n\n'), rowsText, url].filter(Boolean).join('\n\n');
    return { subject, text, html };
  }

  private async logEmail(payload: SendJobPayload, status: string, error: string | null) {
    try {
      await this.prisma.client.emailLog.create({
        data: {
          companyId: payload.companyId,
          type: payload.type,
          toEmail: payload.email,
          toUserId: payload.userId,
          subject: payload.subject,
          status,
          error,
          entityType: payload.entityType ?? null,
          entityId: payload.entityId ?? null,
        },
      });
    } catch (logError) {
      this.logger.error(`Email log write failed: ${(logError as Error).message}`);
    }
  }

  /**
   * v2.19 - transactional account email: rendered through the same template
   * system and logged, but with NO in-app row and NO preference gate - an
   * invitation or a password reset is not something to opt out of. Rules can
   * still disable non-mandatory types company-wide.
   */
  async sendTransactional(input: {
    companyId: string;
    type: NotificationType;
    toEmail: string;
    toUserId?: string;
    recipientName: string;
    title: string;
    body: string;
    linkPath?: string;
    vars?: Record<string, string>;
    emailRows?: [string, string][];
    entityType?: string;
    entityId?: string;
  }): Promise<void> {
    const definition = NOTIFICATION_CATALOGUE[input.type];
    const rule = await this.getRule(input.companyId, input.type);
    if (rule && !rule.enabled && !definition.mandatory) return;

    const rendered = await this.renderEmail(
      {
        companyId: input.companyId,
        type: input.type,
        title: input.title,
        body: input.body,
        linkPath: input.linkPath,
        vars: input.vars,
        emailRows: input.emailRows,
      },
      { name: input.recipientName, email: input.toEmail },
    );

    await this.queue.enqueue<SendJobPayload>(SEND_NOTIFICATION_JOB, {
      companyId: input.companyId,
      type: input.type,
      userId: input.toUserId ?? '',
      entityType: input.entityType,
      entityId: input.entityId,
      email: input.toEmail,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  }

  /** Fan-out helper; one row per recipient so read state is per-user. */
  async notifyMany(userIds: readonly string[], input: Omit<NotifyInput, 'userId'>): Promise<void> {
    // Deduplicated: an approver who is also the requester should not be told twice.
    for (const userId of new Set(userIds)) {
      await this.notify({ ...input, userId });
    }
  }

  /**
   * A mandatory type always returns true regardless of stored preference, so a
   * row written before a type became mandatory cannot suppress it.
   */
  private async wants(
    userId: string,
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<boolean> {
    if (isMandatory(type)) return true;

    const preference = await this.prisma.client.notificationPreference.findUnique({
      where: { userId_type_channel: { userId, type, channel } },
    });
    // Absent preference means opted in; users should not have to enable each
    // notification individually to be told anything.
    return preference?.enabled ?? true;
  }

  async list(actor: AuthUser, query: PageQuery, unreadOnly: boolean) {
    const where = { userId: actor.id, ...(unreadOnly ? { readAt: null } : {}) };

    return paginate(query, {
      count: () => this.prisma.client.notification.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.notification.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            linkPath: true,
            entityType: true,
            entityId: true,
            readAt: true,
            deliveredAt: true,
            simulated: true,
            createdAt: true,
          },
        }),
    });
  }

  unreadCount(actor: AuthUser): Promise<number> {
    return this.prisma.client.notification.count({
      where: { userId: actor.id, readAt: null },
    });
  }

  async markRead(actor: AuthUser, id: string): Promise<void> {
    // Scoped to the actor: marking someone else's notification read would be a
    // small but real cross-user write.
    const result = await this.prisma.client.notification.updateMany({
      where: { id, userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      const exists = await this.prisma.client.notification.findFirst({
        where: { id, userId: actor.id },
        select: { id: true },
      });
      if (!exists) throw AppError.notFound('Notification', id);
    }
  }

  async markAllRead(actor: AuthUser): Promise<{ updated: number }> {
    const result = await this.prisma.client.notification.updateMany({
      where: { userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async preferences(actor: AuthUser) {
    const stored = await this.prisma.client.notificationPreference.findMany({
      where: { userId: actor.id },
    });
    const byKey = new Map(stored.map((p) => [`${p.type}:${p.channel}`, p.enabled]));

    return Object.values(NOTIFICATION_CATALOGUE).map((definition) => ({
      type: definition.type,
      title: definition.title,
      mandatory: definition.mandatory,
      channels: definition.channels.map((channel) => ({
        channel,
        enabled: definition.mandatory || (byKey.get(`${definition.type}:${channel}`) ?? true),
        // The UI disables the control rather than hiding it, so users can see
        // what they are always told and why.
        locked: definition.mandatory,
      })),
    }));
  }

  async setPreference(
    actor: AuthUser,
    type: NotificationType,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<void> {
    if (isMandatory(type) && !enabled) {
      throw new AppError(
        'FORBIDDEN',
        `${NOTIFICATION_CATALOGUE[type].title} cannot be turned off`,
        {
          detail:
            'Security and workflow notifications are mandatory (spec section 19) and cannot be disabled.',
        },
      );
    }

    await this.prisma.client.notificationPreference.upsert({
      where: { userId_type_channel: { userId: actor.id, type, channel } },
      update: { enabled },
      create: { userId: actor.id, type, channel, enabled },
    });
  }
}
