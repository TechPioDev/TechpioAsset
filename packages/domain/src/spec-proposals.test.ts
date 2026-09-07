import { describe, expect, it } from 'vitest';
import {
  isWorthAsking,
  normalizeSpecLabel,
  PROPOSAL_SIGNAL_THRESHOLD,
  proposedSpecsProblem,
} from './spec-proposals';

describe('grouping what suppliers volunteer', () => {
  it('brings three spellings of the same thing together', () => {
    // The entire point: noticing that these are one field, not three.
    const written = ['NPU TOPS', 'npu (tops)', 'NPU  Tops'];
    const keys = new Set(written.map(normalizeSpecLabel));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('npu_tops');
  });

  it('produces a key a template could use as-is', () => {
    expect(normalizeSpecLabel('Battery chemistry')).toBe('battery_chemistry');
    expect(normalizeSpecLabel('  Screen size (inch) ')).toBe('screen_size_inch');
  });

  it('keeps a leading digit from producing an unusable key', () => {
    expect(normalizeSpecLabel('5G modem')).toBe('f5g_modem');
  });

  it('returns nothing usable for a label with no letters or digits', () => {
    expect(normalizeSpecLabel('—')).toBe('');
  });
});

describe('what cannot be saved', () => {
  const ok = [{ label: 'NPU TOPS', value: '45' }];

  it('accepts a reasonable list', () => {
    expect(proposedSpecsProblem(ok)).toBeNull();
  });

  it('refuses a value-less entry rather than storing a name with no fact', () => {
    expect(proposedSpecsProblem([{ label: 'NPU TOPS', value: '  ' }])).toContain('Give a value');
  });

  it('refuses a nameless entry', () => {
    expect(proposedSpecsProblem([{ label: ' ', value: '45' }])).toContain('needs a name');
  });

  it('refuses the same thing twice, however it was spelled', () => {
    const problem = proposedSpecsProblem([
      { label: 'NPU TOPS', value: '45' },
      { label: 'npu tops', value: '50' },
    ]);
    expect(problem).toContain('listed twice');
  });

  it('refuses something the template already asks for', () => {
    // Otherwise the same fact sits on the offer twice - once compared, once
    // not - and the two are free to disagree.
    const problem = proposedSpecsProblem([{ label: 'RAM', value: '32' }], ['ram']);
    expect(problem).toContain('already asked for');
  });

  it('caps the list, so it cannot become somewhere to paste a brochure', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ label: `Field ${i}`, value: 'x' }));
    expect(proposedSpecsProblem(many)).toContain('At most');
  });
});

describe('when it is worth asking everybody', () => {
  it('ignores one supplier volunteering something', () => {
    // One supplier doing this is that supplier's marketing.
    expect(isWorthAsking({ vendorCount: 1 })).toBe(false);
  });

  it('flags it once enough suppliers agree independently', () => {
    expect(isWorthAsking({ vendorCount: PROPOSAL_SIGNAL_THRESHOLD })).toBe(true);
    expect(isWorthAsking({ vendorCount: PROPOSAL_SIGNAL_THRESHOLD + 4 })).toBe(true);
  });
});
