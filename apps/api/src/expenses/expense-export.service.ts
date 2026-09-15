import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import {
  expenseExportQuerySchema,
  type AuthUser,
  type ExpenseExportFormat,
  type ExpenseExportLinkDto,
  type ExpenseExportQuery,
  type ExpenseQuery,
} from '@techpioasset/contracts';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { signDownloadLink, verifyDownloadLink } from '../common/signed-download-link.js';
import { AppConfig } from '../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildExpensePdf } from './expense-pdf.js';
import { canonicalQuery, exportFilename } from './expense-render.js';
import { buildExpenseWorkbook } from './expense-workbook.js';
import { ExpensesService } from './expenses.service.js';

export const EXPENSE_CONTENT_TYPE: Record<ExpenseExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

export interface ExpenseFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/**
 * Expense report files and the phone's two-minute links to them (v2.59).
 *
 * Every file that leaves is audited as REPORT_EXPORTED - the action every
 * other export already uses, so no enum migration - with entityId
 * EXPENSE_REPORT, the format, the period and how it was delivered.
 */
@Injectable()
export class ExpenseExportService {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  /** Signed-in download (web). */
  async export(actor: AuthUser, query: ExpenseExportQuery): Promise<ExpenseFile> {
    this.expenses.assertSuperAdmin(actor);
    return this.render(actor.companyId, actor.id, query, 'DOWNLOAD');
  }

  /** Access is decided HERE, when the link is made; the link then names only this report. */
  async createLink(actor: AuthUser, query: ExpenseExportQuery): Promise<ExpenseExportLinkDto> {
    this.expenses.assertSuperAdmin(actor);
    // Resolve now so a bad period or a foreign office fails at the button,
    // not two minutes later in a browser tab with no way to show the error.
    const data = await this.expenses.summary(actor, query);
    const claims = JSON.stringify({ u: actor.id, f: query.format, q: canonicalQuery(query) });
    const { token, expiresAt } = signDownloadLink(this.secret(), 'expense-report-link', {
      fileId: claims,
      companyId: actor.companyId,
    });
    return {
      path: `/expenses/export-links/${token}`,
      expiresAt,
      filename: exportFilename(data.period.fromDate, data.period.toDate, query.format),
    };
  }

  /** The file behind a signed link. Company and user come only from the signature. */
  async readByLink(token: string): Promise<ExpenseFile> {
    const claims = verifyDownloadLink(
      this.secret(),
      'expense-report-link',
      token,
      'Expense report',
    );
    let parsed: { u?: unknown; f?: unknown; q?: unknown };
    try {
      parsed = JSON.parse(claims.fileId);
    } catch {
      throw AppError.notFound('Expense report', 'link');
    }
    const query = expenseExportQuerySchema.safeParse({ ...(parsed.q as object), format: parsed.f });
    if (typeof parsed.u !== 'string' || !query.success)
      throw AppError.notFound('Expense report', 'link');
    const userId = parsed.u;

    const run = async () => {
      // The link outlives nothing: a Super Admin demoted or deactivated since
      // minting it cannot still download with it.
      if (!(await this.expenses.isActiveSuperAdmin(claims.companyId, userId))) {
        throw AppError.forbidden('Only a Super Admin can view or download the expense report');
      }
      return this.render(claims.companyId, userId, query.data, 'SIGNED_LINK');
    };
    // A public route has no tenant in its request context, so the RLS
    // interceptor leaves it alone. Scope it here to the company in the claims.
    return this.config.get('RLS_ENFORCE') ? this.prisma.runInTenant(claims.companyId, run) : run();
  }

  private async render(
    companyId: string,
    userId: string,
    query: ExpenseExportQuery,
    delivery: 'DOWNLOAD' | 'SIGNED_LINK',
  ): Promise<ExpenseFile> {
    const base: ExpenseQuery = canonicalQuery(query);
    const data = await this.expenses.reportData(companyId, userId, base);
    const buffer =
      query.format === 'pdf'
        ? (await buildExpensePdf(data)).buffer
        : await buildExpenseWorkbook(data);

    await this.audit.record({
      companyId,
      actorId: userId,
      action: AuditAction.REPORT_EXPORTED,
      entityType: 'Report',
      entityId: 'EXPENSE_REPORT',
      newValues: {
        format: query.format.toUpperCase(),
        rows: data.lines.length,
        delivery,
        period: {
          preset: data.summary.period.preset,
          from: data.summary.period.fromDate,
          to: data.summary.period.toDate,
        },
        filters: { officeId: query.officeId ?? null, categoryId: query.categoryId ?? null },
      },
    });

    return {
      buffer,
      filename: exportFilename(
        data.summary.period.fromDate,
        data.summary.period.toDate,
        query.format,
      ),
      contentType: EXPENSE_CONTENT_TYPE[query.format],
    };
  }

  private secret(): string {
    return this.config.get('JWT_ACCESS_SECRET') as string;
  }
}
