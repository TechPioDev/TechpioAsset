import { describe, expect, it } from 'vitest';
import { formatFileSize } from './file-size';

describe('formatFileSize', () => {
  it('reads in KB below a megabyte, as asked - never bytes', () => {
    expect(formatFileSize(342 * 1024)).toBe('342 KB');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(512)).toBe('1 KB');
    expect(formatFileSize(1)).toBe('1 KB');
    expect(formatFileSize(1024 * 1024 - 1)).toBe('1024 KB');
  });

  it('reads in MB with one decimal from a megabyte up', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(1.25 * 1024 * 1024)).toBe('1.3 MB');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatFileSize(24.9 * 1024 * 1024)).toBe('24.9 MB');
  });

  it('never throws on an empty or nonsense size', () => {
    expect(formatFileSize(0)).toBe('0 KB');
    expect(formatFileSize(-5)).toBe('0 KB');
    expect(formatFileSize(Number.NaN)).toBe('0 KB');
  });
});
