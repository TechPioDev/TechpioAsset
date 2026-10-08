import { createHash, randomBytes } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createWebhookSchema,
  saveM365ConnectionSchema,
  setTeamAlertsSchema,
  updateWebhookSchema,
  WEBHOOK_EVENTS,
  type AuthUser,
  type CreateWebhookInput,
  type SaveM365ConnectionInput,
  type SetTeamAlertsInput,
  type UpdateWebhookInput,
} from '@techpioasset/contracts';
import { AuditAction } from '@prisma/client';
import { PERMISSIONS } from '@techpioasset/domain';
import { AppConfig } from '../config/config.module.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { AppError } from '../common/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChatProvider } from '../providers/chat/chat.provider.js';
import { MailProvider } from '../providers/mail/mail.provider.js';
import { WebhooksService } from './webhooks.service.js';
import { M365LicenseSyncService } from './m365-license-sync.service.js';

/**
 * v2.6 A3 — the integrations hub. Everything here needs integrations:manage
 * (Super Admin via ALL). Secrets and tokens are shown exactly once.
 */
@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly chat: ChatProvider,
    private readonly mail: MailProvider,
    private readonly m365: M365LicenseSyncService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Hub overview: SSO status, SCIM token, webhook health' })
  async hub(@CurrentUser() actor: AuthUser) {
    const [scimToken, deadCount] = await Promise.all([
      this.prisma.client.scimToken.findUnique({
        where: { companyId: actor.companyId },
        select: { createdAt: true, lastUsedAt: true },
      }),
      this.prisma.client.webhookDelivery.count({
        where: { companyId: actor.companyId, status: 'DEAD' },
      }),
    ]);
    const ssoEnabled = Boolean(
      this.config.get('ENTRA_TENANT_ID') && this.config.get('ENTRA_CLIENT_ID'),
    );
    const company = await this.prisma.client.company.findUnique({
      where: { id: actor.companyId },
      select: { teamAlertWebhookUrl: true },
    });
    return {
      sso: { provider: ssoEnabled ? 'entra' : 'disabled', enabled: ssoEnabled },
      scim: {
        enabled: scimToken !== null,
        createdAt: scimToken?.createdAt ?? null,
        lastUsedAt: scimToken?.lastUsedAt ?? null,
      },
      webhooks: { events: WEBHOOK_EVENTS, deadDeliveries: deadCount },
      teamAlerts: { webhookUrl: company?.teamAlertWebhookUrl ?? null },
      mail: { provider: this.config.get('MAIL_PROVIDER'), from: this.config.get('MAIL_FROM') },
    };
  }

  // ── Microsoft 365 licences (v3.12) ────────────────────────────────────────
  // One connection per company. The client secret goes in and never comes
  // back out: reads say only that one is stored.

  @Get('m365-licences')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Microsoft 365 licence sync: connection and last result' })
  m365Status(@CurrentUser() actor: AuthUser) {
    return this.m365.status(actor.companyId);
  }

  @Put('m365-licences')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Connect or update the Microsoft 365 tenant' })
  m365Save(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(saveM365ConnectionSchema)) body: SaveM365ConnectionInput,
  ) {
    return this.m365.save(actor, body);
  }

  @Delete('m365-licences')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Stop syncing (licences already recorded are kept)' })
  m365Disconnect(@CurrentUser() actor: AuthUser) {
    return this.m365.disconnect(actor);
  }

  @Post('m365-licences/test')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Read from Microsoft and show what a sync would record' })
  m365Test(@CurrentUser() actor: AuthUser) {
    return this.m365.test(actor);
  }

  @Post('m365-licences/sync')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Sync Microsoft 365 subscriptions into Licences now' })
  m365Sync(@CurrentUser() actor: AuthUser) {
    return this.m365.syncNow(actor);
  }

  // ── team alerts (v2.12) ───────────────────────────────────────────────────
  // One Teams/Slack incoming-webhook per company; the notification service
  // posts high-signal operational events to it.

  @Patch('team-alerts')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Set or clear the Teams/Slack alert webhook' })
  async setTeamAlerts(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(setTeamAlertsSchema)) body: SetTeamAlertsInput,
  ) {
    await this.prisma.client.company.update({
      where: { id: actor.companyId },
      data: { teamAlertWebhookUrl: body.webhookUrl },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'Company',
      entityId: actor.companyId,
      // The URL itself is a channel credential - audit THAT it changed, not it.
      newValues: { teamAlerts: body.webhookUrl ? 'configured' : 'cleared' },
    });
    return { webhookUrl: body.webhookUrl };
  }

  @Post('team-alerts/test')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Post a test message to the configured alert webhook' })
  async testTeamAlerts(@CurrentUser() actor: AuthUser) {
    const company = await this.prisma.client.company.findUnique({
      where: { id: actor.companyId },
      select: { teamAlertWebhookUrl: true },
    });
    if (!company?.teamAlertWebhookUrl) {
      throw new AppError('VALIDATION_FAILED', 'No alert webhook is configured yet');
    }
    const result = await this.chat.post(company.teamAlertWebhookUrl, {
      title: 'TechpioAsset test alert',
      text: 'Team alerts are working. High-signal events (overdue approvals, low stock, security alerts) will arrive here.',
    });
    return result;
  }

  @Post('mail/test')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({
    summary: 'Send a test email to yourself',
    description:
      'Reports which mail provider handled it - "mock" means email is simulated and nothing was actually delivered.',
  })
  async testMail(@CurrentUser() actor: AuthUser) {
    const provider = this.config.get('MAIL_PROVIDER');
    await this.mail.send({
      to: actor.email,
      subject: 'TechpioAsset test email',
      text: 'Email delivery is working. Invitations and notification emails will reach inboxes.',
    });
    return { provider, delivered: provider !== 'mock', to: actor.email };
  }

  // ── webhooks ───────────────────────────────────────────────────────────────

  @Get('webhooks')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Webhook subscriptions with per-status delivery counts' })
  listWebhooks(@CurrentUser() actor: AuthUser) {
    return this.webhooks.list(actor);
  }

  @Post('webhooks')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({
    summary: 'Register a webhook',
    description: 'The signing secret is returned ONCE - store it now.',
  })
  createWebhook(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createWebhookSchema)) body: CreateWebhookInput,
  ) {
    return this.webhooks.create(actor, body);
  }

  @Patch('webhooks/:id')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Update url/events or pause a webhook' })
  updateWebhook(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateWebhookSchema)) body: UpdateWebhookInput,
  ) {
    return this.webhooks.update(actor, id, body);
  }

  @Delete('webhooks/:id')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a webhook' })
  removeWebhook(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.webhooks.remove(actor, id);
  }

  @Get('webhooks/:id/deliveries')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Recent deliveries incl. dead-letter detail' })
  deliveries(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.webhooks.deliveries(actor, id);
  }

  // ── SCIM token ─────────────────────────────────────────────────────────────

  @Post('scim/token')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({
    summary: 'Mint (or rotate) the SCIM bearer token',
    description: 'Returned ONCE; only the hash is stored. Rotating invalidates the old token.',
  })
  async mintScimToken(@CurrentUser() actor: AuthUser) {
    const token = `scim_${randomBytes(32).toString('hex')}`;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.prisma.client.scimToken.upsert({
      where: { companyId: actor.companyId },
      create: { companyId: actor.companyId, tokenHash, createdById: actor.id },
      update: { tokenHash, createdById: actor.id, createdAt: new Date(), lastUsedAt: null },
    });
    return { token, endpoint: '/api/v1/scim/v2' };
  }

  @Delete('scim/token')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the SCIM token' })
  async revokeScimToken(@CurrentUser() actor: AuthUser): Promise<void> {
    const result = await this.prisma.client.scimToken.deleteMany({
      where: { companyId: actor.companyId },
    });
    if (result.count === 0) throw AppError.notFound('SCIM token');
  }
}
