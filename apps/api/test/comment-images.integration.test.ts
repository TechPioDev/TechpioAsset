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

describe('pictures inline in the text (v2.61)', () => {
  it('rewrites each pending token to the id its file was stored under, in send order', async () => {
    const res = await api(app)
      .post(`/api/v1/requests/${requestId}/comments`)
      .set(auth(s.employee))
      .field('body', 'Front:\n![image 1](pending:1)\nSide:\n![image 2](pending:2)\nThanks')
      .field('isInternal', 'false')
      .attach('images', PNG, 'front.png')
      .attach('images', PNG, 'side.png');
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);

    const comment = (res.body.data.comments as Comment[]).at(-1)!;
    const [front, side] = comment.attachments;
    expect(front?.originalName).toBe('front.png');
    expect(side?.originalName).toBe('side.png');
    expect(comment.body).toBe(
      `Front:\n![image 1](attachment:${front!.id})\nSide:\n![image 2](attachment:${side!.id})\nThanks`,
    );
    expect(comment.body).not.toContain('pending:');
  });

  it('refuses a token for a picture that was not sent, and stores nothing', async () => {
    const before = await prisma.client.requestComment.count({ where: { requestId } });
    const res = await api(app)
      .post(`/api/v1/requests/${requestId}/comments`)
      .set(auth(s.employee))
      .field('body', 'One picture ![image 1](pending:1) and a missing one ![image 2](pending:2)')
      .field('isInternal', 'false')
      .attach('images', PNG, 'only-one.png');
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/image 2, which was not sent/i);
    expect(await prisma.client.requestComment.count({ where: { requestId } })).toBe(before);
    expect(await prisma.client.attachment.count({ where: { assetRequestId: requestId, originalName: 'only-one.png' } })).toBe(0);
  });

  it('a body naming an attachment directly is refused - pictures are referenced by send order only', async () => {
    const res = await api(app)
      .post(`/api/v1/requests/${requestId}/comments`)
      .set(auth(s.employee))
      .send({ body: 'See ![image 1](attachment:anyid)', isInternal: false });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/order they are sent/i);
  });

  it('a message whose pictures carry no tokens still goes through, as every installed phone build sends it', async () => {
    const res = await api(app)
      .post(`/api/v1/requests/${requestId}/comments`)
      .set(auth(s.employee))
      .field('body', 'Untokened')
      .field('isInternal', 'false')
      .attach('images', PNG, 'loose.png');
    expect(res.status).toBe(201);
    const comment = (res.body.data.comments as Comment[]).at(-1)!;
    expect(comment.body).toBe('Untokened');
    expect(comment.attachments).toHaveLength(1);
  });
});

describe('pictures attached while raising a request (v2.61)', () => {
  let draftId: string;

  afterAll(async () => {
    if (!draftId) return;
    await prisma.client.$executeRawUnsafe('DELETE FROM attachments WHERE "assetRequestId" = $1', draftId);
    await prisma.client.$executeRawUnsafe('DELETE FROM notifications WHERE "entityId" = $1', draftId);
    await prisma.client.$executeRawUnsafe('DELETE FROM request_comments WHERE "requestId" = $1', draftId);
    await prisma.client.$executeRawUnsafe('DELETE FROM request_items WHERE "requestId" = $1', draftId);
    await prisma.client.$executeRawUnsafe('DELETE FROM request_approvals WHERE "requestId" = $1', draftId);
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_requests WHERE id = $1', draftId);
  });

  it('the requester\'s first message with inline pictures lands on the DRAFT and is there after submit', async () => {
    // The web and phone forms do create -> first message -> submit, so the
    // pictures are part of the request from the moment approvers first see it.
    const created = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee))
      .send({
        type: 'DAMAGE',
        businessReason: 'Dropped the laptop; the corner is cracked and the screen flickers.',
        items: [{ description: `Laptop ${Math.random().toString(36).slice(2, 8)}`, quantity: 1 }],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    draftId = created.body.data.id;
    expect(created.body.data.status).toBe('DRAFT');

    const first = await api(app)
      .post(`/api/v1/requests/${draftId}/comments`)
      .set(auth(s.employee))
      .field('body', 'Dropped the laptop; the corner is cracked ![image 1](pending:1) and the screen flickers.')
      .field('isInternal', 'false')
      .attach('images', PNG, 'corner.png');
    expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(201);
    const comment = (first.body.data.comments as Comment[])[0]!;
    expect(comment.isInternal).toBe(false);
    expect(comment.attachments).toHaveLength(1);
    expect(comment.body).toContain(`![image 1](attachment:${comment.attachments[0]!.id})`);

    const submitted = await api(app).post(`/api/v1/requests/${draftId}/submit`).set(auth(s.employee));
    expect(submitted.status, JSON.stringify(submitted.body).slice(0, 300)).toBe(201);

    // Visible to the requester and to a reviewer, as the first message.
    for (const who of ['employee', 'itAdmin'] as const) {
      const res = await api(app).get(`/api/v1/requests/${draftId}`).set(auth(s[who]));
      expect(res.status).toBe(200);
      const comments = res.body.data.comments as Comment[];
      expect(comments[0]?.id).toBe(comment.id);
      expect(comments[0]?.attachments[0]?.originalName).toBe('corner.png');
    }
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

  it('a public message cannot point at the note\'s image by id, so the requester never sees that id', async () => {
    const crafted = await api(app)
      .post(`/api/v1/requests/${requestId}/comments`)
      .set(auth(s.itAdmin))
      .send({ body: `Look here ![image 1](attachment:${internalImageId})`, isInternal: false });
    expect(crafted.status).toBe(422);
    expect(JSON.stringify(crafted.body)).toMatch(/order they are sent/i);

    const res = await detail('employee');
    expect(res.status).toBe(200);
    const publicComments = (res.body.data.comments as Comment[]).filter((c) => !c.isInternal);
    expect(publicComments.length).toBeGreaterThan(0);
    for (const c of publicComments) {
      expect(c.body).not.toContain(internalImageId);
      expect(c.attachments.map((a) => a.id)).not.toContain(internalImageId);
    }
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
