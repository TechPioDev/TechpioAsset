import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';
import { PrismaClient } from '@prisma/client';
import { AiDocumentProvider } from '../src/providers/ai/ai-document.provider.js';

/**
 * Phase 3: invoices, deterministic verification, and AI enable/disable.
 *
 * The spy on AiDocumentProvider.extract is the load-bearing assertion of the
 * phase: it proves that with AI disabled the provider is never called, which is
 * spec section 10's central requirement.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let extractSpy: ReturnType<typeof vi.spyOn>;

// A minimal valid PDF so file validation accepts the upload.
const PDF = Buffer.concat([
  Buffer.from('%PDF-1.7\n', 'ascii'),
  Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]),
  Buffer.from('1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'ascii'),
]);

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  // Spy on the actual resolved provider instance in the DI container.
  const provider = app.get(AiDocumentProvider);
  extractSpy = vi.spyOn(provider, 'extract');
});

afterAll(async () => {
  await app?.close();
});

async function setAiEnabled(enabled: boolean) {
  const response = await api(app)
    .patch('/api/v1/ai-config')
    .set(auth(s.superAdmin))
    .send({
      globallyEnabled: enabled,
      paused: false,
      featureModes: { INVOICE_OCR: 'MANUAL_REVIEW_REQUIRED' },
      humanReviewRequired: true,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

async function firstVendorId(): Promise<string> {
  const vendors = await api(app).get('/api/v1/vendors').set(auth(s.finance));
  return vendors.body.data[0].id;
}

describe('AI configuration (spec section 10)', () => {
  it('is readable only by a Super Admin', async () => {
    expect((await api(app).get('/api/v1/ai-config').set(auth(s.superAdmin))).status).toBe(200);
    expect((await api(app).get('/api/v1/ai-config').set(auth(s.finance))).status).toBe(403);
    expect((await api(app).get('/api/v1/ai-config').set(auth(s.employee))).status).toBe(403);
  });

  it('defaults to disabled with human review required', async () => {
    const response = await api(app).get('/api/v1/ai-config').set(auth(s.superAdmin));
    expect(response.body.data.config.humanReviewRequired).toBe(true);
    expect(response.body.data.config.automaticFinancialApproval).toBe(false);
  });
});

describe('upload with AI DISABLED (spec section 10)', () => {
  it('never calls the AI provider', async () => {
    await setAiEnabled(false);
    extractSpy.mockClear();

    const response = await api(app)
      .post('/api/v1/invoices/upload')
      .set(auth(s.finance))
      .attach('file', PDF, 'invoice-ai-off.pdf');

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    // The whole point: no document was submitted to any provider.
    expect(extractSpy).not.toHaveBeenCalled();
    expect(response.body.data.extraction.ran).toBe(false);
    // Deterministic verification still ran (section 10: rules keep working).
    expect(response.body.data.invoice.verifications).toBeDefined();
  });

  it('still accepts a fully manual invoice and verifies it deterministically', async () => {
    await setAiEnabled(false);
    extractSpy.mockClear();

    const vendorId = await firstVendorId();
    const response = await api(app)
      .post('/api/v1/invoices')
      .set(auth(s.finance))
      .send({
        vendorId,
        invoiceNumber: `MANUAL-${Date.now()}`,
        invoiceDate: '2026-06-01',
        currency: 'USD',
        subtotal: '2000.00',
        tax: '200.00',
        total: '2200.00',
        lines: [
          {
            lineNumber: 1,
            description: 'Laptop',
            quantity: 1,
            unitPrice: '1500.00',
            lineTotal: '1500.00',
          },
          {
            lineNumber: 2,
            description: 'Monitor',
            quantity: 1,
            unitPrice: '500.00',
            lineTotal: '500.00',
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(extractSpy).not.toHaveBeenCalled();
    // Clean invoice → the engine reports no cost error.
    const verification = response.body.data.verifications[0];
    expect(verification.outcome).not.toBe('COST_MISMATCH');
  });

  // The exact body the web /invoices/new page and the phone's invoice/new
  // screen build (buildCreateInvoicePayload): money and quantity as strings,
  // INR, every optional charge, dates and a printed PO number.
  it('accepts the body the Add invoice forms send, and only from invoices:upload', async () => {
    await setAiEnabled(false);
    const vendorId = await firstVendorId();
    const body = {
      vendorId,
      invoiceNumber: `FORM-${Date.now()}`,
      invoiceDate: '2026-09-01',
      currency: 'INR',
      subtotal: '90001.30',
      total: '106799.99',
      lines: [
        {
          lineNumber: 1,
          description: 'Laptop',
          quantity: '2',
          unitPrice: '45000.50',
          lineTotal: '90001.00',
        },
        {
          lineNumber: 2,
          description: 'Mouse',
          quantity: '3',
          unitPrice: '0.10',
          lineTotal: '0.30',
        },
      ],
      dueDate: '2026-10-01',
      purchaseDate: '2026-08-28',
      purchaseOrderNumber: 'PO-PRINTED-7',
      discount: '1.30',
      tax: '16200',
      shipping: '500',
      otherCharges: '99.99',
      notes: 'Entered from the paper bill',
    };

    const refused = await api(app).post('/api/v1/invoices').set(auth(s.employee)).send(body);
    expect(refused.status).toBe(403);

    const response = await api(app).post('/api/v1/invoices').set(auth(s.finance)).send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const invoice = response.body.data;
    expect(invoice.currency).toBe('INR');
    expect(Number(invoice.total)).toBe(106799.99);
    expect(invoice.lines.map((l: { lineTotal: string }) => Number(l.lineTotal))).toEqual([
      90001, 0.3,
    ]);
    const issues = invoice.verifications[0].issues as { code: string }[];
    // The figures add up, so nothing about cost is flagged.
    expect(issues.map((i) => i.code)).not.toEqual(
      expect.arrayContaining(['SUBTOTAL_MISMATCH', 'TOTAL_MISMATCH', 'LINE_TOTAL_MISMATCH']),
    );
    expect(invoice.verifications[0].outcome).not.toBe('COST_MISMATCH');
  });
});

describe('upload with AI ENABLED', () => {
  /**
   * Polls until the queued job has produced what the caller is asserting on.
   *
   * The condition is the caller's, not a fixed "has an extraction": the job
   * writes the extraction record and only then runs verification, so waiting on
   * the extraction and asserting on the verification is a race that passes
   * alone and fails in a full run.
   */
  async function waitForInvoice(
    invoiceId: string,
    ready: (invoice: { extractions?: unknown[]; verifications?: unknown[] }) => boolean,
    what: string,
    timeoutMs = 15_000,
  ) {
    const deadline = Date.now() + timeoutMs;
    let last: { extractions?: unknown[]; verifications?: unknown[] } = {};
    while (Date.now() < deadline) {
      const res = await api(app).get(`/api/v1/invoices/${invoiceId}`).set(auth(s.finance));
      last = res.body.data;
      if (ready(last)) return last;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `${what} never happened for ${invoiceId} ` +
        `(extractions=${last.extractions?.length ?? 0}, verifications=${last.verifications?.length ?? 0})`,
    );
  }

  it('returns without waiting for the provider, and queues the work', async () => {
    await setAiEnabled(true);
    extractSpy.mockClear();

    const response = await api(app)
      .post('/api/v1/invoices/upload')
      .set(auth(s.finance))
      .attach('file', PDF, 'invoice-ai-on.pdf');

    expect(response.status).toBe(201);
    // The point of the change: the uploader is not held on the request while a
    // document is read. A one-page bill took 14.5s against a real provider, and
    // a proxy timing out mid-extraction charged twice for one document.
    expect(response.body.data.extraction).toMatchObject({ ran: false, queued: true });
    expect(response.body.data.invoice.verificationStatus).toBe('PENDING_AI_PROCESSING');

    const invoice = await waitForInvoice(
      response.body.data.invoice.id,
      (i) => (i.extractions?.length ?? 0) > 0,
      'extraction',
    );
    expect(extractSpy).toHaveBeenCalledTimes(1);

    // Mock provider → simulated flag surfaced, never presented as real (section 28).
    const extraction = invoice.extractions[0];
    expect(extraction.simulated).toBe(true);
    expect(extraction.provider).toBe('mock');

    await setAiEnabled(false); // leave the company back at the safe default
  });

  it('verifies only after the fields exist, never against an empty invoice', async () => {
    await setAiEnabled(true);
    extractSpy.mockClear();

    const response = await api(app)
      .post('/api/v1/invoices/upload')
      .set(auth(s.finance))
      .attach('file', PDF, 'invoice-verify-order.pdf');

    // Verification is what decides whether a bill can be paid. Grading an
    // invoice before extraction filled it in would record a verdict on an empty
    // document, so on the AI path it belongs after the job, not at upload.
    expect(response.body.data.invoice.verifications ?? []).toHaveLength(0);

    const invoice = await waitForInvoice(
      response.body.data.invoice.id,
      (i) => (i.verifications?.length ?? 0) > 0,
      'verification',
    );
    expect(invoice.verifications!.length).toBeGreaterThan(0);

    await setAiEnabled(false);
  });
});

