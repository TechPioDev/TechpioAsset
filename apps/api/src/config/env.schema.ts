import { z } from 'zod';

/**
 * Environment validation.
 *
 * The API refuses to boot on an invalid environment rather than failing later at
 * the first request. Spec section 20 forbids hardcoded secrets, so secrets have
 * no defaults here - a missing one is a startup error, not a silent fallback.
 */

const csv = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const booleanish = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    API_URL: z.string().url().default('http://localhost:3001'),
    WEB_URL: z.string().url().default('http://localhost:3000'),
    CORS_ORIGINS: z.string().default('http://localhost:3000').transform(csv),

    // v2.1 Workstream A — when on, asset writes dual-write the four status
    // dimensions alongside the legacy `status`, and reads/filters expose them.
    // Off by default so v1 behaviour is unchanged until a tenant opts in.
    STATUS_MODEL_V2: booleanish.default('false'),

    // v2.1 Workstream C — when on, a user's data scope honours a per-role-assignment
    // override (UserRole.scope) instead of being fixed by the role default.
    RBAC_SCOPES: booleanish.default('false'),

    // v2.1 Workstream B — when on, each request sets the `app.tenant_id` GUC so the
    // Row-Level Security policies enforce tenant isolation. Requires the app to
    // connect as a NON-superuser DB role (superusers bypass RLS). Off = policies
    // stay dormant (permissive) and behaviour is exactly v1.
    RLS_ENFORCE: booleanish.default('false'),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('30d'),
    MFA_ENCRYPTION_KEY: z.string().min(32, 'MFA_ENCRYPTION_KEY must be at least 32 characters'),
    PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),

    ENTRA_TENANT_ID: z.string().optional(),
    ENTRA_CLIENT_ID: z.string().optional(),
    ENTRA_CLIENT_SECRET: z.string().optional(),

    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
    // memory keeps counters in-process (fine for a single instance); redis shares
    // them across instances so the limit holds behind a load balancer.
    RATE_LIMIT_STORAGE: z.enum(['memory', 'redis']).default('memory'),

    // Reference-data cache. memory is per-process; redis is shared and survives
    // a restart. Both honour CACHE_TTL_SECONDS.
    CACHE_PROVIDER: z.enum(['memory', 'redis']).default('memory'),
    CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),

    STORAGE_PROVIDER: z.enum(['local', 'azure', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('.local-storage'),
    STORAGE_CONTAINER: z.string().default('techpioasset'),
    STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(200).default(25),
    ALLOWED_UPLOAD_MIME: z
      .string()
      .default('application/pdf,image/jpeg,image/png,image/heic')
      .transform(csv),

    AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
    /** v2.8 S1 - off-site backup destination (S3-compatible; any provider).
     *  Unset means backups stay local only, which /health/ready reports. */
    /** v2.8 S2 - where operational alerts go (failed restore drills today).
     *  Unset means the drill still records and exits non-zero, but tells nobody. */
    OPS_ALERT_EMAIL: z.string().email().optional(),
    /** v2.8 S4 - OTLP collector base URL, e.g. http://collector:4318. Unset
     *  means tracing is off and no SDK is constructed at all. */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    BACKUP_S3_BUCKET: z.string().optional(),
    BACKUP_S3_REGION: z.string().optional(),
    BACKUP_S3_ACCESS_KEY_ID: z.string().optional(),
    BACKUP_S3_SECRET_ACCESS_KEY: z.string().optional(),
    BACKUP_S3_ENDPOINT: z.string().optional(),
    BACKUP_S3_PREFIX: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    AI_PROVIDER: z.enum(['mock', 'azure', 'anthropic']).default('mock'),
    AI_ENABLED: booleanish.default('false'),
    AZURE_DOC_INTELLIGENCE_ENDPOINT: z.string().optional(),
    AZURE_DOC_INTELLIGENCE_KEY: z.string().optional(),
    // Anthropic (Claude) document extraction. The key is a secret with no
    // default (spec section 20). The model defaults to the current flagship;
    // set it to a cheaper model (e.g. claude-haiku-4-5) to trade accuracy for cost.
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
    AI_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
    AI_MONTHLY_BUDGET_USD: z.coerce.number().min(0).optional(),

    MAIL_PROVIDER: z.enum(['mock', 'smtp']).default('mock'),
    MAIL_FROM: z.string().default('TechpioAsset <no-reply@techpioasset.local>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_SECURE: booleanish.default('false'),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    // in-process runs jobs in this process (no Redis required, not durable);
    // bullmq uses REDIS_URL and survives restarts.
    QUEUE_PROVIDER: z.enum(['in-process', 'bullmq']).default('in-process'),

    PUSH_PROVIDER: z.enum(['mock', 'expo', 'fcm']).default('mock'),
    EXPO_ACCESS_TOKEN: z.string().optional(),
    /** v2.56 — path to the Firebase service-account key JSON, for PUSH_PROVIDER=fcm. */
    FCM_SERVICE_ACCOUNT_FILE: z.string().optional(),

    /**
     * v2.3 — encrypts stored licence keys (AES-256-GCM). Optional: without it,
     * adding or revealing keys is refused with a clear error; everything else
     * in the licence module works. Set to any string of 16+ characters.
     */
    LICENSE_KEY_SECRET: z.string().min(16).optional(),

    /** v2.6 - comma-separated emails allowed onto the platform plane. The
     *  platform gate is OPERATOR-designated, deliberately outside the tenant
     *  permission matrix (granted to no tenant role). Empty = plane disabled. */
    PLATFORM_ADMIN_EMAILS: z.string().default(''),
    /** v2.5 - RAM the health score treats as the role baseline (B.7 Memory). */
    HEALTH_RAM_BASELINE_GB: z.coerce.number().min(1).max(1024).default(8),
    /** v2.5 - device discovery: mock (default) | intune (built to contract). */
    DISCOVERY_PROVIDER: z.enum(['mock', 'intune']).default('mock'),
    INTUNE_TENANT_ID: z.string().optional(),
    INTUNE_CLIENT_ID: z.string().optional(),
    INTUNE_CLIENT_SECRET: z.string().optional(),

    /** v2.4 - PRs at or above this estimated total need a Finance approver. */
    PR_FINANCE_THRESHOLD: z.coerce.number().nonnegative().default(250),

    // mock | webhook — optional Teams/Slack chat integration (spec section 19).
    CHAT_PROVIDER: z.enum(['mock', 'webhook']).default('mock'),
    TEAMS_WEBHOOK_URL: z.string().optional(),
    SLACK_WEBHOOK_URL: z.string().optional(),
    /** Runs the warranty/maintenance alert sweep on boot and daily. */
    ENABLE_SCHEDULED_JOBS: z
      .enum(['true', 'false', '1', '0'])
      .default('false')
      .transform((v) => v === 'true' || v === '1'),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_REDACT_KEYS: z
      .string()
      .default(
        'password,passwordHash,token,accessToken,refreshToken,mfaSecret,authorization,cookie',
      )
      .transform(csv),
  })
  // Selecting a real provider without its credentials would fail at the first
  // upload or extraction instead of at boot. Catch it here.
  .superRefine((env, ctx) => {
    if (env.STORAGE_PROVIDER === 'azure' && !env.AZURE_STORAGE_CONNECTION_STRING) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AZURE_STORAGE_CONNECTION_STRING'],
        message: 'Required when STORAGE_PROVIDER=azure',
      });
    }
    if (env.STORAGE_PROVIDER === 's3' && (!env.S3_BUCKET || !env.S3_REGION)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET and S3_REGION are required when STORAGE_PROVIDER=s3',
      });
    }
    if (
      env.AI_PROVIDER === 'azure' &&
      (!env.AZURE_DOC_INTELLIGENCE_ENDPOINT || !env.AZURE_DOC_INTELLIGENCE_KEY)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AZURE_DOC_INTELLIGENCE_ENDPOINT'],
        message: 'Endpoint and key are required when AI_PROVIDER=azure',
      });
    }
    if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_API_KEY'],
        message: 'Required when AI_PROVIDER=anthropic',
      });
    }
    if (env.QUEUE_PROVIDER === 'bullmq' && !env.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'Required when QUEUE_PROVIDER=bullmq',
      });
    }
    if (env.MAIL_PROVIDER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'Required when MAIL_PROVIDER=smtp',
      });
    }
    if (env.PUSH_PROVIDER === 'expo' && !env.EXPO_ACCESS_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXPO_ACCESS_TOKEN'],
        message: 'Required when PUSH_PROVIDER=expo',
      });
    }
    if (env.PUSH_PROVIDER === 'fcm' && !env.FCM_SERVICE_ACCOUNT_FILE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FCM_SERVICE_ACCOUNT_FILE'],
        message: 'Required when PUSH_PROVIDER=fcm',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (
        env.JWT_ACCESS_SECRET.includes('dev-only') ||
        env.JWT_REFRESH_SECRET.includes('dev-only')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'Development secrets must not be used in production (spec section 25)',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  return parsed.data;
}
