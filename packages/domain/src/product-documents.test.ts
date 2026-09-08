import { describe, expect, it } from 'vitest';
import {
  PRODUCT_DOCUMENT_KINDS,
  PRODUCT_DOCUMENT_LABELS,
  PRODUCT_DOCUMENT_RULES,
  documentSetProblem,
  documentTitle,
} from './product-documents';

describe('product paperwork', () => {
  it('names every kind it offers', () => {
    for (const kind of PRODUCT_DOCUMENT_KINDS) {
      expect(PRODUCT_DOCUMENT_LABELS[kind], kind).toBeTruthy();
    }
  });

  it('takes PDF and pictures, and refuses Office files', () => {
    // A supplier's .docx is a zip that can carry macros, and it arrives from
    // outside the company by definition. They can print to PDF; a buyer cannot
    // un-run a macro.
    expect(PRODUCT_DOCUMENT_RULES.mimes).toContain('application/pdf');
    expect(PRODUCT_DOCUMENT_RULES.mimes).toContain('image/jpeg');
    expect(PRODUCT_DOCUMENT_RULES.mimes).not.toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(PRODUCT_DOCUMENT_RULES.mimes).not.toContain('application/vnd.ms-excel');
  });

  it('stops at the ceiling and not before it', () => {
    expect(documentSetProblem(PRODUCT_DOCUMENT_RULES.max - 1)).toBeNull();
    expect(documentSetProblem(PRODUCT_DOCUMENT_RULES.max)).toMatch(/at most 10/);
  });

  it('falls back to the kind, never to the file name', () => {
    // "scan_0001.pdf" tells a buyer nothing about whether to open it.
    expect(documentTitle({ kind: 'COMPLIANCE_CERTIFICATE' })).toBe('Compliance certificate');
    expect(documentTitle({ title: '   ', kind: 'DATASHEET' })).toBe('Datasheet');
    expect(documentTitle({ title: 'Latitude 5420 datasheet', kind: 'DATASHEET' })).toBe(
      'Latitude 5420 datasheet',
    );
  });
});