describe('the monthly spending ceiling', () => {
  /**
   * A ceiling that is stored but never checked is worse than no ceiling: it
   * invites exactly the bulk upload somebody would otherwise think twice about.
   * These prove the gate actually stops at the number.
   */
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setBudget(monthlyBudgetUsd: number | null) {
    const res = await api(app)
      .patch('/api/v1/ai-config')
      .set(auth(s.superAdmin))
      .send({
        globallyEnabled: true,
        paused: false,
        monthlyBudgetUsd,
        featureModes: { INVOICE_OCR: 'MANUAL_REVIEW_REQUIRED' },
        humanReviewRequired: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  async function spend(companyId: string, costUsd: number) {
    await prisma.aIUsageRecord.create({
      data: {
        companyId,
        feature: 'INVOICE_OCR',
        provider: 'anthropic',
        costUsd,
        succeeded: true,
        // Only real spend counts - a mock costs nothing, and letting it consume
        // the budget would make development eat production's ceiling.
        simulated: false,
      },
    });
  }

  it('refuses to extract once the month is spent, and does not call the provider', async () => {
    const companyId = s.superAdmin.user.companyId;
    await setBudget(5);
    await spend(companyId, 5.5);
    extractSpy.mockClear();

    const response = await api(app)
      .post('/api/v1/invoices/upload')
      .set(auth(s.finance))
      .attach('file', PDF, 'invoice-over-budget.pdf');

    expect(response.status).toBe(201);
    // The upload still succeeds - the bill is filed, it is just not read.
    expect(response.body.data.extraction.ran).toBe(false);
    expect(response.body.data.extraction.queued).toBe(false);
    expect(response.body.data.extraction.reason).toBe('BUDGET_EXCEEDED');
    expect(extractSpy).not.toHaveBeenCalled();

    await setBudget(null);
    await prisma.aIUsageRecord.deleteMany({ where: { companyId, simulated: false } });
    await setAiEnabled(false);
  });

  it('still extracts while the budget has room', async () => {
    const companyId = s.superAdmin.user.companyId;
    await setBudget(100);
    await spend(companyId, 1.25);
    extractSpy.mockClear();

    const response = await api(app)
      .post('/api/v1/invoices/upload')
      .set(auth(s.finance))
      .attach('file', PDF, 'invoice-within-budget.pdf');

    expect(response.body.data.extraction.queued).toBe(true);

    await setBudget(null);
    await prisma.aIUsageRecord.deleteMany({ where: { companyId, simulated: false } });
    await setAiEnabled(false);
  });
});

describe('deterministic verification detects mismatches (spec section 26)', () => {
  async function manualInvoice(over: Record<string, unknown>) {
    const vendorId = await firstVendorId();
    return api(app)
      .post('/api/v1/invoices')
      .set(auth(s.finance))
      .send({
        vendorId,
        invoiceNumber: `VERIFY-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        invoiceDate: '2026-06-01',
        currency: 'USD',
        subtotal: '1000.00',
        tax: '0.00',
        total: '1000.00',
        lines: [
          {
            lineNumber: 1,
            description: 'Item',
            quantity: 1,
            unitPrice: '1000.00',
            lineTotal: '1000.00',
          },
        ],
        ...over,
      });
  }

  it('flags a cost mismatch', async () => {
    // Total that does not equal subtotal + tax.
    const response = await manualInvoice({ total: '9999.00' });
    expect(response.status).toBe(201);
    expect(response.body.data.verifications[0].outcome).toBe('COST_MISMATCH');
  });

  it('flags a line total that is not quantity × unit price', async () => {
    const response = await manualInvoice({
      subtotal: '1000.00',
      total: '1000.00',
      lines: [
        {
          lineNumber: 1,
          description: 'Item',
          quantity: 2,
          unitPrice: '1000.00',
          lineTotal: '1000.00',
        },
      ],
    });
    const issues = response.body.data.verifications[0].issues;
    expect(issues.some((i: { code: string }) => i.code === 'LINE_TOTAL_MISMATCH')).toBe(true);
  });

  it('flags a duplicate invoice number', async () => {
    const vendorId = await firstVendorId();
    const number = `DUP-${Date.now()}`;
    const body = {
      vendorId,
      invoiceNumber: number,
      invoiceDate: '2026-06-01',
      currency: 'USD',
      subtotal: '100.00',
      tax: '0.00',
      total: '100.00',
      lines: [
        {
          lineNumber: 1,
          description: 'Item',
          quantity: 1,
          unitPrice: '100.00',
          lineTotal: '100.00',
        },
      ],
    };
    const first = await api(app).post('/api/v1/invoices').set(auth(s.finance)).send(body);
    expect(first.status).toBe(201);

    // A second invoice with the same number must fail the unique constraint at
    // the database, surfaced as a catalogued duplicate error.
    const second = await api(app).post('/api/v1/invoices').set(auth(s.finance)).send(body);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('DUPLICATE_INVOICE_NUMBER');
  });
});

describe('human decision (spec section 9)', () => {
  it('lets Finance verify an invoice', async () => {
    const vendorId = await firstVendorId();
    const created = await api(app)
      .post('/api/v1/invoices')
      .set(auth(s.finance))
      .send({
        vendorId,
        invoiceNumber: `HUMAN-${Date.now()}`,
        invoiceDate: '2026-06-01',
        currency: 'USD',
        subtotal: '500.00',
        tax: '0.00',
        total: '500.00',
        lines: [
          {
            lineNumber: 1,
            description: 'Item',
            quantity: 1,
            unitPrice: '500.00',
            lineTotal: '500.00',
          },
        ],
      });

    const decided = await api(app)
      .post(`/api/v1/invoices/${created.body.data.id}/decision`)
      .set(auth(s.finance))
      .send({ decision: 'VERIFIED', notes: 'Checked against the PO.' });

    expect(decided.status).toBe(201);
    expect(decided.body.data.verificationStatus).toBe('VERIFIED');
    expect(decided.body.data.verifications[0].decidedBy.email).toBe('finance@techpioasset.dev');
  });

  it('does not let a non-verifier decide', async () => {
    const vendorId = await firstVendorId();
    const created = await api(app)
      .post('/api/v1/invoices')
      .set(auth(s.finance))
      .send({
        vendorId,
        invoiceNumber: `NOAUTH-${Date.now()}`,
        invoiceDate: '2026-06-01',
        currency: 'USD',
        subtotal: '100.00',
        tax: '0.00',
        total: '100.00',
        lines: [
          {
            lineNumber: 1,
            description: 'Item',
            quantity: 1,
            unitPrice: '100.00',
            lineTotal: '100.00',
          },
        ],
      });

    // IT Admin can read nothing here and certainly cannot verify.
    const denied = await api(app)
      .post(`/api/v1/invoices/${created.body.data.id}/decision`)
      .set(auth(s.itAdmin))
      .send({ decision: 'VERIFIED' });
    expect(denied.status).toBe(403);
  });
});

describe('file validation on upload (spec sections 8, 20)', () => {
  it('rejects a non-document file even if named .pdf', async () => {
    await setAiEnabled(false);
    // A PNG signature under a .pdf name — the bytes are what count, but PNG is
    // an allowed image type, so use a plain-text buffer that matches nothing.
    const notADocument = Buffer.from('this is just text, not a document', 'ascii');
    const response = await api(app)
      .post('/api/v1/invoices/upload')
      .set(auth(s.finance))
      .attach('file', notADocument, 'malicious.pdf');
    expect(response.status).toBe(415);
  });
});

describe('invoice access control (spec section 3)', () => {
  it('denies an employee the invoices list', async () => {
    expect((await api(app).get('/api/v1/invoices').set(auth(s.employee))).status).toBe(403);
  });

  it('denies HR the invoices list (no financial permission)', async () => {
    expect((await api(app).get('/api/v1/invoices').set(auth(s.hr))).status).toBe(403);
  });

  it('allows Finance and Auditor to read invoices', async () => {
    expect((await api(app).get('/api/v1/invoices').set(auth(s.finance))).status).toBe(200);
    expect((await api(app).get('/api/v1/invoices').set(auth(s.auditor))).status).toBe(200);
  });
});
