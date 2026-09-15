import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import type { ReportType } from '@techpioasset/contracts';
import { AppConfig } from '../config/config.module.js';
import { AuthService } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MailProvider } from '../providers/mail/mail.provider.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { toCsv, toSpreadsheetMl } from '../reports/report-format.js';
import { nextCronRun } from './cron.js';

export interface RunnerSummary {
  due: number;
  succeeded: number;
  failed: number;
}

/**
 * v2.6 A2 — the scheduled-report runner (closing the v1 gap: schedules and the
 * cron engine existed, but nothing ever executed a due report).
 *
 * Rules (plan invariant 2):
 * - A due schedule is CLAIMED by advancing nextRunAt in a guarded update
 *   before any work happens — one run per due tick, crash-safe, idempotent.
 * - The report is built AS ITS OWNER (buildAuthUser), so cost gating stays
 *   honest: an owner who lost cost visibility gets a recorded FAILURE, not a
 *   report they may no longer see.
 * - The outcome is always recorded (lastRunStatus) and the owner notified on
 *   failure — a report that silently stops arriving is a lie by omission.
 */
@Injectable()
export class ReportRunnerService implements OnModuleInit {
  private readonly logger = new Logger(ReportRunnerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly mail: MailProvider,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('ENABLE_SCHEDULED_JOBS')) return;
    // Reports are cron-timed to the minute-ish; a 5-minute tick is honest
    // enough and cheap. The daily sweeps stay on their own timer.
    this.timer = setInterval(() => void this.runDueReports(), 5 * 60 * 1000);
    this.timer.unref?.();
  }

  async runDueReports(now: Date = new Date()): Promise<RunnerSummary> {
    const due = await this.prisma.client.scheduledReport.findMany({
      where: { isActive: true, deletedAt: null, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
      include: { company: { select: { timezone: true } } },
    });

    const summary: RunnerSummary = { due: due.length, succeeded: 0, failed: 0 };
    for (const schedule of due) {
      // Claim: advance nextRunAt only if nobody else has. Zero rows means a
      // concurrent tick took it — skip without double-running.
      const nextRunAt = this.safeNextRun(schedule.cron, now, schedule.company.timezone);
      const claimed = await this.prisma.client.scheduledReport.updateMany({
        where: { id: schedule.id, nextRunAt: schedule.nextRunAt },
        data: { nextRunAt },
      });
      if (claimed.count === 0) continue;

      try {
        await this.execute(schedule);
        await this.prisma.client.scheduledReport.update({
          where: { id: schedule.id },
          data: { lastRunAt: now, lastRunStatus: 'SUCCESS' },
        });
        await this.notifyOwner(schedule, 'REPORT_DELIVERED', `"${schedule.name}" was generated and emailed to ${schedule.recipients.length} recipient(s).`);
        summary.succeeded += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(`Scheduled report ${schedule.id} ("${schedule.name}") failed: ${reason}`);
        await this.prisma.client.scheduledReport.update({
          where: { id: schedule.id },
          data: { lastRunAt: now, lastRunStatus: `FAILURE: ${reason}`.slice(0, 500) },
        });
        await this.notifyOwner(schedule, 'REPORT_FAILED', `"${schedule.name}" could not be generated: ${reason}`);
        summary.failed += 1;
      }
    }

    if (summary.due > 0) {
      this.logger.log(
        `Report runner: ${summary.succeeded} delivered, ${summary.failed} failed of ${summary.due} due`,
      );
    }
    return summary;
  }

  private async execute(schedule: {
    id: string;
    ownerId: string;
    name: string;
    resource: string;
    filterJson: unknown;
    format: string;
    recipients: string[];
  }): Promise<void> {
    // Built as the owner - permission truth at run time, not schedule time.
    const owner = await this.auth.buildAuthUser(schedule.ownerId);
    const filters = (schedule.filterJson ?? {}) as { officeId?: string; departmentId?: string };
    const table = await this.reports.build(owner, schedule.resource as ReportType, filters);

    const excel = schedule.format === 'EXCEL';
    const content = excel ? toSpreadsheetMl(table) : toCsv(table);
    const stamp = new Date().toISOString().slice(0, 10);
    const attachment = {
      filename: `${schedule.name.replace(/[^a-z0-9-]+/gi, '_')}-${stamp}.${excel ? 'xls' : 'csv'}`,
      content,
      contentType: excel ? 'application/vnd.ms-excel' : 'text/csv; charset=utf-8',
    };

    // v2.7 R2 (AUD-009): a scheduled send is data leaving the system too -
    // recorded against the owner, who is who it was generated as.
    await this.audit.record({
      companyId: owner.companyId,
      actorId: owner.id,
      action: AuditAction.REPORT_EXPORTED,
      entityType: 'Report',
      entityId: schedule.resource,
      newValues: {
        format: schedule.format,
        rows: table.rows.length,
        delivery: 'SCHEDULED',
        scheduleId: schedule.id,
        recipients: schedule.recipients.length,
      },
    });

    for (const recipient of schedule.recipients) {
      await this.mail.send({
        to: recipient,
        subject: `Scheduled report: ${schedule.name} (${stamp})`,
        text:
          `Your scheduled report "${schedule.name}" is attached.\n\n` +
          `${table.rows.length} row(s) as of ${new Date().toUTCString()}.\n`,
        attachments: [attachment],
      });
    }
  }

  private async notifyOwner(
    schedule: { companyId: string; ownerId: string; id: string },
    type: 'REPORT_DELIVERED' | 'REPORT_FAILED',
    body: string,
  ): Promise<void> {
    try {
      await this.notifications.notify({
        companyId: schedule.companyId,
        userId: schedule.ownerId,
        type,
        title: type === 'REPORT_FAILED' ? 'Scheduled report failed' : 'Scheduled report delivered',
        body,
        linkPath: '/settings/schedules',
        entityType: 'ScheduledReport',
        entityId: schedule.id,
      });
    } catch (error) {
      // The run outcome is already recorded; a notification hiccup must not
      // flip a delivered report into a failure.
      this.logger.warn(`Could not notify owner of ${schedule.id}: ${String(error)}`);
    }
  }

  /** A broken cron must not wedge the schedule forever: park it a day out. */
  private safeNextRun(cron: string, now: Date, timeZone: string): Date {
    try {
      return nextCronRun(cron, now, timeZone) ?? new Date(now.getTime() + 86_400_000);
    } catch {
      return new Date(now.getTime() + 86_400_000);
    }
  }
}
