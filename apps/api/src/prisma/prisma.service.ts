import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { deriveDimensionsFromLegacy, type AssetStatus, type ConditionGrade } from '@techpioasset/domain';
import { AppConfig } from '../config/config.module.js';
import {
  SOFT_DELETABLE_MODELS,
  UNDELETABLE_MODELS,
  UndeletableModelError,
} from './model-policy.js';

export { SOFT_DELETABLE_MODELS, UNDELETABLE_MODELS, UndeletableModelError };

// Every read that soft-deleted rows must stay out of. `groupBy` belongs here
// as much as `count` does: it was missing, so a grouped count reported rows
// that the list beside it had already filtered away - a dashboard totalling
// 6659 next to a list of 6655. Anything that genuinely wants deleted rows asks
// for them with `includeDeleted: true`.
const READ_OPERATIONS = new Set([
  'findFirst',
  'findMany',
  'findUnique',
  'count',
  'aggregate',
  'groupBy',
]);
const DELETE_OPERATIONS = new Set(['delete', 'deleteMany']);
const WRITE_OPERATIONS = new Set(['create', 'update', 'updateMany', 'upsert', 'createMany']);

/**
 * v2.1 Workstream A dual-write. When STATUS_MODEL_V2 is on, any Asset write that
 * sets `status` also derives the lifecycle + availability dimensions from it, so
 * every path (create / update / changeStatus / assign / return / bulk) keeps the
 * dimensions in step with the legacy status without touching each call site.
 * Ownership and condition are orthogonal and never derived here. Explicitly
 * supplied dimensions are respected. Off by default → v1 behaviour unchanged.
 */
function deriveOneRow(data: Record<string, unknown>): void {
  if (typeof data.status !== 'string') return;
  const dims = deriveDimensionsFromLegacy(data.status as AssetStatus, {
    existingCondition: typeof data.condition === 'string' ? (data.condition as ConditionGrade) : undefined,
  });
  if (data.lifecycleState === undefined) data.lifecycleState = dims.lifecycle;
  if (data.availabilityState === undefined) data.availabilityState = dims.availability;
}

function deriveAssetDimensions(data: unknown): void {
  if (Array.isArray(data)) {
    for (const row of data) if (row && typeof row === 'object') deriveOneRow(row as Record<string, unknown>);
  } else if (data && typeof data === 'object') {
    deriveOneRow(data as Record<string, unknown>);
  }
}

/**
 * Builds the extended client. Exported separately from the Nest service so the
 * seed script and integration tests can construct one without a Nest container.
 *
 * @param statusModelV2 enables the v2.1 asset-dimension dual-write (default off).
 */
export function createPrismaClient(datasourceUrl?: string, statusModelV2 = false) {
  const base = new PrismaClient(datasourceUrl ? { datasourceUrl } : undefined);

  return base.$extends({
    name: 'techpioasset-guards',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model && DELETE_OPERATIONS.has(operation) && UNDELETABLE_MODELS.has(model)) {
            throw new UndeletableModelError(model, operation.replace('Many', ''));
          }

          if (statusModelV2 && model === 'Asset' && WRITE_OPERATIONS.has(operation)) {
            // upsert carries create+update payloads; both get derived.
            const a = args as {
              data?: Record<string, unknown>;
              create?: Record<string, unknown>;
              update?: Record<string, unknown>;
            };
            if (operation === 'upsert') {
              deriveAssetDimensions(a.create);
              deriveAssetDimensions(a.update);
            } else {
              deriveAssetDimensions(a.data);
            }
          }

          if (model && READ_OPERATIONS.has(operation) && SOFT_DELETABLE_MODELS.has(model)) {
            const where = (args as { where?: Record<string, unknown> }).where ?? {};
            // `includeDeleted: true` is the documented opt-out for audit and
            // restore screens; anything else gets the filter applied.
            if (!('deletedAt' in where) && !('includeDeleted' in where)) {
              (args as { where?: Record<string, unknown> }).where = {
                ...where,
                deletedAt: null,
              };
            } else if ('includeDeleted' in where) {
              delete (where as Record<string, unknown>).includeDeleted;
            }
          }

          return query(args);
        },
      },
    },
  });
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

