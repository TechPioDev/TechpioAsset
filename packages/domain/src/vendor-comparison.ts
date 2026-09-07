/**
 * Comparing offers against what was actually asked for (v2.42).
 *
 * Deterministic arithmetic, deliberately: a buyer defending a purchase to
 * finance has to be able to reproduce the number by hand. Nothing here consults
 * a model, and nothing here is allowed to. The same rule applies to the money -
 * see calculateLandedCost.
 *
 * The output is per requirement, not a single score. A single number hides which
 * requirement the cheap option fails, and that is usually the thing worth
 * knowing.
 */

/** How a field is compared. Set on the category's spec template. */
export type SpecFieldType = 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'ENUM';

/**
 * How a numeric requirement should be read.
 *
 * "16 GB of RAM" almost always means "at least"; "1.4 kg" almost always means
 * "at most". Guessing from the field name is how a comparison quietly inverts,
 * so the template states it.
 */
export type NumericIntent = 'AT_LEAST' | 'AT_MOST' | 'EXACTLY';

export type MatchOutcome = 'PASS' | 'PARTIAL' | 'FAIL';

export interface SpecFieldDefinition {
  key: string;
  label: string;
  dataType: SpecFieldType;
  unit?: string | null;
  intent?: NumericIntent | null;
  /**
   * How far below (AT_LEAST) or above (AT_MOST) the asked-for figure still
   * counts as a partial match, as a fraction. 0.1 = within 10%.
   */
  tolerance?: number | null;
}

export interface Requirement {
  key: string;
  /** What was asked for. Compared as written; never parsed as a formula. */
  value: string;
  /** A requirement that must pass for the offer to be usable at all. */
  mandatory?: boolean;
}

export interface FieldComparison {
  key: string;
  label: string;
  required: string;
  offered: string | null;
  outcome: MatchOutcome;
  /** Plain English, shown next to the result. */
  reason: string;
  mandatory: boolean;
}

/** Tolerance used when a template does not set one. */
export const DEFAULT_NUMERIC_TOLERANCE = 0.1;

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'available', 'included']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'none', 'not included']);

