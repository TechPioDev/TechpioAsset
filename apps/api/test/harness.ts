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
  // Handed a server with no address - which is what request(app.getHttpServer())
  // passes - supertest starts one on an ephemeral port for that single request
  // and closes it again when the response ends. It also sends Connection: close,
  // so every request already costs its own connection. That is two ephemeral
  // ports per request instead of one, and a full run makes thousands: measured
  // here, a run sat at roughly 1,800 loopback sockets in TIME_WAIT throughout,
  // against a 16,384-port dynamic range that Windows releases slowly. Listening
  // once removes the listener half outright - a server with an address is one
  // supertest connects to and never starts or stops - and the same measurement
  // afterwards read 514-716.
  //
  // This was chasing an ECONNRESET that struck about one test per full run,
  // a different test each time. Two better-sounding explanations were tested
  // and are both wrong, so nobody need re-run them: it is not a keep-alive
  // close race, tempting though that is now Node defaults client agent and
  // server alike to a 5000ms idle timeout, because supertest sends
  // Connection: close and never reuses a socket - ten requests, ten
  // connections; and it is not plain port exhaustion, the range being 16,384
  // wide and a run never approaching it.
  //
  // Evidence, not proof. The mechanism was never reproduced in isolation, so
  // what stands behind this is a rate: ECONNRESET appeared in 2 of ~4 full runs
  // before, and in 0 of 6 after - about 5,500 test executions. Zero in six
  // cannot tell "fixed" from "made rare". If it returns, this is where to
  // start, and the next thing to try is giving supertest a keep-alive agent so
  // a run stops opening a connection per request at all.
  //
  // Not to be confused with the identifier-audit test that was failing in the
  // same period: that was a real bug - ninety possible MAC addresses against a
  // unique constraint, one consumed for good per run - and its odds climbed
  // with every run rather than striking at random. Two symptoms on a shared
  // schedule are not one cause.
  //
  // app.close() shuts the listener down with the app.
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
