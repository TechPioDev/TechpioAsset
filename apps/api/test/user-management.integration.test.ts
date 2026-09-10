import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * User & role management (users:manage / roles:manage). These endpoints can
 * escalate privilege and lock people out, so the guards are the point: only a
 * Super Admin may wield them, the company can never lose its last Super Admin,
 * and no one can disable their own account.
 *
 * Every test that mutates employee3 restores it afterwards, because the suite
 * shares one database.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
});

afterAll(async () => {
  await app?.close();
});

async function userId(email: string): Promise<string> {
  const res = await api(app)
    .get(`/api/v1/users?q=${encodeURIComponent(email)}&pageSize=1`)
    .set(auth(s.superAdmin));
  return res.body.data[0].id;
}

// Return employee3 to its seeded baseline after each mutation test.
afterEach(async () => {
  const id = await userId('employee3');
  await api(app)
    .patch(`/api/v1/users/${id}/roles`)
    .set(auth(s.superAdmin))
    .send({ roleKeys: ['EMPLOYEE'] });
  await api(app)
    .patch(`/api/v1/users/${id}/status`)
    .set(auth(s.superAdmin))
    .send({ status: 'ACTIVE' });
});

describe('role filter', () => {
  it('returns only users holding the requested role', async () => {
    const res = await api(app)
      .get('/api/v1/users?role=FINANCE&pageSize=100')
      .set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const u of res.body.data) {
      expect(u.roles.some((r: { role: { key: string } }) => r.role.key === 'FINANCE')).toBe(true);
    }
  });
});