/** The leading number in a value like "16 GB" or "1.4kg". */
function leadingNumber(raw: string): number | null {
  const match = raw.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function normalise(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

function asBoolean(raw: string): boolean | null {
  const v = normalise(raw);
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return null;
}

function compareNumeric(
  field: SpecFieldDefinition,
  requiredRaw: string,
  offeredRaw: string,
): { outcome: MatchOutcome; reason: string } {
  const required = leadingNumber(requiredRaw);
  const offered = leadingNumber(offeredRaw);
  const unit = field.unit ? ` ${field.unit}` : '';

  if (required === null || offered === null) {
    // One side is not a number at all, so fall back to comparing the words.
    // Better than inventing a numeric verdict from something like "varies".
    return normalise(requiredRaw) === normalise(offeredRaw)
      ? { outcome: 'PASS', reason: 'Matches exactly' }
      : { outcome: 'FAIL', reason: `Asked for ${requiredRaw}, offered ${offeredRaw}` };
  }

  const intent = field.intent ?? 'AT_LEAST';
  const tolerance =
    field.tolerance !== null && field.tolerance !== undefined && field.tolerance >= 0
      ? field.tolerance
      : DEFAULT_NUMERIC_TOLERANCE;

  if (intent === 'EXACTLY') {
    if (offered === required) return { outcome: 'PASS', reason: 'Matches exactly' };
    const drift = required === 0 ? Infinity : Math.abs(offered - required) / Math.abs(required);
    return drift <= tolerance
      ? { outcome: 'PARTIAL', reason: `Close: ${offered}${unit} against ${required}${unit}` }
      : { outcome: 'FAIL', reason: `Asked for exactly ${required}${unit}, offered ${offered}${unit}` };
  }

  const meets = intent === 'AT_LEAST' ? offered >= required : offered <= required;
  if (meets) {
    const better = intent === 'AT_LEAST' ? offered > required : offered < required;
    return {
      outcome: 'PASS',
      reason: better ? `Exceeds: ${offered}${unit} against ${required}${unit}` : 'Meets the requirement',
    };
  }

  // Short of the mark. Within tolerance it is a judgement call for a person,
  // which is what PARTIAL means here - never an automatic acceptance.
  const shortfall = required === 0 ? Infinity : Math.abs(offered - required) / Math.abs(required);
  if (shortfall <= tolerance) {
    return {
      outcome: 'PARTIAL',
      reason:
        intent === 'AT_LEAST'
          ? `Slightly under: ${offered}${unit} against ${required}${unit}`
          : `Slightly over: ${offered}${unit} against ${required}${unit}`,
    };
  }
  return {
    outcome: 'FAIL',
    reason:
      intent === 'AT_LEAST'
        ? `Under the requirement: ${offered}${unit} against ${required}${unit}`
        : `Over the limit: ${offered}${unit} against ${required}${unit}`,
  };
}

/**
 * One requirement against one offer.
 *
 * A specification the vendor never filled in is a FAIL, not a PARTIAL. A buyer
 * must never see a half-tick for a claim nobody made - the reason says "not
 * stated" so the difference between "worse" and "unknown" stays visible.
 */
export function compareField(
  field: SpecFieldDefinition,
  requirement: Requirement,
  offeredSpecs: Record<string, string> | null | undefined,
): FieldComparison {
  const offeredRaw = offeredSpecs?.[field.key];
  const base = {
    key: field.key,
    label: field.label,
    required: requirement.value,
    mandatory: requirement.mandatory ?? false,
  };

  if (offeredRaw === undefined || offeredRaw === null || offeredRaw.trim() === '') {
    return { ...base, offered: null, outcome: 'FAIL', reason: 'Not stated by the vendor' };
  }

  const offered = offeredRaw.trim();

  if (field.dataType === 'NUMBER') {
    return { ...base, offered, ...compareNumeric(field, requirement.value, offered) };
  }

  if (field.dataType === 'BOOLEAN') {
    const want = asBoolean(requirement.value);
    const got = asBoolean(offered);
    if (want === null || got === null) {
      return { ...base, offered, outcome: 'FAIL', reason: `Cannot read "${offered}" as yes or no` };
    }
    return want === got
      ? { ...base, offered, outcome: 'PASS', reason: want ? 'Included' : 'Correctly not included' }
      : { ...base, offered, outcome: 'FAIL', reason: want ? 'Not included' : 'Included when it should not be' };
  }

  // TEXT and ENUM. An offer that contains the asked-for term among others -
  // "Windows 11 Pro" against "Windows 11" - is a partial match a person should
  // look at, not an automatic pass.
  const want = normalise(requirement.value);
  const got = normalise(offered);
  if (want === got) return { ...base, offered, outcome: 'PASS', reason: 'Matches exactly' };
  if (got.includes(want)) {
    return { ...base, offered, outcome: 'PARTIAL', reason: `Offered "${offered}", which covers it` };
  }
  return { ...base, offered, outcome: 'FAIL', reason: `Asked for "${requirement.value}"` };
}

export interface OfferComparison {
  fields: FieldComparison[];
  passed: number;
  partial: number;
  failed: number;
  /** False when any requirement marked mandatory did not pass outright. */
  meetsMandatory: boolean;
}

/**
 * Every requirement against one offer.
 *
 * A requirement with no matching field in the template is skipped rather than
 * failed: the template moved on, and an offer should not be marked down for a
 * question the catalogue no longer asks.
 */
export function compareOffer(
  fields: SpecFieldDefinition[],
  requirements: Requirement[],
  offeredSpecs: Record<string, string> | null | undefined,
): OfferComparison {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const results: FieldComparison[] = [];
  for (const requirement of requirements) {
    const field = byKey.get(requirement.key);
    if (!field) continue;
    results.push(compareField(field, requirement, offeredSpecs));
  }
  return {
    fields: results,
    passed: results.filter((r) => r.outcome === 'PASS').length,
    partial: results.filter((r) => r.outcome === 'PARTIAL').length,
    failed: results.filter((r) => r.outcome === 'FAIL').length,
    meetsMandatory: results.every((r) => !r.mandatory || r.outcome === 'PASS'),
  };
}

/**
 * Rank offers that a person is choosing between.
 *
 * Mandatory requirements first, then how much of the specification is met, then
 * price. Price is the last tie-breaker on purpose: sorting by price first is how
 * a comparison turns into a cheapest-wins list, which is the thing the spec asks
 * the buyer to justify against.
 *
 * The score is internal. It is never shown to a vendor - a supplier learning how
 * it scored against a competitor is the competitor's information, not its own.
 */
export function rankOffers<T extends { id: string; landedCost: number; comparison: OfferComparison }>(
  offers: T[],
): T[] {
  return [...offers].sort((a, b) => {
    if (a.comparison.meetsMandatory !== b.comparison.meetsMandatory) {
      return a.comparison.meetsMandatory ? -1 : 1;
    }
    if (a.comparison.failed !== b.comparison.failed) return a.comparison.failed - b.comparison.failed;
    if (a.comparison.passed !== b.comparison.passed) return b.comparison.passed - a.comparison.passed;
    if (a.landedCost !== b.landedCost) return a.landedCost - b.landedCost;
    // Stable and reproducible when everything else ties.
    return a.id.localeCompare(b.id);
  });
}
