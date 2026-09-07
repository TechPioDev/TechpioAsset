import { describe, expect, it } from 'vitest';
import {
  compareField,
  compareOffer,
  rankOffers,
  type Requirement,
  type SpecFieldDefinition,
} from './vendor-comparison';

const ram: SpecFieldDefinition = {
  key: 'ram_gb',
  label: 'RAM',
  dataType: 'NUMBER',
  unit: 'GB',
  intent: 'AT_LEAST',
};
const weight: SpecFieldDefinition = {
  key: 'weight_kg',
  label: 'Weight',
  dataType: 'NUMBER',
  unit: 'kg',
  intent: 'AT_MOST',
};
const os: SpecFieldDefinition = { key: 'os', label: 'Operating system', dataType: 'TEXT' };
const backlit: SpecFieldDefinition = { key: 'backlit', label: 'Backlit keyboard', dataType: 'BOOLEAN' };

const need = (key: string, value: string, mandatory = false): Requirement => ({ key, value, mandatory });

describe('numeric requirements', () => {
  it('passes when the offer meets or beats "at least"', () => {
    expect(compareField(ram, need('ram_gb', '16'), { ram_gb: '16 GB' }).outcome).toBe('PASS');
    expect(compareField(ram, need('ram_gb', '16'), { ram_gb: '32 GB' }).outcome).toBe('PASS');
  });

  it('says so when an offer exceeds the requirement', () => {
    expect(compareField(ram, need('ram_gb', '16'), { ram_gb: '32 GB' }).reason).toContain('Exceeds');
  });

  it('treats a small shortfall as a judgement call, not an acceptance', () => {
    // 15 against 16 is inside the default 10%: a person decides, the system does not.
    expect(compareField(ram, need('ram_gb', '16'), { ram_gb: '15 GB' }).outcome).toBe('PARTIAL');
  });

  it('fails a shortfall outside tolerance', () => {
    expect(compareField(ram, need('ram_gb', '16'), { ram_gb: '8 GB' }).outcome).toBe('FAIL');
  });

  it('honours a tolerance set on the template', () => {
    const strict = { ...ram, tolerance: 0 };
    expect(compareField(strict, need('ram_gb', '16'), { ram_gb: '15 GB' }).outcome).toBe('FAIL');
  });

  it('reads "at most" the other way round, so a limit is not inverted', () => {
    expect(compareField(weight, need('weight_kg', '1.5'), { weight_kg: '1.2 kg' }).outcome).toBe('PASS');
    expect(compareField(weight, need('weight_kg', '1.5'), { weight_kg: '2.4 kg' }).outcome).toBe('FAIL');
  });

  it('pulls the number out of a written value', () => {
    expect(compareField(ram, need('ram_gb', '16 GB'), { ram_gb: '32GB DDR5' }).outcome).toBe('PASS');
  });

  it('handles thousands separators', () => {
    const storage: SpecFieldDefinition = { key: 's', label: 'Storage', dataType: 'NUMBER', unit: 'GB' };
    expect(compareField(storage, need('s', '512'), { s: '1,024 GB' }).outcome).toBe('PASS');
  });

  it('falls back to comparing words when neither side is a number', () => {
    expect(compareField(ram, need('ram_gb', 'varies'), { ram_gb: 'varies' }).outcome).toBe('PASS');
    expect(compareField(ram, need('ram_gb', 'varies'), { ram_gb: 'unknown' }).outcome).toBe('FAIL');
  });

  it('compares exact requirements without inventing a match', () => {
    const exact = { ...ram, intent: 'EXACTLY' as const };
    expect(compareField(exact, need('ram_gb', '16'), { ram_gb: '16' }).outcome).toBe('PASS');
    // Inside the default 10% drift either way, so a person looks at it.
    expect(compareField(exact, need('ram_gb', '16'), { ram_gb: '17' }).outcome).toBe('PARTIAL');
    expect(compareField(exact, need('ram_gb', '16'), { ram_gb: '32' }).outcome).toBe('FAIL');
  });
});

