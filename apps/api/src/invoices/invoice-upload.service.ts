import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import type { AuthUser } from '@techpioasset/contracts';
import { tenantFilter } from '../common/scope.js';
import { AppConfig } from '../config/config.module.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiConfigService } from '../ai-config/ai-config.service.js';
import { AiDocumentProvider } from '../providers/ai/ai-document.provider.js';
import { StorageProvider } from '../providers/storage/storage.provider.js';
import { validateUpload } from '../providers/storage/file-validation.js';
import { QueueProvider } from '../providers/queue/queue.provider.js';
import { InvoicesService } from './invoices.service.js';

export const EXTRACT_INVOICE_JOB = 'invoice.extract';

/**
 * What the extraction job needs to do its work.
 *
 * The document bytes are deliberately NOT in here. They are already in object
 * storage by the time this is queued, and production runs BullMQ on Redis, so
 * carrying a 30 MB scan through the payload would put a base64 copy of every
 * uploaded bill into Redis. The job re-reads it by key instead.
 *
 * The actor is carried as the few fields the work actually needs - usage
 * records and verification are attributed to the person who uploaded, and a job
 * that outlives the request cannot go back and ask.
 */
interface ExtractJobPayload {
  invoiceId: string;
  storageKey: string;
  contentType: string;
  fileName: string;
  actor: { id: string; companyId: string; officeId: string | null; roles: string[] };
}

/**
 * Handles a document upload and, if AI is enabled for this company, extraction.
 *
 * The order enforces spec section 9's workflow: validate → store → (extract only
 * if the gate permits) → deterministic verification always. The gate is checked
 * before the provider is ever touched, which is what makes "AI disabled → no
 * external call" true by construction rather than by discipline.
 */
@Injectable()
export class InvoiceUploadService implements OnModuleInit {
  private readonly logger = new Logger(InvoiceUploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageProvider,
    private readonly ai: AiDocumentProvider,
    private readonly aiConfig: AiConfigService,
    private readonly invoices: InvoicesService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly queue: QueueProvider,
  ) {}

  onModuleInit(): void {
    this.queue.register<ExtractJobPayload>(EXTRACT_INVOICE_JOB, async (payload) => {
      const actor = payload.actor as unknown as AuthUser;
      const data = await this.storage.get(payload.storageKey);
      await this.runExtraction(actor, payload.invoiceId, {
        buffer: data,
        originalname: payload.fileName,
      }, payload.contentType);

      // Deterministic verification runs against the fields extraction just
      // populated, so on this path it belongs after the job, not at upload.
      await this.invoices.runVerification(actor, payload.invoiceId);
    });
  }

