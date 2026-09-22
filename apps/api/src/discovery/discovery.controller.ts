import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  agentEnrolSchema,
  agentReportSchema,
  confirmMatchSchema,
  discoveryListQuerySchema,
  enrolmentTokenReplaceSchema,
  ingestSchema,
  type EnrolmentTokenReplaceInput,
  type AuthUser,
  type ConfirmMatchInput,
  type DiscoveryListQuery,
  type IngestInput,
  type AgentEnrolInput,
  type AgentReportInput,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { CurrentUser, Public, RequirePermissions } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { DiscoveryService } from './discovery.service.js';
import { AgentGuard, type AgentPrincipal } from './agent.guard.js';
import { AgentEnrolmentService } from './agent-enrolment.service.js';
import { AppError } from '../common/errors/app-error.js';
import { Throttle } from '@nestjs/throttler';

/**
 * v2.5 Discovery. Ingest accepts agent reports; run pulls from the configured
 * provider; the review endpoints resolve the queue. Discovery proposes -
 * only exact serials or humans create asset links.
 */
@ApiTags('discovery')
@Controller('discovery')
export class DiscoveryController {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly enrolment: AgentEnrolmentService,
  ) {}

  @Post('ingest')
  @RequirePermissions(PERMISSIONS.DISCOVERY_INGEST)
  @ApiOperation({ summary: 'Ingest a batch of discovered devices (agent push)' })
  ingest(@CurrentUser() actor: AuthUser, @Body(zodBody(ingestSchema)) body: IngestInput) {
    return this.discovery.ingest(actor, body);
  }

  @Post('run')
  @RequirePermissions(PERMISSIONS.DISCOVERY_INGEST)
  @ApiOperation({ summary: 'Pull devices from the configured discovery provider' })
  run(@CurrentUser() actor: AuthUser) {
    return this.discovery.runProvider(actor);
  }

  @Get('devices')
  @RequirePermissions(PERMISSIONS.DISCOVERY_READ)
  @ApiOperation({ summary: 'The discovery review queue (filter by state)' })
  list(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(discoveryListQuerySchema)) query: DiscoveryListQuery,
  ) {
    return this.discovery.list(actor, query);
  }

  @Post('devices/:id/confirm')
  @RequirePermissions(PERMISSIONS.DISCOVERY_RECONCILE)
  @ApiOperation({ summary: 'Confirm a proposed match (optionally overriding the asset)' })
  confirm(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(confirmMatchSchema)) body: ConfirmMatchInput,
  ) {
    return this.discovery.confirm(actor, id, body.assetId);
  }

  @Post('devices/:id/ignore')
  @RequirePermissions(PERMISSIONS.DISCOVERY_RECONCILE)
  @ApiOperation({ summary: 'Ignore a queue item (sticky across re-ingests)' })
  ignore(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.discovery.ignore(actor, id);
  }

  // ── agent enrolment & reporting (v2.13) ────────────────────────────────────
  // Two endpoints an installed laptop can reach, and nothing else. Neither
  // requires - or accepts - a human's credential.

  @Post('agents/enrol')
  @Public()
  @HttpCode(200)
  // Guessing an enrolment token is the only way in, so make guessing slow.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Exchange the company enrolment token for a device credential',
    description:
      'Called once per laptop by the agent installer. Re-enrolling the same machine rotates its credential rather than duplicating it; the replaced credential keeps working until the new one is used. Accepts the current enrolment token or an unexpired grace token.',
  })
  enrolAgent(
    @Headers('x-enrolment-token') enrolmentToken: string | undefined,
    @Body(zodBody(agentEnrolSchema)) body: AgentEnrolInput,
  ) {
    if (!enrolmentToken) {
      throw new AppError('UNAUTHENTICATED', 'Missing enrolment token');
    }
    return this.enrolment.enrolAgent(enrolmentToken.trim(), body);
  }

  @Post('agents/report')
  @Public()
  @UseGuards(AgentGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Report this machine inventory',
    description:
      'The device identity comes from the credential, never the body: an agent can only ever describe itself.',
  })
  report(
    @Req() req: { agent?: AgentPrincipal },
    @Body(zodBody(agentReportSchema)) body: AgentReportInput,
  ) {
    return this.discovery.reportFromAgent(req.agent!, body);
  }

  // ── agent administration (humans) ─────────────────────────────────────────

  @Get('agents/enrolment-token')
  @RequirePermissions(PERMISSIONS.DISCOVERY_INGEST)
  @ApiOperation({
    summary: 'Whether an enrolment token exists, and whether it can be shown (no secret)',
  })
  enrolmentTokenStatus(@CurrentUser() actor: AuthUser) {
    return this.enrolment.getStatus(actor);
  }

  @Post('agents/enrolment-token')
  @RequirePermissions(PERMISSIONS.DISCOVERY_INGEST)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Create the enrolment token (only if none exists)',
    description: '409 when a token already exists - use reveal, or replace.',
  })
  createEnrolmentToken(@CurrentUser() actor: AuthUser) {
    return this.enrolment.create(actor);
  }

  @Post('agents/enrolment-token/reveal')
  @RequirePermissions(PERMISSIONS.DISCOVERY_INGEST)
  @HttpCode(200)
  @ApiOperation({ summary: 'Show the enrolment token and install command (audited)' })
  revealEnrolmentToken(@CurrentUser() actor: AuthUser) {
    return this.enrolment.reveal(actor);
  }

  @Post('agents/enrolment-token/replace')
  @RequirePermissions(PERMISSIONS.DISCOVERY_INGEST)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Replace the enrolment token',
    description:
      'The previous token keeps enrolling new laptops for graceDays (0-30, default 7; 0 retires it now). Enrolled laptops are unaffected.',
  })
  replaceEnrolmentToken(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(enrolmentTokenReplaceSchema)) body: EnrolmentTokenReplaceInput,
  ) {
    return this.enrolment.replace(actor, body.graceDays);
  }

  @Delete('agents/enrolment-token')
  @RequirePermissions(PERMISSIONS.DISCOVERY_INGEST)
  @HttpCode(204)
  @ApiOperation({ summary: 'Disable agent enrolment (revokes current and grace tokens)' })
  async revokeEnrolmentToken(@CurrentUser() actor: AuthUser): Promise<void> {
    await this.enrolment.revoke(actor);
  }

  @Get('agents/not-enrolled')
  @RequirePermissions(PERMISSIONS.DISCOVERY_READ)
  @ApiOperation({
    summary: 'Register laptops, desktops and servers no live agent has reported',
    description:
      'The rollout to-do list, matched by serial number. A machine with no serial on record is listed with that reason.',
  })
  listNotEnrolled(@CurrentUser() actor: AuthUser) {
    return this.enrolment.listNotEnrolled(actor);
  }

  @Get('agents')
  @RequirePermissions(PERMISSIONS.DISCOVERY_READ)
  @ApiOperation({ summary: 'Enrolled laptops: status, last report, last rejection, agent version' })
  listAgents(@CurrentUser() actor: AuthUser) {
    return this.enrolment.listAgents(actor);
  }

  @Delete('agents/:id')
  @RequirePermissions(PERMISSIONS.DISCOVERY_RECONCILE)
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke one laptop agent credential' })
  async revokeAgent(@CurrentUser() actor: AuthUser, @Param('id') id: string): Promise<void> {
    await this.enrolment.revokeAgent(actor, id);
  }
}
