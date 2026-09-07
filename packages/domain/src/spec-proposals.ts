/**
 * Specifications suppliers offer that nobody asked for (v2.44).
 *
 * A template can only ask what the buyer already thought to ask. When something
 * new arrives - an NPU, a battery chemistry, a certification that did not exist
 * last year - a supplier has no box to put it in, and the catalogue quietly
 * stays a year behind the market.
 *
 * So a supplier may attach extra label/value pairs to an offer. They are
 * recorded and shown, never compared, and never required: a value nobody asked
 * for cannot be allowed to decide a purchase. Internal staff promote one into
 * the template when it proves worth asking, which keeps the rule that matters -
 * a supplier never sets the questions it is marked on.
 */

/**
 * The grouping key for a freely typed label.
 *
 * Three suppliers will write "NPU TOPS", "npu (tops)" and "NPU  Tops" for the
 * same thing, and the whole value of collecting these is noticing that they
 * are the same thing. Deliberately the same shape as a template key, so
 * promoting one needs no translation.
 */
export function normalizeSpecLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, 'f$1')
    .slice(0, 60);
}

/**
 * How many different suppliers have to offer the same thing before it is worth
 * an administrator's attention.
 *
 * One supplier volunteering a field is that supplier's marketing. Three
 * independently deciding it matters is the market telling you your template is
 * out of date - which is the signal this whole feature exists to produce.
 */
export const PROPOSAL_SIGNAL_THRESHOLD = 3;

export const PROPOSED_SPECS_PER_OFFER = 10;

export interface ProposedSpecInput {
  label: string;
  value: string;
}

/**
 * Why these proposals cannot be saved, or null.
 *
 * The cap exists because this is a free-text field on a commercial listing;
 * without one it becomes somewhere to paste a brochure.
 */
export function proposedSpecsProblem(
  proposals: ProposedSpecInput[],
  templateKeys: readonly string[] = [],
): string | null {
  if (proposals.length > PROPOSED_SPECS_PER_OFFER) {
    return `At most ${PROPOSED_SPECS_PER_OFFER} extra specifications per offer`;
  }

  const seen = new Set<string>();
  const asked = new Set(templateKeys);

  for (const proposal of proposals) {
    const label = proposal.label.trim();
    if (!label) return 'Every extra specification needs a name';
    if (!proposal.value.trim()) return `Give a value for "${label}", or remove it`;

    const key = normalizeSpecLabel(label);
    if (!key) return `"${label}" is not a usable name`;

    if (asked.has(key)) {
      // Otherwise the same fact exists twice on one offer - once compared and
      // once not - and the two can disagree.
      return `"${label}" is already asked for above; fill it in there instead`;
    }
    if (seen.has(key)) return `"${label}" is listed twice`;
    seen.add(key);
  }
  return null;
}

export interface ProposalGroup {
  key: string;
  label: string;
  vendorCount: number;
}

/** True when enough different suppliers offer it to be worth asking everybody. */
export function isWorthAsking(group: { vendorCount: number }): boolean {
  return group.vendorCount >= PROPOSAL_SIGNAL_THRESHOLD;
}
