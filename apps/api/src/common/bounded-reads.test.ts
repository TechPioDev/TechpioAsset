import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * v2.10 S2 — the rule, enforced.
 *
 * An unbounded `findMany` on a table that grows with a customer's data is
 * invisible at demo scale and a multi-megabyte response at real scale. The
 * v2.10 baseline found `/stock/levels` returning 589 KB for 2,000 rows.
 *
 * This test is the reason that cannot quietly come back. Every unbounded query
 * on a tenant-scaled model must either be fixed or listed below WITH A REASON.
 * Adding a line to the allowlist is a deliberate act that shows up in review;
 * forgetting a `take:` is not.
 *
 * It scans source rather than behaviour on purpose: the same shape as
 * `model-policy.test.ts`, which catches a new soft-deletable model the same way.
 */

/**
 * Models whose row count grows with what a customer does. A cap on a seven-row
 * category table is noise; a cap on assets is the entire point.
 */
const TENANT_SCALED = new Set([
  'asset',
  'auditLog',
  'stockMovement',
  'stockLevel',
  'stockBatch',
  'inventoryItem',
  'user',
  'notification',
  'purchaseRequest',
  'purchaseOrder',
  'goodsReceipt',
  'quote',
  'quoteRequest',
  'assetAssignment',
  'maintenanceRecord',
  'discoveredDevice',
  'invoice',
  'assetRequest',
  'licenseAssignment',
  'softwareLicense',
  'budget',
  'costCentre',
  'attachment',
  // v2.12: a row per login AND per rotation, kept until expiry. The session
  // list shipped unbounded and a single test-tenant account had 3,252 live
  // rows - exactly the shape this guard exists to catch, missing only because
  // the model was never listed here.
  'refreshToken',
]);

/**
 * Known unbounded reads, each with why it is acceptable *today*.
 *
 * Every entry here is an aggregate: it loads rows to compute a number rather
 * than to return them. Capping one would not make a response smaller, it would
 * make an ANSWER WRONG — which is why they are excluded from S2 rather than
 * "fixed". The correct fix is to do the arithmetic in SQL, which is S4's work,
 * and `/analytics/spend` at 2798 ms p95 in the baseline is the evidence.
 */
const ALLOWED: Record<string, string> = {
  'analytics/analytics.service.ts': 'aggregates: sums and groupings computed in JS — S4 moves them into SQL',
  'asset-health/asset-health.service.ts': 'health sweep scores every asset; bounded by the sweep, not a response',
  'budgets/budgets.service.ts': 'consumption report aggregates budgets for a single day; commitments per budget',
  'discovery/discovery.service.ts': 'reconciliation compares the whole inbound batch against candidates',
  'integrations/m365-license-sync.service.ts':
    'the sync must see every Microsoft-synced licence to know which to retire; bounded by the SKUs one tenant buys (tens), and a cut-off list would retire real licences',
  'invoices/invoices.service.ts': 'three-way match reads an invoice’s own lines and their assets',
  'licenses/licenses.service.ts': 'seat reconciliation counts assignments for one licence',
  'procurement/procurement.service.ts': 'PO rollup reads the lines of a single purchase order',
  'procurement/rfq.service.ts': 'an RFQ’s own quotes — bounded by vendors invited, not by tenant size',
  'reports/reports.service.ts': 'report generation reads the rows it is reporting on — S5 makes it stream',
  'scheduled/alert-sweep.service.ts': 'nightly sweeps walk their whole working set — S3 bounds them',
  'stock/stock.service.ts': 'issue planning reads the lots at one item/location pair',
};

function serviceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...serviceFiles(full));
    else if (entry.endsWith('.service.ts')) out.push(full);
  }
  return out;
}

/** Everything between `findMany({` and its matching brace. */
function callBody(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  return source.slice(from);
}

interface Unbounded {
  file: string;
  line: number;
  model: string;
}

function findUnbounded(): Unbounded[] {
  const root = path.resolve(import.meta.dirname, '..');
  const found: Unbounded[] = [];
  for (const file of serviceFiles(root)) {
    const source = readFileSync(file, 'utf8');
    const pattern = /(?:tx|this\.prisma\.client)\.(\w+)\.findMany\(/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const model = match[1]!;
      if (!TENANT_SCALED.has(model)) continue;
      const body = callBody(source, source.indexOf('{', match.index));
      // A bound is `take: 500` OR the shorthand `take,` that `paginate()` hands
      // its callback. Matching only `take:` flagged the six best-paginated
      // services in the codebase — and the tempting way to silence that is to
      // allowlist them, which would exempt exactly the code doing it right. A
      // guard that cries wolf is how an allowlist fills up with good code.
      if (/\btake\s*[,:]/.test(body)) continue;
      found.push({
        file: path.relative(root, file).replaceAll('\\', '/'),
        line: source.slice(0, match.index).split('\n').length,
        model,
      });
    }
  }
  return found;
}

describe('bounded reads on tenant-scaled tables', () => {
  it('has no unbounded query outside the documented allowlist', () => {
    const offenders = findUnbounded().filter((u) => !(u.file in ALLOWED));
    expect(
      offenders,
      offenders.length
        ? `Unbounded findMany on a table that grows with customer data:\n` +
            offenders.map((o) => `  ${o.file}:${o.line} (${o.model})`).join('\n') +
            `\n\nAdd a \`take:\`, paginate it, or add the file to ALLOWED with a reason.`
        : '',
    ).toEqual([]);
  });

  it('keeps the allowlist honest: every entry still has an unbounded query', () => {
    // An allowlist that outlives its reason is how a rule rots. If a file was
    // fixed, its excuse must go with it.
    const files = new Set(findUnbounded().map((u) => u.file));
    const stale = Object.keys(ALLOWED).filter((f) => !files.has(f));
    expect(stale, `These no longer have an unbounded query — remove them from ALLOWED: ${stale.join(', ')}`).toEqual(
      [],
    );
  });

  it('every allowlist entry gives a reason, not a shrug', () => {
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(25);
    }
  });

  it('the endpoints the baseline caught are bounded now', () => {
    const stock = readFileSync(path.resolve(import.meta.dirname, '../stock/stock.service.ts'), 'utf8');
    // listLevels went to pagination; the pickers took an explicit cap.
    expect(stock).toMatch(/listLevels\([^)]*query: PageQuery/);
    expect(stock).toContain('take: PICKER_CAP');
    expect(stock).toContain('take: LIST_CAP');
  });
});
