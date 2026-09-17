import { describe, expect, it } from 'vitest';
import {
  buildMessageBody,
  composeMessageBody,
  imageToken,
  parseMessageBody,
  pendingImageIndexes,
  referencedAttachmentIds,
  resolvePendingImages,
  stripImageTokens,
} from './message-body';

describe('message body - inline image tokens', () => {
  it('a message without tokens is one text segment, unchanged', () => {
    expect(parseMessageBody('The space bar has come off.')).toEqual([
      { kind: 'text', text: 'The space bar has come off.' },
    ]);
    expect(parseMessageBody('')).toEqual([]);
  });

  it('splits text and pictures in reading order, pending and stored alike', () => {
    const body = 'Front:\n![image 1](pending:1)\nand side ![image 2](attachment:cm1abc_-9) done';
    expect(parseMessageBody(body)).toEqual([
      { kind: 'text', text: 'Front:\n' },
      { kind: 'image', number: 1, ref: { kind: 'pending', index: 1 } },
      { kind: 'text', text: '\nand side ' },
      { kind: 'image', number: 2, ref: { kind: 'attachment', id: 'cm1abc_-9' } },
      { kind: 'text', text: ' done' },
    ]);
    expect(buildMessageBody(parseMessageBody(body))).toBe(body);
  });

  it('leaves look-alikes as text: other schemes, HTML, markdown links', () => {
    for (const text of [
      '![image 1](http://evil/x.png)',
      '<img src="x">',
      '[image 1](pending:1)',
      '![image one](pending:1)',
      '![image 1](pending:)',
    ]) {
      expect(parseMessageBody(text)).toEqual([{ kind: 'text', text }]);
    }
  });

  it('writes the token the parser reads', () => {
    expect(imageToken(3, { kind: 'pending', index: 3 })).toBe('![image 3](pending:3)');
    expect(imageToken(1, { kind: 'attachment', id: 'abc' })).toBe('![image 1](attachment:abc)');
  });

  it('strips tokens to leave the words', () => {
    expect(stripImageTokens('See ![image 1](pending:1) here')).toBe('See  here');
    expect(stripImageTokens('![image 1](pending:1)')).toBe('');
  });

  it('lists the pending indexes and the attachment ids it points at, once each', () => {
    const body = '![image 2](pending:2) ![image 1](pending:1) ![image 2](pending:2) ![image 3](attachment:a1) ![image 3](attachment:a1)';
    expect(pendingImageIndexes(body)).toEqual([2, 1]);
    expect(referencedAttachmentIds(body)).toEqual(['a1']);
  });

  it('resolves pending tokens to the ids the files were stored under', () => {
    const out = resolvePendingImages('a ![image 1](pending:1) b ![image 2](pending:2)', ['idA', 'idB']);
    expect(out).toEqual({ ok: true, body: 'a ![image 1](attachment:idA) b ![image 2](attachment:idB)' });
    // Files sent without a token are fine: the reader appends them.
    expect(resolvePendingImages('no tokens', ['idA'])).toEqual({ ok: true, body: 'no tokens' });
  });

  it('refuses a token for a file that was not sent', () => {
    expect(resolvePendingImages('![image 2](pending:2)', ['idA'])).toEqual({ ok: false, reason: 'dangling', index: 2 });
    expect(resolvePendingImages('![image 0](pending:0)', ['idA'])).toEqual({ ok: false, reason: 'dangling', index: 0 });
    expect(resolvePendingImages('![image 1](pending:1)', [])).toEqual({ ok: false, reason: 'dangling', index: 1 });
  });

  it('refuses a body that names an attachment directly on the way in', () => {
    expect(resolvePendingImages('![image 1](attachment:someoneElses)', ['idA'])).toEqual({ ok: false, reason: 'foreign' });
  });

  it('composes the outgoing body from the editor, numbering by appearance and dropping removed pictures', () => {
    const body = composeMessageBody(
      [
        { kind: 'text', text: 'Front ' },
        { kind: 'image', key: 'kB' },
        { kind: 'text', text: ' side ' },
        { kind: 'image', key: 'gone' },
        { kind: 'image', key: 'kA' },
      ],
      ['kB', 'kA'],
    );
    expect(body).toBe('Front ![image 1](pending:1) side ![image 2](pending:2)');
  });
});
