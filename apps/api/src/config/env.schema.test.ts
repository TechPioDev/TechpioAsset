import { describe, it, expect } from 'vitest';
import { validateEnv } from './env.schema.js';

const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  MFA_ENCRYPTION_KEY: 'c'.repeat(32),
};

describe('environment validation', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = validateEnv({ ...BASE });
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3001);
    expect(env.AI_PROVIDER).toBe('mock');
    expect(env.AI_ENABLED).toBe(false);
    expect(env.STORAGE_PROVIDER).toBe('local');
  });

  it('rejects short secrets rather than booting with them', () => {
    expect(() => validateEnv({ ...BASE, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
    expect(() => validateEnv({ ...BASE, MFA_ENCRYPTION_KEY: 'nope' })).toThrow(
      /MFA_ENCRYPTION_KEY/,
    );
  });

  it('requires a database and redis url', () => {
    const { DATABASE_URL: _d, ...withoutDb } = BASE;
    expect(() => validateEnv(withoutDb)).toThrow(/DATABASE_URL/);
  });

  it('parses comma-separated lists', () => {
    const env = validateEnv({
      ...BASE,
      CORS_ORIGINS: 'http://localhost:3000, https://assets.example.com ,',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://assets.example.com']);
  });

  it('coerces booleanish flags', () => {
    expect(validateEnv({ ...BASE, AI_ENABLED: 'true' }).AI_ENABLED).toBe(true);
    expect(validateEnv({ ...BASE, AI_ENABLED: '1' }).AI_ENABLED).toBe(true);
    expect(validateEnv({ ...BASE, AI_ENABLED: 'false' }).AI_ENABLED).toBe(false);
  });

  describe('provider credential cross-checks', () => {
    it('refuses AI_PROVIDER=azure without endpoint and key', () => {
      expect(() => validateEnv({ ...BASE, AI_PROVIDER: 'azure' })).toThrow(
        /AZURE_DOC_INTELLIGENCE_ENDPOINT/,
      );
    });

    it('refuses STORAGE_PROVIDER=azure without a connection string', () => {
      expect(() => validateEnv({ ...BASE, STORAGE_PROVIDER: 'azure' })).toThrow(
        /AZURE_STORAGE_CONNECTION_STRING/,
      );
    });

    it('refuses STORAGE_PROVIDER=s3 without bucket and region', () => {
      expect(() => validateEnv({ ...BASE, STORAGE_PROVIDER: 's3' })).toThrow(/S3_BUCKET/);
    });

    it('refuses MAIL_PROVIDER=smtp without a host', () => {
      expect(() => validateEnv({ ...BASE, MAIL_PROVIDER: 'smtp' })).toThrow(/SMTP_HOST/);
    });

    it('refuses PUSH_PROVIDER=expo without a token', () => {
      expect(() => validateEnv({ ...BASE, PUSH_PROVIDER: 'expo' })).toThrow(/EXPO_ACCESS_TOKEN/);
    });

    it('refuses PUSH_PROVIDER=fcm without a service account file', () => {
      expect(() => validateEnv({ ...BASE, PUSH_PROVIDER: 'fcm' })).toThrow(
        /FCM_SERVICE_ACCOUNT_FILE/,
      );
    });

    it('accepts a fully configured azure setup', () => {
      const env = validateEnv({
        ...BASE,
        AI_PROVIDER: 'azure',
        AZURE_DOC_INTELLIGENCE_ENDPOINT: 'https://x.cognitiveservices.azure.com/',
        AZURE_DOC_INTELLIGENCE_KEY: 'key',
      });
      expect(env.AI_PROVIDER).toBe('azure');
    });
  });

  // Spec section 25: "Never use development credentials in a production environment."
  it('refuses to start in production with a development secret', () => {
    expect(() =>
      validateEnv({
        ...BASE,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'dev-only-access-secret-not-for-production-use-32',
      }),
    ).toThrow(/production/);
  });

  it('allows real secrets in production', () => {
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'production' })).not.toThrow();
  });

  it('reports every problem at once rather than one at a time', () => {
    try {
      validateEnv({ ...BASE, JWT_ACCESS_SECRET: 'x', JWT_REFRESH_SECRET: 'y' });
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).toContain('JWT_REFRESH_SECRET');
    }
  });
});