  async upload(
    actor: AuthUser,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    meta: { vendorId?: string; invoiceNumber?: string },
  ) {
    // 1. Validate the bytes (type + size), by signature not by claim.
    const { sha256, contentType } = validateUpload({
      data: file.buffer,
      declaredMime: file.mimetype,
      allowedMimes: this.config.get('ALLOWED_UPLOAD_MIME'),
      maxBytes: this.config.get('MAX_UPLOAD_MB') * 1024 * 1024,
    });

    // 2. Store privately. The key is opaque; access is signed and permissioned.
    const stored = await this.storage.put({
      prefix: `invoices/${actor.companyId}`,
      originalName: file.originalname,
      contentType,
      data: file.buffer,
    });

    // 3. Create a draft invoice shell to attach the document and any extraction to.
    const invoice = await this.prisma.client.invoice.create({
      data: {
        companyId: actor.companyId,
        // A unique placeholder per upload, not derived from the file: re-uploading
        // the same document must not be blocked at creation. Duplicate detection
        // is a verification *warning* the reviewer sees (via the file hash), not a
        // hard constraint that refuses the upload.
        invoiceNumber: meta.invoiceNumber ?? `UPLOAD-${ulid()}`,
        vendorId: await this.resolveVendor(actor, meta.vendorId),
        invoiceDate: new Date(),
        // A placeholder until extraction or a reviewer says otherwise - so it is
        // the company's own currency, not dollars for everybody.
        currency: (
          await this.prisma.client.company.findUniqueOrThrow({
            where: { id: actor.companyId },
            select: { baseCurrency: true },
          })
        ).baseCurrency,
        verificationStatus: 'UPLOADED',
        createdById: actor.id,
        documents: {
          create: {
            storageKey: stored.key,
            originalName: file.originalname,
            mimeType: contentType,
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
            // Malware scanning is a documented hook; with no scanner wired the
            // status is SKIPPED, not silently CLEAN (spec section 1).
            scanStatus: 'SKIPPED',
            uploadedById: actor.id,
          },
        },
      },
      include: { documents: true },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.INVOICE_UPLOADED,
      entityType: 'Invoice',
      entityId: invoice.id,
      newValues: { fileName: file.originalname, sha256, aiEnabled: false },
    });

    // 4. Extraction — only if the gate permits. This is the decisive check.
    const gate = await this.aiConfig.gate(actor.companyId, 'INVOICE_OCR', {
      officeId: actor.officeId,
      roleKeys: actor.roles,
    });

    let extractionSummary: {
      ran: boolean;
      queued: boolean;
      simulated: boolean;
      reason?: string;
    };

    if (!gate.enabled) {
      // No provider is contacted. The invoice waits for manual entry/review.
      this.logger.log(`AI disabled (${gate.reason}); no document submitted for ${invoice.id}`);
      await this.prisma.client.invoice.update({
        where: { id: invoice.id },
        data: { verificationStatus: 'PENDING_REVIEW' },
      });
      extractionSummary = { ran: false, queued: false, simulated: false, reason: gate.reason };

      // 5a. Nothing will populate fields later, so verify now.
      await this.invoices.runVerification(actor, invoice.id);
    } else {
      // 4a. Extraction is queued rather than awaited. A one-page bill measured
      // 14.5s against Claude and a multi-page scan takes longer, which held the
      // uploader's request open past any sensible proxy timeout - and a timeout
      // there was worse than a slow answer, because the API carried on, saved
      // the extraction and charged for it while the uploader saw an error and
      // retried into a second charge.
      await this.prisma.client.invoice.update({
        where: { id: invoice.id },
        data: { verificationStatus: 'PENDING_AI_PROCESSING' },
      });
      await this.queue.enqueue<ExtractJobPayload>(EXTRACT_INVOICE_JOB, {
        invoiceId: invoice.id,
        storageKey: stored.key,
        contentType,
        fileName: file.originalname,
        actor: {
          id: actor.id,
          companyId: actor.companyId,
          officeId: actor.officeId ?? null,
          roles: actor.roles,
        },
      });
      extractionSummary = { ran: false, queued: true, simulated: false };

      // 5b. Verification runs inside the job, once there are extracted fields
      // to check. Running it here would grade an empty invoice.
    }

    const result = await this.invoices.findOne(actor, invoice.id);
    return { invoice: result, extraction: extractionSummary };
  }