/** The client bound to an interactive transaction (no lifecycle/tx-control methods). */
export type TenantTxClient = Omit<
  ExtendedPrismaClient,
  '$connect' | '$disconnect' | '$on' | '$use' | '$transaction' | '$extends'
>;

/**
 * Wrap a tenant-bound transaction client so callers can still use `$transaction`.
 *
 * Services in this codebase open their own `client.$transaction(...)`, but Prisma
 * cannot nest interactive transactions. Inside a request-scoped tenant transaction
 * we therefore FLATTEN: a nested `$transaction(cb)` just runs `cb` with the same
 * tenant tx (so it participates in the one transaction), and the array form awaits
 * its queries in order on that tx. Trade-off: inner failures roll back the whole
 * request transaction rather than independently — acceptable under RLS_ENFORCE.
 */
function tenantTxProxy(tx: TenantTxClient): ExtendedPrismaClient {
  const proxy = new Proxy(tx as object, {
    get(target, prop, receiver) {
      if (prop === '$transaction') {
        return async (arg: unknown) => {
          if (typeof arg === 'function') return (arg as (c: unknown) => unknown)(proxy);
          if (Array.isArray(arg)) {
            const out: unknown[] = [];
            for (const p of arg) out.push(await p);
            return out;
          }
          throw new Error('Unsupported $transaction argument inside an RLS tenant transaction');
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as ExtendedPrismaClient;
  return proxy;
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly base: ExtendedPrismaClient;
  // v2.1 Workstream B — when a request runs inside `runInTenant`, the tenant-bound
  // (proxied) transaction client lives here so `client` resolves to it transparently.
  private readonly tenantTx = new AsyncLocalStorage<ExtendedPrismaClient>();

  constructor(config: AppConfig) {
    this.base = createPrismaClient(config.get('DATABASE_URL'), config.get('STATUS_MODEL_V2'));
  }

  /**
   * The Prisma client to use. Normally the base client; inside `runInTenant` it is
   * the tenant-bound transaction client, so every query sees `app.tenant_id` set
   * and the RLS policies (see the enable_row_level_security migration) enforce
   * isolation. Back-compatible: with no active tenant transaction this is `base`.
   */
  get client(): ExtendedPrismaClient {
    return this.tenantTx.getStore() ?? this.base;
  }

  /**
   * Run `fn` inside a transaction with `app.tenant_id` set to `companyId`, so the
   * RLS policies scope every query to that tenant. Requires the app to connect as
   * a NON-superuser role (superusers bypass RLS — see deploy/rls-app-role.sql).
   *
   * Enforcement is opt-in and gated by RLS_ENFORCE at the call site; this method
   * is the mechanism, verified against a non-superuser role. (Global auto-wiring
   * must first reconcile with services that open their own transactions — see #10.)
   */
  async runInTenant<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
    return this.base.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT set_config('app.tenant_id', $1, true)", companyId);
      return this.tenantTx.run(tenantTxProxy(tx as TenantTxClient), fn);
    });
  }

  /**
   * Connects eagerly but does not make the connection a boot requirement.
   *
   * Throwing here would kill the process whenever Postgres is unavailable, which
   * takes /health/ready down with it - precisely the endpoint whose job is to
   * report that Postgres is unavailable. Prisma connects lazily on first query,
   * so a failure here costs nothing beyond the warning, and the readiness probe
   * reports `postgres: down` as designed.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.base.$connect();
      this.logger.log('Database connection established');
    } catch (error) {
      this.logger.error(
        `Database unavailable at startup: ${(error as Error).message}. ` +
          'The API is serving in a degraded state; /health/ready reports the detail.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }

  /** Round-trip used by the readiness probe. */
  async ping(): Promise<number> {
    const started = process.hrtime.bigint();
    await this.base.$queryRaw`SELECT 1`;
    return Number((process.hrtime.bigint() - started) / 1_000_000n);
  }
}
