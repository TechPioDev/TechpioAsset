import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { AppConfig } from '../config/config.module.js';

/**
 * Helmet options shared by the production bootstrap and the test harness.
 *
 * Kept in one place so the security integration tests exercise the *same*
 * headers production serves — a config that only lived in `main.ts` would be
 * untested, and drift between the two would be invisible.
 *
 * The API serves JSON and signed redirects only, so the CSP can be as strict as
 * "trust nothing": it costs nothing here and hardens error pages against content
 * sniffing.
 */
export const HELMET_OPTIONS = {
  contentSecurityPolicy: {
    directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  },
  crossOriginResourcePolicy: { policy: 'same-site' as const },
};

/** Applies cookie parsing and security headers. Used by main.ts and the harness. */
export function applySecurityMiddleware(app: INestApplication): void {
  // v3.17 - the API only ever sits behind nginx on the same host, which
  // appends the real client address to X-Forwarded-For. Without this, every
  // request's `req.ip` was nginx's own 127.0.0.1, so the per-IP limits on
  // login, password reset and agent enrolment were ONE bucket shared by the
  // whole internet: one noisy client could lock everybody out of signing in
  // for a minute, and a hundred laptops checking in read as one address.
  // Trusting the loopback hop only means a client cannot forge its address:
  // whatever it puts in the header, nginx appends the real one last and that
  // is the one Express reads.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  // Refresh tokens travel as httpOnly cookies; this reads them back.
  app.use(cookieParser());
  app.use(helmet(HELMET_OPTIONS));
}

/** Applies the CORS policy. Origins and credentials come from config. */
export function applyCors(app: INestApplication, config: AppConfig): void {
  app.enableCors({
    origin: config.get('CORS_ORIGINS'),
    // Refresh tokens travel in an httpOnly cookie, so credentials must be allowed
    // and the origin list must stay explicit - never a wildcard.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // X-Refresh-Token is how a native/mobile client (which has no cookie jar)
    // sends the stored refresh token and reads the rotated one back. Native fetch
    // ignores CORS, but the browser-based mobile build ("laptop review") needs it
    // both allowed on the request and exposed on the response, or refresh and
    // biometric unlock silently fail there.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Correlation-Id',
      'X-Client-Type',
      'X-Refresh-Token',
    ],
    // Content-Disposition is exposed so a download can be saved under the name
    // the server chose. Without it the browser cannot read the header at all
    // cross-origin, and the client has to invent a filename - which is how a
    // real .xlsx came to be saved as ".xls" and refused by Excel (v2.28).
    exposedHeaders: [
      'X-Request-Id',
      'X-Correlation-Id',
      'X-Refresh-Token',
      'Content-Disposition',
    ],
    maxAge: 600,
  });
}