describe('changing roles (roles:manage)', () => {
  it('lets a Super Admin replace a user’s roles', async () => {
    const id = await userId('employee3');
    const res = await api(app)
      .patch(`/api/v1/users/${id}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: ['EMPLOYEE', 'FINANCE'] });
    expect(res.status).toBe(200);
    expect(res.body.data.roles.map((r: { role: { key: string } }) => r.role.key).sort()).toEqual([
      'EMPLOYEE',
      'FINANCE',
    ]);
  });

  it.each(['itAdmin', 'hr', 'manager', 'employee'] as AccountKey[])(
    'forbids %s from changing roles',
    async (role) => {
      const id = await userId('employee3');
      const res = await api(app)
        .patch(`/api/v1/users/${id}/roles`)
        .set(auth(s[role]))
        .send({ roleKeys: ['FINANCE'] });
      expect(res.status).toBe(403);
    },
  );

  it('rejects an empty role set (everyone keeps at least one role)', async () => {
    const id = await userId('employee3');
    const res = await api(app)
      .patch(`/api/v1/users/${id}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: [] });
    expect(res.status).toBe(422);
  });

  it('refuses to demote the last Super Admin', async () => {
    const id = s.superAdmin.user.id;
    const res = await api(app)
      .patch(`/api/v1/users/${id}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: ['EMPLOYEE'] });
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/Super Admin/i);
  });
});

describe('changing status (users:manage)', () => {
  it('deactivates and reactivates a user', async () => {
    const id = await userId('employee3');
    const off = await api(app)
      .patch(`/api/v1/users/${id}/status`)
      .set(auth(s.superAdmin))
      .send({ status: 'DEACTIVATED', reason: 'Left the company' });
    expect(off.status).toBe(200);
    expect(off.body.data.status).toBe('DEACTIVATED');

    const on = await api(app)
      .patch(`/api/v1/users/${id}/status`)
      .set(auth(s.superAdmin))
      .send({ status: 'ACTIVE' });
    expect(on.body.data.status).toBe('ACTIVE');
  });

  it('forbids a non-admin from changing status', async () => {
    const id = await userId('employee3');
    const res = await api(app)
      .patch(`/api/v1/users/${id}/status`)
      .set(auth(s.itAdmin))
      .send({ status: 'DEACTIVATED' });
    expect(res.status).toBe(403);
  });

  it('refuses to let a Super Admin deactivate their own account', async () => {
    const res = await api(app)
      .patch(`/api/v1/users/${s.superAdmin.user.id}/status`)
      .set(auth(s.superAdmin))
      .send({ status: 'DEACTIVATED' });
    expect(res.status).toBe(422);
  });
});

describe('changing the address a user signs in with (v2.54)', () => {
  const NEW = 'employee3.moved@techpioasset.dev';
  let original = '';
  let target = '';

  beforeAll(async () => {
    target = await userId('employee3@techpioasset.dev');
    original = 'employee3@techpioasset.dev';
  });

  afterEach(async () => {
    // The suite shares one database, and login resolves by email.
    await api(app)
      .patch(`/api/v1/users/${target}/email`)
      .set(auth(s.superAdmin))
      .send({ email: original });
  });

  it('changes it, and the account signs in with the new address', async () => {
    const res = await api(app)
      .patch(`/api/v1/users/${target}/email`)
      .set(auth(s.superAdmin))
      .send({ email: NEW });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.email).toBe(NEW);

    // The point of the feature: the person can actually get in afterwards.
    const login = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: NEW, password: 'TechpioDemo!2026' });
    expect(login.status, JSON.stringify(login.body)).toBe(200);

    // And the address they used to use no longer reaches an account.
    const old = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: original, password: 'TechpioDemo!2026' });
    expect(old.status).toBe(401);
  });

  it('records what it was and what it became', async () => {
    await api(app)
      .patch(`/api/v1/users/${target}/email`)
      .set(auth(s.superAdmin))
      .send({ email: NEW });

    const audit = await api(app)
      .get(`/api/v1/audit?entityType=User&entityId=${target}&pageSize=5`)
      .set(auth(s.superAdmin));
    expect(audit.status, JSON.stringify(audit.body)).toBe(200);
    const entry = (audit.body.data as { previousValues: unknown; newValues: unknown }[]).find(
      (row) => JSON.stringify(row.newValues ?? {}).includes(NEW),
    );
    // Editing the database by hand left no trail at all; that is the gap.
    expect(entry, 'an audit entry naming the new address').toBeTruthy();
    expect(JSON.stringify(entry!.previousValues)).toContain(original);
  });

  it('stops claiming the address is verified, because nobody proved it', async () => {
    await api(app)
      .patch(`/api/v1/users/${target}/email`)
      .set(auth(s.superAdmin))
      .send({ email: NEW });

    const detail = await api(app).get(`/api/v1/users/${target}`).set(auth(s.superAdmin));
    expect(detail.status).toBe(200);
    expect(detail.body.data.emailVerifiedAt ?? null).toBeNull();
  });

  it('refuses an address another account already uses', async () => {
    const res = await api(app)
      .patch(`/api/v1/users/${target}/email`)
      .set(auth(s.superAdmin))
      .send({ email: 'employee@techpioasset.dev' });
    expect(res.status).toBe(409);
    expect(res.body.title ?? res.body.detail).toBeTruthy();
  });

  it('refuses a no-op rather than writing a meaningless audit entry', async () => {
    const res = await api(app)
      .patch(`/api/v1/users/${target}/email`)
      .set(auth(s.superAdmin))
      .send({ email: original });
    expect(res.status).toBe(422);
  });

  it('refuses nonsense that is not an address at all', async () => {
    const res = await api(app)
      .patch(`/api/v1/users/${target}/email`)
      .set(auth(s.superAdmin))
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
  });

  it('will not quietly strip a platform operator of their access', async () => {
    // Platform access is granted by listing an address in PLATFORM_ADMIN_EMAILS,
    // so changing one leaves the account working and the platform screens shut,
    // with nothing to say why. This lane designates admin@techpioasset.dev.
    const platformAdmin = await userId('admin@techpioasset.dev');
    const res = await api(app)
      .patch(`/api/v1/users/${platformAdmin}/email`)
      .set(auth(s.superAdmin))
      .send({ email: 'someone.else@techpioasset.dev' });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('PLATFORM_ADMIN_EMAILS');
  });

  it('is refused to a Company Admin, who holds users:manage but is not a Super Admin', async () => {
    // The gate that matters. Only SUPER_ADMIN and COMPANY_ADMIN hold
    // users:manage, so a permission check alone would let the tenant owner hand
    // any account to anybody. employee2 is lent the role and given it back,
    // because the suite shares one database.
    const borrower = await userId('employee2@techpioasset.dev');
    const before = await api(app).get(`/api/v1/users/${borrower}`).set(auth(s.superAdmin));
    const originalKeys = (before.body.data.roles as { role: { key: string } }[]).map(
      (r) => r.role.key,
    );

    try {
      const assign = await api(app)
        .patch(`/api/v1/users/${borrower}/roles`)
        .set(auth(s.superAdmin))
        .send({ roleKeys: ['COMPANY_ADMIN'] });
      // Asserted, because a silent failure here would leave the borrower with
      // no permission at all and the refusal below would prove nothing. It did
      // exactly that once: the field is roleKeys, and roleIds failed quietly.
      expect(assign.status, JSON.stringify(assign.body)).toBe(200);

      const session = await api(app)
        .post('/api/v1/auth/login')
        .send({ email: 'employee2@techpioasset.dev', password: 'TechpioDemo!2026' });
      expect(session.status, JSON.stringify(session.body)).toBe(200);
      expect(session.body.data.user.permissions).toContain('users:manage');

      const res = await api(app)
        .patch(`/api/v1/users/${target}/email`)
        .set({ Authorization: `Bearer ${session.body.data.accessToken}` })
        .send({ email: NEW });
      expect(res.status).toBe(403);
      // Named, so this cannot pass for the wrong reason: had the permission
      // been missing, the refusal would have come from the route guard instead
      // and the new gate would be untested.
      expect(JSON.stringify(res.body)).toContain('Only a Super Admin');
    } finally {
      await api(app)
        .patch(`/api/v1/users/${borrower}/roles`)
        .set(auth(s.superAdmin))
        .send({ roleKeys: originalKeys });
    }
  });

  it('is refused to anyone without users:manage', async () => {
    const res = await api(app)
      .patch(`/api/v1/users/${target}/email`)
      .set(auth(s.employee))
      .send({ email: NEW });
    expect(res.status).toBe(403);
  });
});
