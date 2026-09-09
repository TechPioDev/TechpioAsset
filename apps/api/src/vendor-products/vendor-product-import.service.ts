import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';
import {
  calculateLandedCost,
  formatProductCode,
  productCodeSequence,
  productCodeStem,
  stockQuantityProblem,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { tenantFilter } from '../common/scope.js';
import { cellText, parseSheet, type SheetRow } from '../common/spreadsheet.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Bulk import of a supplier's catalogue (v2.52).
 *
 * A supplier with sixty products is not going to type them into a form sixty
 * times, and the alternative is that they never get listed at all.
 *
 * TWO PASSES, ALWAYS. Every upload is validated in full and reported on before
 * anything is written; committing runs the same validation again and then
 * writes only the rows that passed. That is what makes "95 of 100 imported,
 * here are the other five" possible - a run that stopped at the first bad row
 * would leave the supplier guessing how many more there were.
 *
 * VALID ROWS STILL IMPORT. Refusing the whole file over one bad cell means a
 * supplier fixes one line and re-uploads sixty, and does that five times. The
 * rows that failed are named with their line number and reason so they can be
 * fixed and sent again.
 */

/** Sixty is a catalogue; six hundred in one file is a mistake or an attack. */
const MAX_ROWS = 500;

export interface ImportIssue {
  /** The line in the file as the supplier sees it, header included. */
  row: number;
  name: string;
  problem: string;
}

export interface ImportReport {
  totalRows: number;
  valid: number;
  failed: number;
  imported: number;
  /** Only the rows that could not be imported, with the reason. */
  issues: ImportIssue[];
}

interface Candidate {
  row: number;
  name: string;
  data: {
    name: string;
    categoryId: string;
    brand: string | null;
    model: string | null;
    vendorSku: string | null;
    description: string | null;
    unitPrice: number;
    gstPercent: number;
    availableQuantity: number;
    minOrderQuantity: number;
    leadTimeDays: number | null;
    warrantyMonths: number | null;
    availableFrom: Date;
    availableUntil: Date;
    categoryName: string;
  };
}

@Injectable()
export class VendorProductImportService {
  private readonly logger = new Logger(VendorProductImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Numbers arrive as text, as numbers, and with currency symbols on them. */
  private number(raw: string): number | null {
    if (!raw) return null;
    const cleaned = raw.replace(/[₹$,\s]/g, '');
    if (cleaned === '') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  private date(raw: string): Date | null {
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * Read the file and decide, row by row, what can be imported.
   *
   * Nothing is written here. The same function backs the preview and the
   * commit, so what the supplier was shown is what actually happens.
   */
  private async assess(
    actor: AuthUser,
    vendorId: string,
    buffer: Buffer,
  ): Promise<{ candidates: Candidate[]; issues: ImportIssue[]; totalRows: number }> {
    const rows = await parseSheet(buffer, { headerHint: /product\s*name|^name$/i });
    if (rows.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'That file has no rows in it', {
        detail: 'The first row should name the columns: Product name, Category, Unit price…',
      });
    }
    if (rows.length > MAX_ROWS) {
      throw new AppError('VALIDATION_FAILED', `That file has more than ${MAX_ROWS} rows`, {
        detail: 'Split it into smaller files and upload them one at a time.',
      });
    }

    const categories = await this.prisma.client.category.findMany({
      where: { ...tenantFilter(actor), deletedAt: null },
      select: { id: true, name: true, key: true },
    });
    const categoryByName = new Map<string, { id: string; name: string }>();
    for (const c of categories) {
      categoryByName.set(c.name.trim().toLowerCase(), c);
      categoryByName.set(c.key.trim().toLowerCase(), c);
    }

    // Every SKU this supplier already uses, so a clash is named rather than
    // discovered by a unique-constraint error halfway through the file.
    const existing = await this.prisma.client.vendorProduct.findMany({
      where: { companyId: actor.companyId, vendorId, vendorSku: { not: null }, deletedAt: null },
      select: { vendorSku: true },
    });
    const takenSkus = new Set(existing.map((e) => e.vendorSku!.toLowerCase()));
    const seenInFile = new Map<string, number>();

    const candidates: Candidate[] = [];
    const issues: ImportIssue[] = [];

    rows.forEach((raw: SheetRow, index) => {
      // +2: one for the header, one because people count from one.
      const rowNumber = index + 2;
      const name = cellText(raw, 'Product name', 'Name', 'Product');
      const fail = (problem: string) =>
        issues.push({ row: rowNumber, name: name || '(no name)', problem });

      if (!name) {
        fail('No product name');
        return;
      }

      const categoryName = cellText(raw, 'Category');
      const category = categoryByName.get(categoryName.trim().toLowerCase());
      if (!categoryName) {
        fail('No category');
        return;
      }
      if (!category) {
        fail(`No category called "${categoryName}"`);
        return;
      }

      const unitPrice = this.number(cellText(raw, 'Unit price', 'Price'));
      if (unitPrice === null) {
        fail('Unit price is missing or not a number');
        return;
      }
      if (unitPrice < 0) {
        fail('Unit price cannot be negative');
        return;
      }

      const quantity = this.number(cellText(raw, 'Available quantity', 'Quantity', 'Stock')) ?? 0;
      const quantityProblem = stockQuantityProblem(quantity);
      if (quantityProblem) {
        fail(quantityProblem);
        return;
      }

      const sku = cellText(raw, 'SKU', 'Vendor SKU', 'Your SKU') || null;
      if (sku) {
        const key = sku.toLowerCase();
        if (takenSkus.has(key)) {
          fail(`You already have a product with the SKU ${sku}`);
          return;
        }
        const earlier = seenInFile.get(key);
        if (earlier) {
          fail(`The SKU ${sku} is also on row ${earlier} of this file`);
          return;
        }
        seenInFile.set(key, rowNumber);
      }

      const gst = this.number(cellText(raw, 'GST %', 'GST', 'Tax %')) ?? 0;
      if (gst < 0 || gst > 100) {
        fail('GST % must be between 0 and 100');
        return;
      }

      const from = this.date(cellText(raw, 'Available from')) ?? new Date();
      const until =
        this.date(cellText(raw, 'Available until', 'Price held until')) ??
        new Date(Date.now() + 90 * 86_400_000);
      if (until <= from) {
        fail('The end date is not after the start date');
        return;
      }

      candidates.push({
        row: rowNumber,
        name,
        data: {
          name: name.slice(0, 180),
          categoryId: category.id,
          categoryName: category.name,
          brand: cellText(raw, 'Brand') || null,
          model: cellText(raw, 'Model') || null,
          vendorSku: sku,
          description: cellText(raw, 'Description') || null,
          unitPrice,
          gstPercent: gst,
          availableQuantity: quantity,
          minOrderQuantity: Math.max(1, this.number(cellText(raw, 'Minimum order')) ?? 1),
          leadTimeDays: this.number(cellText(raw, 'Lead time days', 'Lead time')),
          warrantyMonths: this.number(cellText(raw, 'Warranty months', 'Warranty')),
          availableFrom: from,
          availableUntil: until,
        },
      });
    });

    return { candidates, issues, totalRows: rows.length };
  }

  /** What would happen, without anything happening. */
  async preview(actor: AuthUser, vendorId: string, buffer: Buffer): Promise<ImportReport> {
    const { candidates, issues, totalRows } = await this.assess(actor, vendorId, buffer);
    return {
      totalRows,
      valid: candidates.length,
      failed: issues.length,
      imported: 0,
      issues,
    };
  }

  /**
   * Import the rows that pass, and report the ones that do not.
   *
   * Each row is written on its own rather than in one transaction: the point of
   * the exercise is that ninety-five arrive when five are wrong, and a single
   * transaction would give that up to make the failure tidier.
   */
  async commit(actor: AuthUser, vendorId: string, buffer: Buffer): Promise<ImportReport> {
    const { candidates, issues, totalRows } = await this.assess(actor, vendorId, buffer);

    let imported = 0;
    for (const candidate of candidates) {
      try {
        const { categoryName, ...data } = candidate.data;
        const breakdown = calculateLandedCost({
          unitPrice: data.unitPrice,
          gstPercent: data.gstPercent,
          discount: 0,
          shippingCost: 0,
          installationCost: 0,
          otherCharges: 0,
        });

        await this.prisma.client.$transaction(async (tx) => {
          const stem = productCodeStem({
            categoryName,
            brand: data.brand,
            model: data.model,
          });
          await (
            tx as unknown as {
              $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>;
            }
          ).$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vpcode:${actor.companyId}:${stem}`}))`;
          const taken = await (
            tx as unknown as {
              $queryRaw: (
                q: TemplateStringsArray,
                ...v: unknown[]
              ) => Promise<{ productCode: string }[]>;
            }
          ).$queryRaw`
            SELECT "productCode" FROM vendor_products
             WHERE "companyId" = ${actor.companyId}
               AND "productCode" ~ ${`^${stem}-[0-9]+$`}
             ORDER BY length("productCode") DESC, "productCode" DESC
             LIMIT 1`;
          const next = taken[0]?.productCode ? productCodeSequence(taken[0].productCode) + 1 : 1;

          await tx.vendorProduct.create({
            data: {
              ...data,
              companyId: actor.companyId,
              vendorId,
              productCode: formatProductCode(stem, next),
              // Imported rows are drafts like any other: a bulk upload is not a
              // way round the picture and the required specifications.
              status: 'DRAFT',
              currency: 'INR',
              unitPrice: new Prisma.Decimal(data.unitPrice),
              gstPercent: new Prisma.Decimal(data.gstPercent),
              landedCost: new Prisma.Decimal(breakdown.landedCost),
              createdById: actor.id,
            },
          });
        });
        imported += 1;
      } catch (error) {
        // One row failing is a row, not a file. The reason goes in the report
        // beside the validation failures so the supplier sees one list.
        const message = error instanceof Error ? error.message : 'Could not be imported';
        this.logger.warn(`Import row ${candidate.row} failed: ${message}`);
        issues.push({
          row: candidate.row,
          name: candidate.name,
          problem: 'Could not be saved. Check for a duplicate SKU or an unusual value.',
        });
      }
    }

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'VendorProduct',
      entityId: vendorId,
      newValues: { imported, failed: issues.length, totalRows },
      reason: 'Bulk product import',
    });

    return {
      totalRows,
      valid: candidates.length,
      failed: issues.length,
      imported,
      issues,
    };
  }
}
