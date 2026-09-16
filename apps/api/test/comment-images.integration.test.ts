import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.60 - pictures sent inline with a request message.
 *
 * One call, one transaction: POST /requests/:id/comments as multipart with
 * `images[]` writes the comment and its attachment rows together, or nothing.
 * The promises under test:
 *   - the plain JSON message every installed phone build sends still works;
 *   - a message's images come back on the comment, not in the attachments panel;
 *   - only images are accepted here (documents still go through the panel);
 *   - an image sent with an internal note is as hidden from the requester as
 *     the note - list, download, signed link and removal all 404.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let requestId: string;

// A one-pixel PNG - validated by magic bytes, so a real image is required.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.concat([
  Buffer.from('%PDF-1.7\n', 'ascii'),
  Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]),
  Buffer.from('1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'ascii'),
]);

interface CommentAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
}
interface Comment {
  id: string;
  body: string;
  isInternal: boolean;
  attachments: CommentAttachment[];
}

function detail(who: AccountKey) {
  return api(app).get(`/api/v1/requests/${requestId}`).set(auth(s[who]));
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);

  const created = await api(app)
    .post('/api/v1/requests')
    .set(auth(s.employee))
    .send({
      type: 'ADDITIONAL_EQUIPMENT',
      businessReason: 'Inline image fixture request - a cracked keyboard',
      items: [{ description: `Keyboard ${Math.random().toString(36).slice(2, 8)}`, quantity: 1 }],
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  requestId = created.body.data.id;
  await api(app).post(`/api/v1/requests/${requestId}/submit`).set(auth(s.employee));
});

afterAll(async () => {
  await prisma?.client.$executeRawUnsafe('DELETE FROM attachments WHERE "assetRequestId" = $1', requestId);
  await prisma?.client.$executeRawUnsafe('DELETE FROM notifications WHERE "entityId" = $1', requestId);
  await prisma?.client.$executeRawUnsafe('DELETE FROM request_comments WHERE "requestId" = $1', requestId);
  await prisma?.client.$executeRawUnsafe('DELETE FROM request_items WHERE "requestId" = $1', requestId);
  await prisma?.client.$executeRawUnsafe('DELETE FROM request_approvals WHERE "requestId" = $1', requestId);
  await prisma?.client.$executeRawUnsafe('DELETE FROM asset_requests WHERE id = $1', requestId);
  await app?.close();
});

