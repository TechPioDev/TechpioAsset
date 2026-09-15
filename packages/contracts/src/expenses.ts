import { z } from 'zod';
import {
  EXPENSE_PERIOD_PRESETS,
  isCalendarDate,
  type ExpenseGranularity,
  type ExpenseLevel,
  type ExpensePeriodPreset,
  type ExpenseSource,
} from '@techpioasset/domain';

/**
 * Expense report contracts (v2.59) - Super Admin only.
 *
 * Money in every response is an exact decimal STRING ("125000.00"), never a
 * number: the report adds up purchase prices and a float would drift. Format
 * for display with `formatMoneyText` from @techpioasset/domain, which groups
 * rupees the Indian way (₹12,50,000.00).
 */

const calendarDate = z
  .string()
  .trim()
  .refine(isCalendarDate, 'Use a real date in the form YYYY-MM-DD');

export const expenseQuerySchema = z
  .object({
    preset: z.enum(EXPENSE_PERIOD_PRESETS).default('LAST_30_DAYS'),
    /** CUSTOM only: first day, inclusive, in the company time zone. */
    from: calendarDate.optional(),
    /** CUSTOM only: last day, inclusive, in the company time zone. */
    to: calendarDate.optional(),
    officeId: z.string().trim().min(1).max(64).optional(),
    categoryId: z.string().trim().min(1).max(64).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.preset !== 'CUSTOM') return;
    if (!value.from)
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'Choose a start date' });
    if (!value.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Choose an end date' });
    if (value.from && value.to && value.from > value.to) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'The end date must be on or after the start date',
      });
    }
  });
export type ExpenseQuery = z.infer<typeof expenseQuerySchema>;

export const expenseExportFormatEnum = z.enum(['xlsx', 'pdf']);
export type ExpenseExportFormat = z.infer<typeof expenseExportFormatEnum>;

/** GET /expenses/export?format=pdf&preset=... */
export const expenseExportQuerySchema = z
  .object({ format: expenseExportFormatEnum })
  .and(expenseQuerySchema);
export type ExpenseExportQuery = z.infer<typeof expenseExportQuerySchema>;

/** POST /expenses/export-link body - same fields as the export query. */
export const expenseExportLinkSchema = expenseExportQuerySchema;
export type ExpenseExportLinkInput = ExpenseExportQuery;

// ---------------------------------------------------------------------------
// response
// ---------------------------------------------------------------------------

export interface ExpensePeriodDto {
  preset: ExpensePeriodPreset;
  /** First day, inclusive, company zone (YYYY-MM-DD). */
  fromDate: string;
  /** Last day, inclusive, company zone (YYYY-MM-DD). */
  toDate: string;
  /** UTC instant the period starts (inclusive). */
  from: string;
  /** UTC instant the period ends (exclusive). */
  to: string;
  days: number;
  label: string;
  rangeLabel: string;
  timezone: string;
  granularity: ExpenseGranularity;
}

export interface ExpenseSeriesPointDto {
  /** "2026-09-15" (daily) or "2026-09" (monthly). */
  key: string;
  label: string;
  total: string;
  count: number;
  level: ExpenseLevel;
  /** The day/month is only partly inside the period (e.g. the current month). */
  partial: boolean;
}

export interface ExpenseGroupDto {
  /** Null for "No office", "No vendor", "No type" and for licences (which have no category/type). */
  id: string | null;
  name: string;
  total: string;
  count: number;
  /** Share of the period total, percent, one decimal. */
  sharePct: number;
}

export interface ExpenseLineDto {
  source: ExpenseSource;
  /** Asset id, maintenance record id, licence id or licence renewal id. */
  id: string;
  /** The asset the line belongs to, when there is one (purchase or repair). */
  assetId: string | null;
  title: string;
  /** UTC instant the expense is dated by. */
  date: string;
  /** Calendar date in the company zone. */
  localDate: string;
  amount: string;
  currency: string;
  category: string | null;
  type: string | null;
  office: string | null;
  vendor: string | null;
}

export interface ExpenseBucketExtremeDto {
  key: string;
  label: string;
  total: string;
}

export interface ExpenseSummaryDto {
  period: ExpensePeriodDto;
  previousPeriod: ExpensePeriodDto;
  /** The company's base currency. Totals are in this currency only. */
  currency: string;
  filters: { officeId: string | null; categoryId: string | null };
  totals: {
    total: string;
    count: number;
    bySource: Record<ExpenseSource, { total: string; count: number }>;
    previousTotal: string;
    /** Percent change vs the previous period, one decimal; null when the previous total is zero. */
    changePct: number | null;
  };
  series: ExpenseSeriesPointDto[];
  byCategory: ExpenseGroupDto[];
  byType: ExpenseGroupDto[];
  byOffice: ExpenseGroupDto[];
  byVendor: ExpenseGroupDto[];
  /** Largest ten lines of the period, base currency. */
  topExpenses: ExpenseLineDto[];
  /**
   * Spend recorded in any other currency. Never converted and never included
   * in the totals above - there is no exchange-rate source to convert with.
   */
  otherCurrencies: Array<{ currency: string; total: string; count: number }>;
  /** What is missing, company-wide (respecting office/category filters). */
  dataGaps: {
    assetsWithoutPrice: number;
    pricedAssetsWithoutDate: number;
    maintenanceClosedWithoutCost: number;
    maintenanceClosedWithoutDate: number;
    licencesWithoutCost: number;
    /** Plain-language sentences for each non-zero gap, ready to show. */
    notes: string[];
  };
  highestBucket: ExpenseBucketExtremeDto | null;
  lowestBucket: ExpenseBucketExtremeDto | null;
  /** When the figures were read (UTC). */
  generatedAt: string;
}

export interface ExpenseExportLinkDto {
  /** API path (prefix with the API base, e.g. /api/v1) - opens without an auth header. */
  path: string;
  expiresAt: string;
  filename: string;
}