describe('text and yes/no requirements', () => {
  it('matches ignoring case and spacing', () => {
    expect(compareField(os, need('os', 'Windows 11 Pro'), { os: ' windows 11 pro ' }).outcome).toBe('PASS');
  });

  it('marks a superset as partial rather than passing it outright', () => {
    expect(compareField(os, need('os', 'Windows 11'), { os: 'Windows 11 Pro' }).outcome).toBe('PARTIAL');
  });

  it('fails something unrelated', () => {
    expect(compareField(os, need('os', 'Windows 11'), { os: 'Ubuntu 24.04' }).outcome).toBe('FAIL');
  });

  it('reads the usual ways of writing yes and no', () => {
    expect(compareField(backlit, need('backlit', 'yes'), { backlit: 'Yes' }).outcome).toBe('PASS');
    expect(compareField(backlit, need('backlit', 'yes'), { backlit: 'included' }).outcome).toBe('PASS');
    expect(compareField(backlit, need('backlit', 'yes'), { backlit: 'no' }).outcome).toBe('FAIL');
  });

  it('refuses to guess at a yes/no it cannot read', () => {
    const r = compareField(backlit, need('backlit', 'yes'), { backlit: 'optional extra' });
    expect(r.outcome).toBe('FAIL');
    expect(r.reason).toContain('Cannot read');
  });
});

describe('missing data', () => {
  it('fails a specification the vendor never filled in, and says so', () => {
    const r = compareField(ram, need('ram_gb', '16'), {});
    expect(r.outcome).toBe('FAIL');
    // The distinction matters: "worse than asked" and "nobody said" are not the
    // same thing, and a buyer must not see a tick for a claim nobody made.
    expect(r.reason).toBe('Not stated by the vendor');
    expect(r.offered).toBeNull();
  });

  it('treats an empty string as not stated', () => {
    expect(compareField(ram, need('ram_gb', '16'), { ram_gb: '   ' }).outcome).toBe('FAIL');
  });

  it('fails when the offer has no specifications at all', () => {
    expect(compareField(ram, need('ram_gb', '16'), null).outcome).toBe('FAIL');
  });
});

describe('a whole offer', () => {
  const fields = [ram, os, backlit];
  const requirements = [need('ram_gb', '16', true), need('os', 'Windows 11'), need('backlit', 'yes')];

  it('counts each outcome', () => {
    const r = compareOffer(fields, requirements, { ram_gb: '32', os: 'Windows 11 Pro', backlit: 'no' });
    expect(r.passed).toBe(1);
    expect(r.partial).toBe(1);
    expect(r.failed).toBe(1);
  });

  it('reports a mandatory requirement that did not pass outright', () => {
    const partial = compareOffer(fields, requirements, { ram_gb: '15', os: 'Windows 11', backlit: 'yes' });
    expect(partial.meetsMandatory).toBe(false);
    const met = compareOffer(fields, requirements, { ram_gb: '16', os: 'Windows 11', backlit: 'yes' });
    expect(met.meetsMandatory).toBe(true);
  });

  it('skips a requirement the template no longer asks about', () => {
    const r = compareOffer([ram], [need('ram_gb', '16'), need('gone', 'x')], { ram_gb: '16' });
    expect(r.fields).toHaveLength(1);
  });
});

describe('ranking', () => {
  const offer = (id: string, landedCost: number, specs: Record<string, string>) => ({
    id,
    landedCost,
    comparison: compareOffer([ram], [need('ram_gb', '16', true)], specs),
  });

  it('puts an offer that misses a mandatory requirement below one that meets it, however cheap', () => {
    const ranked = rankOffers([offer('cheap', 40000, { ram_gb: '8' }), offer('right', 90000, { ram_gb: '16' })]);
    expect(ranked[0]!.id).toBe('right');
  });

  it('uses price only once the specification is equal', () => {
    const ranked = rankOffers([offer('dear', 99000, { ram_gb: '16' }), offer('cheap', 88000, { ram_gb: '16' })]);
    expect(ranked[0]!.id).toBe('cheap');
  });

  it('is stable when everything ties', () => {
    const a = offer('aaa', 50000, { ram_gb: '16' });
    const b = offer('bbb', 50000, { ram_gb: '16' });
    expect(rankOffers([b, a]).map((o) => o.id)).toEqual(['aaa', 'bbb']);
  });

  it('does not modify the array it was given', () => {
    const list = [offer('b', 2, { ram_gb: '16' }), offer('a', 1, { ram_gb: '16' })];
    rankOffers(list);
    expect(list.map((o) => o.id)).toEqual(['b', 'a']);
  });
});
