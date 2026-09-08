import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuthUser } from '@techpioasset/contracts';
import { AppModule } from '../src/app.module.js';
import { applySecurityMiddleware } from '../src/bootstrap/security.js';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

export const DEMO_PASSWORD = 'TechpioDemo!2026';

export const ACCOUNTS = {
  superAdmin: 'admin@techpioasset.dev',
  itAdmin: 'it@techpioasset.dev',
  hr: 'hr@techpioasset.dev',
  officeAdmin: 'office@techpioasset.dev',
  finance: 'finance@techpioasset.dev',
  manager: 'manager@techpioasset.dev',
  auditor: 'auditor@techpioasset.dev',
  employee: 'employee@techpioasset.dev',
  employee2: 'employee2@techpioasset.dev',
  // Used by the offboarding suite, which assigns and returns assets; keeping it
  // separate stops that churn interfering with the scope assertions elsewhere.
  employee3: 'employee3@techpioasset.dev',
} as const;

export type AccountKey = keyof typeof ACCOUNTS;

export interface Session {
  token: string;
  user: AuthUser;
  refreshCookie: string | undefined;
}

/**
 * Boots the real application - the same module graph, guards and filters that
 * serve production traffic. Mocking the guards here would test the mock, and the
 * guards are precisely what these tests exist to prove.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  applySecurityMiddleware(app);
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  await app.init();

  // Listen once, here, rather than letting supertest do it per request.
  //
  // Handed a server with no address, supertest starts one on an ephemeral port
  // for that single request and closes it again when the response ends. It also
  // sends Connection: close, so every request already costs its own connection.
  // That is two ephemeral ports per request rather than one, and a full run
  // makes thousands: measured on this machine, a run sits at roughly 1,800
  // loopback sockets in TIME_WAIT throughout, against a 16,384-port dynamic
  // range that Windows releases slowly.
  //
  // The suite fails about one test per full run with ECONNRESET - a different
  // test each time, always passing on its own - which is the shape of a port
  // collision rather than of a bug in the test. Listening once removes the
  // listener half of that churn outright: a server with an address is one
  // supertest connects to and never starts or stops.
  //
  // Whether that is the whole cause is measured, not assumed - see the note on
  // the flake rate in the commit that added this. app.close() shuts the
  // listener down with the app.
  await new Promise<void>((resolve, reject) => {
    const server = app.getHttpServer() as import('node:http').Server;
    server.once('error', reject);
    server.listen(0, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  return app;
}

export function api(app: INestApplication) {
  return request(app.getHttpServer());
}

export async function login(
  app: INestApplication,
  email: string,
  password = DEMO_PASSWORD,
): Promise<Session> {
  const response = await api(app).post('/api/v1/auth/login').send({ email, password });
  if (response.status !== 200 || !response.body?.data?.accessToken) {
    throw new Error(
      `Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return {
    token: response.body.data.accessToken,
    user: response.body.data.user,
    refreshCookie: cookies.find((c: string) => c.startsWith('techpioasset_refresh=')),
  };
}

/** Logs in every demo account once, so each spec does not pay the argon2 cost again. */
export async function loginAll(app: INestApplication): Promise<Record<AccountKey, Session>> {
  const entries = await Promise.all(
    (Object.entries(ACCOUNTS) as [AccountKey, string][]).map(
      async ([key, email]) => [key, await login(app, email)] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<AccountKey, Session>;
}

export const auth = (session: Session) => ({ Authorization: `Bearer ${session.token}` });