  private async runExtraction(
    actor: AuthUser,
    invoiceId: string,
    file: { buffer: Buffer; originalname: string },
    contentType: string,
  ): Promise<{ ran: boolean; simulated: boolean }> {
    await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { verificationStatus: 'AI_PROCESSING' },
    });

    try {
      const result = await this.ai.extract({
        data: file.buffer,
        contentType,
        fileName: file.originalname,
      });

      // Persist the raw extraction. The original is retained verbatim; any human
      // correction lands on the invoice fields, never overwriting this record
      // (spec section 9: "save the original extraction, corrected values, decision").
      await this.prisma.client.invoiceExtraction.create({
        data: {
          invoiceId,
          provider: result.provider,
          modelName: result.modelName,
          status: 'EXTRACTION_COMPLETED',
          extractedFields: result as unknown as Prisma.InputJsonValue,
          fieldConfidences: this.collectConfidences(result) as unknown as Prisma.InputJsonValue,
          overallConfidence: new Prisma.Decimal(result.overallConfidence),
          startedAt: new Date(Date.now() - result.durationMs),
          completedAt: new Date(),
          durationMs: result.durationMs,
          costUsd: result.costUsd !== null ? new Prisma.Decimal(result.costUsd) : null,
          simulated: result.simulated,
        },
      });

      // Populate the invoice's own fields from the extraction so verification has
      // something to check. A human corrects these before deciding.
      await this.applyExtraction(invoiceId, result);

      await this.aiConfig.recordUsage({
        companyId: actor.companyId,
        userId: actor.id,
        feature: 'INVOICE_OCR',
        provider: result.provider,
        modelName: result.modelName,
        entityType: 'Invoice',
        entityId: invoiceId,
        confidence: result.overallConfidence,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
        succeeded: true,
        simulated: result.simulated,
      });

      await this.prisma.client.invoice.update({
        where: { id: invoiceId },
        data: { verificationStatus: 'EXTRACTION_COMPLETED' },
      });

      return { ran: true, simulated: result.simulated };
    } catch (error) {
      this.logger.error(`Extraction failed for ${invoiceId}: ${(error as Error).message}`);
      await this.prisma.client.invoice.update({
        where: { id: invoiceId },
        data: { verificationStatus: 'AI_FAILED' },
      });
      await this.aiConfig.recordUsage({
        companyId: actor.companyId,
        userId: actor.id,
        feature: 'INVOICE_OCR',
        provider: this.ai.name,
        entityType: 'Invoice',
        entityId: invoiceId,
        succeeded: false,
        simulated: false,
        failureDetail: (error as Error).message,
      });
      return { ran: false, simulated: false };
    }
  }

  private async applyExtraction(
    invoiceId: string,
    result: import('../providers/ai/ai-document.provider.js').ExtractionResult,
  ): Promise<void> {
    const num = (v: string | null) =>
      v && /^\d+(\.\d+)?$/.test(v) ? new Prisma.Decimal(v) : undefined;

    await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: {
        // The extracted invoice number is deliberately NOT written to the
        // invoice's own field: it is a unique key, and spec section 9 requires a
        // human to correct extracted fields before they are committed. The
        // suggestion lives in the extraction record; the reviewer applies it.
        ...(result.currency.value ? { currency: result.currency.value } : {}),
        ...(num(result.subtotal.value) ? { subtotal: num(result.subtotal.value) } : {}),
        ...(num(result.tax.value) ? { tax: num(result.tax.value) } : {}),
        ...(num(result.total.value) ? { total: num(result.total.value) } : {}),
        ...(result.invoiceDate.value && !Number.isNaN(Date.parse(result.invoiceDate.value))
          ? { invoiceDate: new Date(result.invoiceDate.value) }
          : {}),
        lines: {
          create: result.lines.map((line) => ({
            lineNumber: line.lineNumber,
            description: line.description.value,
            normalizedDescription: line.description.value,
            quantity: num(line.quantity.value) ?? new Prisma.Decimal(1),
            unitPrice: num(line.unitPrice.value) ?? new Prisma.Decimal(0),
            lineTotal: num(line.lineTotal.value) ?? new Prisma.Decimal(0),
            serialNumbers: line.serialNumbers ?? [],
          })),
        },
      },
    });
  }

  private collectConfidences(
    result: import('../providers/ai/ai-document.provider.js').ExtractionResult,
  ): Record<string, number> {
    return {
      vendorName: result.vendorName.confidence,
      invoiceNumber: result.invoiceNumber.confidence,
      invoiceDate: result.invoiceDate.confidence,
      currency: result.currency.confidence,
      subtotal: result.subtotal.confidence,
      tax: result.tax.confidence,
      total: result.total.confidence,
    };
  }

  private async resolveVendor(actor: AuthUser, vendorId?: string): Promise<string> {
    if (vendorId) {
      const vendor = await this.prisma.client.vendor.findFirst({
        where: { id: vendorId, ...tenantFilter(actor) },
        select: { id: true },
      });
      if (vendor) return vendor.id;
    }
    // Uploads without a stated vendor attach to a placeholder "Unknown vendor",
    // created once per company, which the reviewer reassigns during correction.
    const placeholder = await this.prisma.client.vendor.upsert({
      where: { companyId_code: { companyId: actor.companyId, code: 'UNKNOWN' } },
      update: {},
      create: { companyId: actor.companyId, code: 'UNKNOWN', name: 'Unknown vendor' },
      select: { id: true },
    });
    return placeholder.id;
  }
}
