import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Banknote, Eye, ShieldCheck, Users } from 'lucide-react';
import {
  ROLE_DEFAULT_SCOPE,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  PERMISSIONS,
  SYSTEM_ROLES,
  type SystemRole,
} from '@techpioasset/domain';
import { HeroAccent, HeroBackdrop, HeroBadge } from '@/components/marketing/hero-backdrop';

/**
 * What each role can do - read from the permission matrix, not retyped.
 *
 * The table this replaced was maintained by hand in a PDF and had already gone
 * wrong: it stated that Company Admin cannot see money, while the matrix grants
 * that role every permission including cost. Deriving the page from
 * ROLE_PERMISSIONS means the documentation cannot disagree with the product,
 * because it is reading the same source the server enforces from.
 */

export const metadata: Metadata = {
  title: 'Roles and Permissions',
  description:
    'The thirteen roles in PioAssets: what each one is for, how much of the company it can see, and who can see what equipment costs.',
  openGraph: {
    title: 'Roles and Permissions | PioAssets',
    description:
      'Every role explained — purpose, data scope and cost visibility — generated from the permission matrix the product itself enforces.',
    url: 'https://pioassets.com/guides/roles-and-permissions',
    siteName: 'PioAssets',
    type: 'article',
    images: [
      {
        url: 'https://pioassets.com/marketing/og-card.jpg',
        width: 1200,
        height: 630,
        alt: 'PioAssets roles and permissions',
      },
    ],
  },
  alternates: { canonical: 'https://pioassets.com/guides/roles-and-permissions' },
};

const SCOPE_COPY: Record<string, string> = {
  ALL: 'The whole company',
  DEPARTMENT: 'Their department',
  DIRECT_REPORTS: 'Themselves and the people they manage',
  OWN: 'Only their own records',
};

/** Purpose lines. Everything else on this page is derived. */
const PURPOSE: Record<SystemRole, string> = {
  SUPER_ADMIN: 'Full access: users, roles, offices, workflows and platform settings.',
  COMPANY_ADMIN: 'Owns the tenant — users, roles, workflows and configuration for the company.',
  IT_ADMIN: 'IT equipment, assignments, warranties and device lifecycle.',
  IT_TECHNICIAN: 'Carries out the IT work: deploy, assign, repair, maintain.',
  HR: 'Employees, onboarding and offboarding.',
  OFFICE_ADMIN: 'Furniture, kitchen equipment, pantry stock and office supplies.',
  FINANCE: 'Costs, invoice verification, purchase approvals, vendor spend and budgets.',
  PROCUREMENT_MANAGER: 'Vendors, purchase requests and orders, RFQs and sourcing.',
  INVENTORY_MANAGER: 'Stock, receiving, transfers and provisioning.',
  MANAGER: 'Reviews and approves requests raised by their direct reports.',
  EMPLOYEE: 'Sees their own equipment, raises requests, reports damage.',
  AUDITOR: 'Read-only: assets, invoices, approvals, the audit log and reports.',
  VENDOR:
    'An external supplier, signed in to keep its own catalogue. Sees only its own offers, orders and invoices — never another supplier’s prices, and never how offers compare.',
};

const COST_PERMISSIONS: string[] = [PERMISSIONS.ASSETS_COST_READ, PERMISSIONS.LICENSES_COST_READ];

function rolePermissions(role: SystemRole): string[] {
  const grants = ROLE_PERMISSIONS[role];
  return Array.isArray(grants) ? [...grants] : [];
}

