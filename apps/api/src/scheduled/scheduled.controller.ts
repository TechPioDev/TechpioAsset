import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { createScheduledReportSchema, type AuthUser } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { AppError } from '../common/errors/app-error.js';
import { tenantFilter } from '../common/scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlertSweepService } from './alert-sweep.service.js';
import { LenovoWarrantyService } from '../assets/lenovo-warranty.service.js';
import { ReportRunnerService } from './report-runner.service.js';
import { nextCronRun } from './cron.js';

const toggleScheduleSchema = z.object({ isActive: z.boolean() });

@ApiTags('Scheduled')
@Controller('scheduled')
export class ScheduledController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: AlertSweepService,
    private readonly runner: ReportRunnerService,
    private readonly lenovoWarranty: LenovoWarrantyService,
  ) {}

  @Get('reports')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @ApiOperation({ summary: 'List scheduled reports' })
  async listReports(@CurrentUser() actor: AuthUser) {
    const rows = await this.prisma.client.scheduledReport.findMany({
      where: { ...tenantFilter(actor), deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        resource: true,
        format: true,
        cron: true,
        recipients: true,
        isActive: true,
        lastRunAt: true,
        lastRunStatus: true,
        nextRunAt: true,
        company: { select: { timezone: true } },
      },
    });
    // The zone the cron is read in, so a list can say what "08:00" means.
    // Reading it from /company needs settings access most report users lack.
    return rows.map(({ company, ...row }) => ({ ...row, timezone: company.timezone }));
  }

  @Patch('reports/:id')
  @RequirePermissions(PERMISSIONS.REPORTS_EXPORT)
  @ApiOperation({ summary: 'Pause or resume a schedule' })
  async toggleReport(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(toggleScheduleSchema)) body: { isActive: boolean },
  ) {
    const schedule = await this.prisma.client.scheduledReport.findFirst({
      where: { id, ...tenantFilter(actor), deletedAt: null },
      select: { id: true, cron: true, company: { select: { timezone: true } } },
    });
    if (!schedule) throw AppError.notFound('Scheduled report', id);
    return this.prisma.client.scheduledReport.update({
      where: { id },
      data: {
        isActive: body.isActive,
        // Re-arming computes a fresh due date; a paused backlog must not fire.
        ...(body.isActive
          ? { nextRunAt: nextCronRun(schedule.cron, new Date(), schedule.company.timezone) }
          : {}),
      },
      select: { id: true, isActive: true, nextRunAt: true },
    });
  }

  @Post('reports/run')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run due scheduled reports now',
    description: 'Super Admin trigger for the runner that also ticks every 5 minutes.',
  })
  runReports() {
    return this.runner.runDueReports();
  }

  @Post('reports')
  @RequirePermissions(PERMISSIONS.REPORTS_EXPORT)
  @ApiOperation({
    summary: 'Schedule a recurring report',
    description: 'Delivered by email on the cron schedule when scheduled jobs are enabled.',
  })
  async createReport(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createScheduledReportSchema))
    body: { name: string; type: string; format: string; cron: string; recipients: string[] },
  ) {
    // Read in the company's zone: "every day at 09:00" means 09:00 where they are.
    const { timezone } = await this.prisma.client.company.findUniqueOrThrow({
      where: { id: actor.companyId },
      select: { timezone: true },
    });
    const nextRunAt = nextCronRun(body.cron, new Date(), timezone);
    return this.prisma.client.scheduledReport.create({
      data: {
        companyId: actor.companyId,
        ownerId: actor.id,
        name: body.name,
        resource: body.type,
        format: body.format,
        cron: body.cron,
        recipients: body.recipients,
        nextRunAt,
      },
      select: { id: true, name: true, cron: true, nextRunAt: true },
    });
  }

  @Delete('reports/:id')
  @RequirePermissions(PERMISSIONS.REPORTS_EXPORT)
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a scheduled report' })
  async deleteReport(@CurrentUser() actor: AuthUser, @Param('id') id: string): Promise<void> {
    const result = await this.prisma.client.scheduledReport.updateMany({
      where: { id, ...tenantFilter(actor) },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (result.count === 0) throw AppError.notFound('Scheduled report', id);
  }

  @Post('alerts/run')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run the warranty, maintenance and expiry alert sweeps now',
    description: 'Super Admin trigger for the sweeps that also run on a daily timer.',
  })
  async runAlerts() {
    const [warranty, maintenance, escalations, expiry] = await Promise.all([
      this.sweep.runWarrantySweep(),
      this.sweep.runMaintenanceSweep(),
      this.sweep.runApprovalEscalationSweep(),
      this.sweep.runExpirySweep(),
    ]);
    return {
      warrantyAlerts: warranty,
      maintenanceAlerts: maintenance,
      approvalEscalations: escalations,
      // v2.9 C4: lots going off, split from lots already gone.
      expiryAlerts: expiry,
    };
  }

  @Post('warranty-refresh/run')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Refresh warranty dates from Lenovo for the whole fleet now',
    description:
      'Runs the zero-touch Lenovo warranty sweep that also runs nightly. ' +
      'Returns how many devices were checked, updated and failed.',
  })
  runWarrantyRefresh() {
    return this.lenovoWarranty.sweep();
  }
}
