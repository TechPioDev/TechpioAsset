import { describe, expect, it } from 'vitest';
import type { AuthUser } from '@techpioasset/contracts';
import { isVendorUser, tenantFilter, vendorScopeFilter } from './scope.js';
import { AppError } from './errors/app-error.js';

/**
 * Vendor isolation, at the level where it is actually decided (v2.42).
 *
 * A supplier user signs in to the buying company's tenant. Every vendor-scoped
 * query therefore has to narrow twice: once to the company, and once to the one
 * vendor that user belongs to. The failure this guards against is not a leak
 * between companies - the tenant filter already handles that - it is Vendor A
 * reading Vendor B's catalogue, prices and orders inside the same tenant.
 *
 * The fail-closed case is the one worth writing down. A vendor user with no
 * vendor linked is a misconfiguration, and the tempting behaviour is to fall
 * back to the tenant filter alone. That would hand one supplier every
 * competitor's pricing, which is the worst single outcome this module can
 * produce - so it throws instead.
 */

const actor = (over: Partial<AuthUser> = {}): AuthUser =>
  ({
    id: 'u1',
    email: 'someone@example.com',
    companyId: 'company-1',
    roles: [],
    permissions: [],
    vendorId: null,
    scope: 'ALL',
    mfaEnabled: false,
    platformAdmin: false,
    firstName: null,
    lastName: null,
    displayName: null,
    avatarUrl: null,
    jobTitle: null,
    phone: null,
    locale: null,
    timezone: null,
    dateFormat: null,
    departmentId: null,
    departmentName: null,
    officeId: null,
    officeName: null,
    ...over,
  }) as AuthUser;

describe('who counts as a supplier user', () => {
  it('is decided by the link on the account, not by the role', () => {
    // The role is editable by an administrator; the link is what queries filter
    // on. If they ever disagree, the narrower answer has to win.
    expect(isVendorUser(actor({ vendorId: 'vendor-a' }))).toBe(true);
    expect(isVendorUser(actor({ roles: ['VENDOR'] }))).toBe(false);
    expect(isVendorUser(actor())).toBe(false);
  });
});

describe('vendor scoping', () => {
  it('narrows a supplier user to its own vendor', () => {
    const filter = vendorScopeFilter(actor({ roles: ['VENDOR'], vendorId: 'vendor-a' }));
    expect(filter).toEqual({ companyId: 'company-1', vendorId: 'vendor-a' });
  });

  it('never narrows internal staff, who are meant to see every vendor', () => {
    const filter = vendorScopeFilter(actor({ roles: ['PROCUREMENT_MANAGER'] }));
    expect(filter).toEqual({ companyId: 'company-1' });
    expect(filter).not.toHaveProperty('vendorId');
  });

  it('refuses to run rather than return every vendor when the link is missing', () => {
    // Falling back to the tenant filter here would give one supplier the whole
    // catalogue. Failing loudly is the only acceptable behaviour.
    //
    // The message is checked because this refusal is one a real person hits -
    // a supplier account somebody created but never linked - and it has to tell
    // them who can fix it rather than read as a crash.
    let thrown: unknown;
    try {
      vendorScopeFilter(actor({ roles: ['VENDOR'], vendorId: null }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('FORBIDDEN');
    expect((thrown as AppError).message).toMatch(/not linked to a supplier/);
  });

  it('keeps the company boundary in every case', () => {
    for (const a of [
      actor({ roles: ['VENDOR'], vendorId: 'vendor-a' }),
      actor({ roles: ['FINANCE'] }),
      actor(),
    ]) {
      expect(vendorScopeFilter(a).companyId).toBe(tenantFilter(a).companyId);
    }
  });

  it('does not widen a supplier user who also holds an internal role', () => {
    // An account carrying both is a mistake, but it must not be an escalation:
    // the vendor link still narrows the query.
    const filter = vendorScopeFilter(
      actor({ roles: ['VENDOR', 'PROCUREMENT_MANAGER'], vendorId: 'vendor-a' }),
    );
    expect(filter.vendorId).toBe('vendor-a');
  });
});