describe('sending a message with images', () => {
  it('a plain JSON message still works and carries an empty attachments list', async () => {
    const res = await api(app)
      .post(`/api/v1/requests/${requestId}/comments`)
      .set(auth(s.employee))
      .send({ body: 'The space bar has come off.', isInternal: false });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const comments = res.body.data.comments as Comment[];
    expect(comments.at(-1)?.body).toBe('The space bar has come off.');
    expect(comments.at(-1)?.attachments).toEqual([]);
  });

  it('a multipart message round-trips its images on the comment, sized in bytes', async () => {
    const res = await api(app)
      .post(`/api/v1/requests/${requestId}/comments`)
      .set(auth(s.employee))
      .field('body', 'Here is the damage.')
      .field('isInternal', 'false')
      .attach('images', PNG, 'keyboard-front.png')
      .attach('images', PNG, 'keyboard-side.png');
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);

    const comment = (res.body.data.comments as Comment[]).at(-1)!;
    expect(comment.body).toBe('Here is the damage.');
    expect(comment.isInternal).toBe(false);
    expect(comment.attachments.map((a) => a.originalName)).toEqual(['keyboard-front.png', 'keyboard-side.png']);
    for (const a of comment.attachments) {
      expect(a.mimeType).toBe('image/png');
      expect(a.sizeBytes).toBe(PNG.length);
      expect(a.isImage).toBe(true);
      expect(typeof a.id).toBe('string');
    }
    // They belong to the message, not to the request's attachments panel.
    expect(res.body.data.attachments).toEqual([]);
  });

  it('a photo on its own is a message; nothing at all is not', async () => {
    const photoOnly = await api(app)
      .post(`/api/v1/requests/${requestId}/comments`)
      .set(auth(s.employee))
      .field('isInternal', 'false')
      .attach('images', PNG, 'just-a-photo.png');
    expect(photoOnly.status, JSON.stringify(photoOnly.body).slice(0, 300)).toBe(201);
    expect((photoOnly.body.data.comments as Comment[]).at(-1)?.attachments).toHaveLength(1);

    const empty = await api(app)
      .post(`/api/v1/requests/${requestId}/comments`)
      .set(auth(s.employee))
      .field('body', '   ')
      .field('isInternal', 'false');
    expect(empty.status).toBe(422);
    expect(JSON.stringify(empty.body)).toMatch(/message or add a photo/i);
  });

  it('refuses a document in a message, and sends nothing when it does', async () => {
    const before = await prisma.client.requestComment.count({ where: { requestId } });
    const res = await api(app)
      .post(`/api/v1/requests/${requestId}/comments`)
      .set(auth(s.employee))
      .field('body', 'Quote attached')
      .field('isInternal', 'false')
      .attach('images', PNG, 'fine.png')
      .attach('images', PDF, 'quote.pdf');
    expect(res.status).toBe(415);
    expect(JSON.stringify(res.body)).toMatch(/only images/i);
    // Atomic: the good image did not go through without the message.
    expect(await prisma.client.requestComment.count({ where: { requestId } })).toBe(before);
    expect(await prisma.client.attachment.count({ where: { assetRequestId: requestId, originalName: 'fine.png' } })).toBe(0);
  });

  it('refuses bytes that are not an image, whatever the name says', async () => {
    const res = await api(app)
      .post(`/api/v1/requests/${requestId}/comments`)
      .set(auth(s.employee))
      .field('body', 'Look')
      .field('isInternal', 'false')
      .attach('images', Buffer.from('#!/bin/sh\nrm -rf /\n'), 'evil.png');
    expect([400, 415, 422]).toContain(res.status);
  });

  it('caps a message at six images', async () => {
    let req = api(app)
      .post(`/api/v1/requests/${requestId}/comments`)
      .set(auth(s.employee))
      .field('body', 'Too many')
      .field('isInternal', 'false');
    for (let i = 0; i < 7; i++) req = req.attach('images', PNG, `p${i}.png`);
    const res = await req;
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('the requester cannot post an internal note, with or without a picture', async () => {
    const res = await api(app)
      .post(`/api/v1/requests/${requestId}/comments`)
      .set(auth(s.employee))
      .field('body', 'Sneaky')
      .field('isInternal', 'true')
      .attach('images', PNG, 'sneaky.png');
    expect(res.status).toBe(403);
  });
});

describe('an internal note\'s image is as hidden as the note', () => {
  let internalImageId: string;
  let publicImageId: string;

  beforeAll(async () => {
    const internal = await api(app)
      .post(`/api/v1/requests/${requestId}/comments`)
      .set(auth(s.itAdmin))
      .field('body', 'Vendor screenshot - not for the requester.')
      .field('isInternal', 'true')
      .attach('images', PNG, 'vendor-portal.png');
    expect(internal.status, JSON.stringify(internal.body).slice(0, 300)).toBe(201);
    const note = (internal.body.data.comments as Comment[]).at(-1)!;
    expect(note.isInternal).toBe(true);
    internalImageId = note.attachments[0]!.id;

    const reply = await api(app)
      .post(`/api/v1/requests/${requestId}/comments`)
      .set(auth(s.itAdmin))
      .field('body', 'This is the replacement we will send.')
      .field('isInternal', 'false')
      .attach('images', PNG, 'replacement.png');
    expect(reply.status, JSON.stringify(reply.body).slice(0, 300)).toBe(201);
    publicImageId = (reply.body.data.comments as Comment[]).at(-1)!.attachments[0]!.id;
  });

  it('the requester sees the reply\'s image and no trace of the note\'s', async () => {
    const res = await detail('employee');
    expect(res.status).toBe(200);
    const comments = res.body.data.comments as Comment[];
    expect(comments.some((c) => c.isInternal)).toBe(false);
    const imageIds = comments.flatMap((c) => c.attachments.map((a) => a.id));
    expect(imageIds).toContain(publicImageId);
    expect(imageIds).not.toContain(internalImageId);
    expect(JSON.stringify(res.body)).not.toContain('vendor-portal.png');
  });

  it('the requester cannot download, link or remove the note\'s image', async () => {
    const download = await api(app)
      .get(`/api/v1/requests/${requestId}/attachments/${internalImageId}`)
      .set(auth(s.employee));
    expect(download.status).toBe(404);

    const link = await api(app)
      .post(`/api/v1/requests/${requestId}/attachments/${internalImageId}/link`)
      .set(auth(s.employee));
    expect(link.status).toBe(404);

    const remove = await api(app)
      .delete(`/api/v1/requests/${requestId}/attachments/${internalImageId}`)
      .set(auth(s.employee));
    expect(remove.status).toBe(404);
  });

  it('the requester can open the reply\'s image, directly and through a signed link', async () => {
    const download = await api(app)
      .get(`/api/v1/requests/${requestId}/attachments/${publicImageId}`)
      .set(auth(s.employee));
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('image/png');

    const link = await api(app)
      .post(`/api/v1/requests/${requestId}/attachments/${publicImageId}/link`)
      .set(auth(s.employee));
    expect(link.status).toBe(201);
    const opened = await api(app).get(`/api/v1${link.body.data.path}`);
    expect(opened.status).toBe(200);
    expect(opened.headers['content-type']).toContain('image/png');
  });

  it('a reviewer reaches the note\'s image; a stranger reaches neither', async () => {
    const reviewer = await api(app)
      .get(`/api/v1/requests/${requestId}/attachments/${internalImageId}`)
      .set(auth(s.itAdmin));
    expect(reviewer.status).toBe(200);

    for (const imageId of [internalImageId, publicImageId]) {
      const stranger = await api(app)
        .get(`/api/v1/requests/${requestId}/attachments/${imageId}`)
        .set(auth(s.employee2));
      expect(stranger.status).toBe(404);
    }
  });
});
