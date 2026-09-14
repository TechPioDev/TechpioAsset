import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AppConfig } from '../src/config/config.module.js';
import { signDownloadLink } from '../src/common/signed-download-link.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.56 - signed download links for request attachments and invoice documents,
 * for the phone (which cannot attach a sign-in header to a URL it hands to the
 * system browser). Same construction and the same promises as the vendor
 * product document links in offer-comparison.integration.test.ts:
 *   - access is decided when the link is minted, through the normal read path;
 *   - the link opens with no Authorization header at all;
 *   - a tampered signature, a swapped id and a claim to another company all 404;
 *   - an expired link is a 401.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let secret: string;

let requestId = '';
let attachmentId = '';
let secondAttachmentId = '';
let invoiceId = '';
let documentId = '';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** A minimal PDF, unique per run so duplicate-file detection does not interfere. */
const pdf = () =>
  Buffer.concat([
    Buffer.from('%PDF-1.7\n', 'ascii'),
    Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]),
    Buffer.from(`1 0 obj<<>>endobj\n% ${Date.now()}-${Math.random()}\ntrailer<<>>\n%%EOF`, 'ascii'),
  ]);

/** Splits `/prefix/<payload>.<sig>` into its parts. */
function parts(path: string) {
  const slash = path.lastIndexOf('/');
  const prefix = path.slice(0, slash + 1);
  const [payload, signature] = path.slice(slash + 1).split('.');
  return { prefix, payload: payload!, signature: signature! };
}