export default function RolesAndPermissionsPage() {
  const rows = (SYSTEM_ROLES as readonly SystemRole[]).map((role) => {
    const grants = rolePermissions(role);
    return {
      role,
      name: ROLE_LABELS[role]?.name ?? role,
      purpose: PURPOSE[role],
      scope: SCOPE_COPY[ROLE_DEFAULT_SCOPE[role]] ?? ROLE_DEFAULT_SCOPE[role],
      seesCost: COST_PERMISSIONS.some((p) => grants.includes(p)),
      count: grants.length,
    };
  });

  return (
    <div>
      <section className="relative overflow-hidden">
        <HeroBackdrop />
        <div className="relative mx-auto max-w-4xl px-5 py-16 sm:py-20">
          <HeroBadge>Guide</HeroBadge>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance text-white sm:text-5xl">
            Roles and <HeroAccent>permissions</HeroAccent>
          </h1>
          <p className="mt-5 text-lg text-white/80">
            Thirteen roles. What each one is for, how much of the company it sees, and who can see
            what things cost.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-5 pb-24">
        <section className="mt-10 grid gap-3 text-[15px] leading-relaxed">
          <p>
            A role carries two separate things: a set of <strong>permissions</strong> — what a
            person may do — and a <strong>data scope</strong>, which decides how much of the company
            those permissions apply to. Holding <em>assets:read</em> with a scope of “only their own
            records” shows a person their own laptop and nobody else’s.
          </p>
          <p>
            Somebody can hold more than one role. Permissions add up; the <strong>narrowest scope
            wins</strong>, so combining Manager with Registered Employee does not widen what either
            can see.
          </p>
        </section>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse text-sm">
            <caption className="sr-only">
              Every role in PioAssets with its purpose, data scope and cost visibility
            </caption>
            <thead>
              <tr className="border-b border-[var(--color-border-strong)] text-left">
                <th scope="col" className="py-2.5 pr-4 font-semibold">
                  Role
                </th>
                <th scope="col" className="py-2.5 pr-4 font-semibold">
                  What it is for
                </th>
                <th scope="col" className="py-2.5 pr-4 font-semibold">
                  Sees
                </th>
                <th scope="col" className="py-2.5 font-semibold whitespace-nowrap">
                  Costs?
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.role} className="border-b border-[var(--color-border)] align-top">
                  <th scope="row" className="py-3 pr-4 text-left font-semibold whitespace-nowrap">
                    {r.name}
                  </th>
                  <td className="py-3 pr-4 text-[var(--color-content-muted)]">{r.purpose}</td>
                  <td className="py-3 pr-4 text-[var(--color-content-muted)]">{r.scope}</td>
                  <td className="py-3">
                    {r.seesCost ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--tone-success-bg)] px-2 py-0.5 text-xs font-medium text-[var(--tone-success-fg)]">
                        <Banknote aria-hidden="true" className="size-3" /> Yes
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--color-content-subtle)]">No</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-[var(--color-content-subtle)]">
          This table is generated from the same permission matrix the server enforces, so it cannot
          drift out of step with the product.
        </p>

        <Section icon={Banknote} title="Why money is its own question">
          <p>
            Purchase prices, invoice values and budgets are visible only to roles that carry a cost
            permission — <strong>Finance</strong>, <strong>Super Admin</strong> and{' '}
            <strong>Company Admin</strong>. Everyone else sees the equipment without its price, and
            the cost columns are absent from the response entirely rather than hidden in the page,
            so there is nothing to uncover by looking.
          </p>
        </Section>

        <Section icon={Eye} title="Scope, in practice">
          <ul className="grid gap-2">
            <li>
              <strong>The whole company</strong> — most operational roles. They are trusted with the
              fleet, not restricted to a corner of it.
            </li>
            <li>
              <strong>Themselves and the people they manage</strong> — Manager. Enough to approve
              what a direct report asks for, and no more.
            </li>
            <li>
              <strong>Only their own records</strong> — Registered Employee and Vendor. Someone
              else’s laptop is not merely hidden from the page: the server will not return it.
            </li>
          </ul>
        </Section>

        <Section icon={ShieldCheck} title="Combinations the system will question">
          <p>
            Some pairings undermine the point of having separate roles — raising a purchase and
            approving it, for instance. Assigning them together triggers a segregation-of-duties
            warning that has to be acknowledged deliberately. It is not blocked: a small company may
            have no choice, and pretending otherwise would only push the work outside the system.
          </p>
        </Section>

        <Section icon={Users} title="Changing somebody’s role">
          <p>
            Open <strong>People</strong>, choose the person, tick the roles and save. Changes take
            effect on their next request to the server — there is no overnight job to wait for.
          </p>
          <p>
            Roles are also what decides who appears in an approval chain. A step that waits on “IT
            review” waits on whoever holds the IT Administrator role; if nobody holds it, the
            request cannot move, and the request page will say so.
          </p>
        </Section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/guides/inviting-people"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-contrast)]"
          >
            Inviting people <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link
            href="/guides"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-4 py-2.5 text-sm font-semibold"
          >
            All guides
          </Link>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Eye;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 border-t border-[var(--color-border)] pt-8">
      <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        <Icon aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
        {title}
      </h2>
      <div className="mt-3 grid gap-3 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}
