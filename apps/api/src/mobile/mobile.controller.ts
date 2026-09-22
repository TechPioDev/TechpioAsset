import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  deltaQuerySchema,
  registerDeviceSchema,
  startInventorySessionSchema,
  syncBatchSchema,
  type AuthUser,
  type SyncBatchInput,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { assetScopeFilter, tenantFilter } from '../common/scope.js';
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MobileSyncService } from './mobile-sync.service.js';

@ApiTags('Mobile')
@Controller('mobile')
export class MobileController {
  constructor(
    private readonly sync: MobileSyncService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Push device registration (spec section 19) ─────────────────────────────

  @Post('devices')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Register this device for push',
    description: 'Idempotent on the token — re-registering updates rather than duplicating.',
  })
  async registerDevice(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(registerDeviceSchema))
    body: { token: string; platform: 'ios' | 'android'; deviceName?: string },
  ) {
    // A token already registered to ANOTHER user is refused, not silently
    // reassigned - re-registering someone else's push token would redirect
    // their notifications to your handset (v2.12 least-privilege audit, G6).
    const existing = await this.prisma.client.deviceToken.findUnique({
      where: { token: body.token },
      select: { userId: true },
    });
    if (existing && existing.userId !== actor.id) {
      throw new AppError('CONFLICT', 'This device token is registered to another account');
    }
    await this.prisma.client.deviceToken.upsert({
      where: { token: body.token },
      update: {
        userId: actor.id,
        platform: body.platform,
        deviceName: body.deviceName,
        lastSeenAt: new Date(),
        revokedAt: null,
      },
      create: {
        userId: actor.id,
        token: body.token,
        platform: body.platform,
        deviceName: body.deviceName,
      },
    });
    return { registered: true };
  }

  @Delete('devices/:token')
  @HttpCode(204)
  @ApiOperation({ summary: 'Unregister a device (sign-out on mobile)' })
  async unregisterDevice(
    @CurrentUser() actor: AuthUser,
    @Param('token') token: string,
  ): Promise<void> {
    await this.prisma.client.deviceToken.updateMany({
      where: { token, userId: actor.id },
      data: { revokedAt: new Date() },
    });
  }

  // ── Delta pull (spec section 24 mobile synchronization) ────────────────────

  @Get('assets/delta')
  @RequirePermissions(PERMISSIONS.ASSETS_READ)
  @ApiOperation({
    summary: 'Assets changed since a timestamp',
    description: 'Scoped like every asset read; lets the device refresh its cache cheaply.',
  })
  async delta(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(deltaQuerySchema)) query: { since?: string; limit: number },
  ) {
    const assets = await this.prisma.client.asset.findMany({
      where: {
        AND: [
          assetScopeFilter(actor),
          query.since ? { updatedAt: { gt: new Date(query.since) } } : {},
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: query.limit,
      select: {
        id: true,
        assetTag: true,
        name: true,
        status: true,
        condition: true,
        qrToken: true,
        barcode: true,
        serialNumber: true,
        version: true,
        updatedAt: true,
        roomId: true,
      },
    });
    return { data: assets, syncedAt: new Date().toISOString() };
  }

  // ── Physical inventory (spec section 16) ───────────────────────────────────

  @Post('inventory/sessions')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({ summary: 'Start a physical inventory session' })
  async startSession(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(startInventorySessionSchema)) body: { name: string; officeId?: string },
  ) {
    const session = await this.prisma.client.physicalInventorySession.create({
      data: {
        companyId: actor.companyId,
        name: body.name,
        officeId: body.officeId ?? null,
        ownerId: actor.id,
        status: 'IN_PROGRESS',
        createdById: actor.id,
      },
      select: { id: true, name: true, status: true, startedAt: true },
    });
    return session;
  }

  @Get('inventory/sessions/:id')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Read a session with its scan reconciliation' })
  async session(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    const session = await this.prisma.client.physicalInventorySession.findFirst({
      where: { id, ...tenantFilter(actor) },
      include: {
        scans: {
          orderBy: { scannedAt: 'desc' },
          take: 500,
          select: {
            id: true,
            scannedCode: true,
            result: true,
            condition: true,
            scannedAt: true,
            asset: { select: { id: true, assetTag: true, name: true } },
          },
        },
      },
    });
    if (!session) throw AppError.notFound('Inventory session', id);

    // Reconciliation summary the app shows at close.
    const summary = session.scans.reduce<Record<string, number>>((acc, scan) => {
      acc[scan.result] = (acc[scan.result] ?? 0) + 1;
      return acc;
    }, {});

    return { ...session, summary };
  }

  // ── Offline sync (spec section 16) ─────────────────────────────────────────

  @Post('sync')
  // v2.82 - handovers and returns sync too; each operation is checked against
  // its own right in the service, so opening the door wider opens nothing else.
  @RequireAnyPermission(
    PERMISSIONS.INVENTORY_ADJUST,
    PERMISSIONS.ASSETS_ASSIGN,
    PERMISSIONS.ASSETS_RETURN,
  )
  @ApiOperation({
    summary: 'Replay a batch of queued offline operations',
    description:
      'Idempotent: a duplicate clientGeneratedId is a no-op, not a duplicate row, so a flaky ' +
      'connection can safely retry the whole queue.',
  })
  syncBatch(@CurrentUser() actor: AuthUser, @Body(zodBody(syncBatchSchema)) body: SyncBatchInput) {
    return this.sync.sync(actor, body);
  }
}