function forge(path: string) {
  const { prefix, payload, signature } = parts(path);
  // Change the FIRST character. The last one carries two bits nobody reads, so
  // swapping A for B there left the MAC unchanged about one run in sixteen.
  const first = signature.slice(0, 1);
  return `${prefix}${payload}.${first === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
}

function swapId(path: string, otherId: string) {
  const { prefix, payload, signature } = parts(path);
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  claims.d = otherId;
  return `${prefix}${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
}

async function expired(path: string) {
  const realNow = Date.now;
  Date.now = () => realNow() + 5 * 60 * 1000;
  try {
    return (await api(app).get(`/api/v1${path}`)).status;
  } finally {
    Date.now = realNow;
  }
}

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  secret = app.get(AppConfig).get('JWT_ACCESS_SECRET') as string;

  const created = await api(app)
    .post('/api/v1/requests')
    .set(auth(s.employee))
    .send({
      type: 'ADDITIONAL_EQUIPMENT',
      businessReason: 'Signed link fixture request - a docking station',
      items: [{ description: 'Dock', quantity: 1 }],
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  requestId = created.body.data.id;

  for (const name of ['first.png', 'second.png']) {
    const res = await api(app)
      .post(`/api/v1/requests/${requestId}/attachments`)
      .set(auth(s.employee))
      .attach('file', PNG, name);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  }
  const detail = await api(app).get(`/api/v1/requests/${requestId}`).set(auth(s.employee));
  const atts = detail.body.data.attachments as { id: string; originalName: string }[];
  attachmentId = atts.find((a) => a.originalName === 'first.png')!.id;
  secondAttachmentId = atts.find((a) => a.originalName === 'second.png')!.id;

  const uploaded = await api(app)
    .post('/api/v1/invoices/upload')
    .set(auth(s.finance))
    .attach('file', pdf(), 'signed-link-invoice.pdf');
  expect(uploaded.status, JSON.stringify(uploaded.body).slice(0, 300)).toBe(201);
  invoiceId = uploaded.body.data.invoice.id;
  const invoice = await api(app).get(`/api/v1/invoices/${invoiceId}`).set(auth(s.finance));
  documentId = invoice.body.data.documents[0].id;
});

afterAll(async () => {
  await prisma?.client.$executeRawUnsafe('DELETE FROM attachments WHERE "assetRequestId" = $1', requestId);
  await prisma?.client.$executeRawUnsafe('DELETE FROM request_items WHERE "requestId" = $1', requestId);
  await prisma?.client.$executeRawUnsafe('DELETE FROM asset_requests WHERE id = $1', requestId);
  if (invoiceId) await prisma?.client.invoice.delete({ where: { id: invoiceId } }).catch(() => undefined);
  await app?.close();
});

describe('request attachment links', () => {
  const mint = (as: Session, att = attachmentId) =>
    api(app).post(`/api/v1/requests/${requestId}/attachments/${att}/link`).set(auth(as));

  it('opens the attachment with no sign-in header', async () => {
    const link = await mint(s.employee);
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    expect(new Date(link.body.data.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(121_000);

    const res = await api(app).get(`/api/v1${link.body.data.path}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('is minted for an approver too - the same read path the web uses', async () => {
    expect((await mint(s.superAdmin)).status).toBe(201);
  });

  it('will not mint a link for somebody who cannot see the request', async () => {
    expect((await mint(s.employee2)).status).toBe(404);
  });

  it('refuses a tampered signature', async () => {
    const link = await mint(s.employee);
    expect((await api(app).get(`/api/v1${forge(link.body.data.path)}`)).status).toBe(404);
  });

  it('refuses a genuine link rewritten to name a different attachment', async () => {
    const link = await mint(s.employee);
    const swapped = swapId(link.body.data.path, secondAttachmentId);
    expect((await api(app).get(`/api/v1${swapped}`)).status).toBe(404);
  });

  it('refuses a link after it has expired', async () => {
    const link = await mint(s.employee);
    expect(await expired(link.body.data.path)).toBe(401);
  });

  it('refuses a correctly signed link that claims another company', async () => {
    // Proves the explicit company filter: with no session there is no tenant,
    // so the claim from the signature is the only thing standing in the way.
    const { token } = signDownloadLink(secret, 'request-attachment-link', {
      fileId: attachmentId,
      companyId: 'another-company-entirely',
    });
    expect((await api(app).get(`/api/v1/requests/attachment-links/${token}`)).status).toBe(404);
  });

  it('stops working once the attachment is removed', async () => {
    const link = await mint(s.employee, secondAttachmentId);
    expect(link.status).toBe(201);
    await api(app)
      .delete(`/api/v1/requests/${requestId}/attachments/${secondAttachmentId}`)
      .set(auth(s.employee));
    expect((await api(app).get(`/api/v1${link.body.data.path}`)).status).toBe(404);
  });

  it('refuses garbage rather than throwing on it', async () => {
    expect((await api(app).get('/api/v1/requests/attachment-links/not-a-token')).status).toBe(404);
    expect((await api(app).get('/api/v1/requests/attachment-links/a.b')).status).toBe(404);
  });
});

describe('invoice document links', () => {
  const mint = (as: Session, doc = documentId) =>
    api(app).post(`/api/v1/invoices/${invoiceId}/documents/${doc}/link`).set(auth(as));

  it('opens the document with no sign-in header', async () => {
    const link = await mint(s.finance);
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const res = await api(app).get(`/api/v1${link.body.data.path}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('will not mint a link for somebody without invoices:read', async () => {
    expect((await mint(s.employee)).status).toBe(403);
  });

  it('will not mint a link to a document that is not on this invoice', async () => {
    expect((await mint(s.finance, 'no-such-document')).status).toBe(404);
  });

  it('refuses a tampered signature', async () => {
    const link = await mint(s.finance);
    expect((await api(app).get(`/api/v1${forge(link.body.data.path)}`)).status).toBe(404);
  });

  it('refuses a genuine link rewritten to name a different document', async () => {
    const link = await mint(s.finance);
    // Any other id - the signature covers the id, so this must fail.
    const swapped = swapId(link.body.data.path, attachmentId);
    expect((await api(app).get(`/api/v1${swapped}`)).status).toBe(404);
  });

  it('refuses a link after it has expired', async () => {
    const link = await mint(s.finance);
    expect(await expired(link.body.data.path)).toBe(401);
  });

  it('refuses a correctly signed link that claims another company', async () => {
    const { token } = signDownloadLink(secret, 'invoice-document-link', {
      fileId: documentId,
      companyId: 'another-company-entirely',
    });
    expect((await api(app).get(`/api/v1/invoices/document-links/${token}`)).status).toBe(404);
  });

  it('a link of one kind is refused on the other route', async () => {
    const attachmentLink = await api(app)
      .post(`/api/v1/requests/${requestId}/attachments/${attachmentId}/link`)
      .set(auth(s.employee));
    const token = parts(attachmentLink.body.data.path);
    const res = await api(app).get(
      `/api/v1/invoices/document-links/${token.payload}.${token.signature}`,
    );
    expect(res.status).toBe(404);
  });
});
