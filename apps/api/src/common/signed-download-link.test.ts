import { describe, expect, it } from 'vitest';
import { signDownloadLink, verifyDownloadLink } from './signed-download-link.js';

/**
 * A 32-byte MAC is 43 base64url characters, and the last one carries two bits
 * nothing reads - so four characters decode to the same bytes. An integration
 * test that "tampered" by swapping A for B there passed as genuine about one
 * run in sixteen. Only the exact signature text may be accepted.
 */

const SECRET = 'x'.repeat(40);
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

describe('signed download links', () => {
  it('accepts exactly one spelling of a signature', () => {
    const { token } = signDownloadLink(SECRET, 'invoice-document-link', {
      fileId: 'doc1',
      companyId: 'co1',
    });
    const [payload, signature] = token.split('.') as [string, string];
    expect(signature).toHaveLength(43);

    const accepted = [...ALPHABET].filter((ch) => {
      try {
        verifyDownloadLink(SECRET, 'invoice-document-link', `${payload}.${signature.slice(0, -1)}${ch}`, 'Document');
        return true;
      } catch {
        return false;
      }
    });
    expect(accepted).toEqual([signature.slice(-1)]);
  });

  it('refuses a link signed for the other kind of file', () => {
    const { token } = signDownloadLink(SECRET, 'request-attachment-link', {
      fileId: 'a1',
      companyId: 'co1',
    });
    expect(() => verifyDownloadLink(SECRET, 'invoice-document-link', token, 'Document')).toThrow();
    expect(verifyDownloadLink(SECRET, 'request-attachment-link', token, 'Attachment')).toEqual({
      fileId: 'a1',
      companyId: 'co1',
    });
  });
});
