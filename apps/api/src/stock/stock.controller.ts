import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  adjustStockSchema,
  pageQuerySchema,
  batchListQuerySchema,
  convertToAssetSchema,
  countCorrectionSchema,
  createInventoryItemSchema,
  createStockLocationSchema,
  issueStockSchema,
  returnStockSchema,
  reserveStockSchema,
  stockMovementQuerySchema,
  transferStockSchema,
  updateStockLocationSchema,
  type AdjustStockInput,
  type AuthUser,
  type BatchListQuery,
  type PageQuery,
  type ConvertToAssetInput,
  type CountCorrectionInput,
  type CreateInventoryItemInput,
  type CreateStockLocationInput,
  type IssueStockInput,
  type ReturnStockInput,
  type ReserveStockInput,
  type StockMovementQuery,
  type TransferStockInput,
  type UpdateStockLocationInput,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { StockService } from './stock.service.js';

/**
 * v2.4 Warehouse stock. Every mutation is an atomic conditional update with a
 * movement row in the same transaction; refusals carry the honest numbers.
 */
@ApiTags('stock')
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('locations')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Stock locations with level counts' })
  listLocations(@CurrentUser() actor: AuthUser) {
    return this.stock.listLocations(actor);
  }

  @Get('batches')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({
    summary: 'Lots on the shelf, soonest expiry first',
    description:
      'Each lot reports whether it is fine, going off soon or already expired - computed from ' +
      'the calendar, never stored, because a batch expires without anything happening to the row.',
  })
  listBatches(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(batchListQuerySchema)) query: BatchListQuery,
  ) {
    return this.stock.listBatches(actor, query);
  }

  @Post('locations')
  @RequirePermissions(PERMISSIONS.INVENTORY_LOCATIONS_MANAGE)
  @ApiOperation({ summary: 'Create a stock location' })
  createLocation(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createStockLocationSchema)) body: CreateStockLocationInput,
  ) {
    return this.stock.createLocation(actor, body);
  }

  @Patch('locations/:id')
  @RequirePermissions(PERMISSIONS.INVENTORY_LOCATIONS_MANAGE)
  @ApiOperation({ summary: 'Rename, re-home or de/activate a location' })
  updateLocation(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateStockLocationSchema)) body: UpdateStockLocationInput,
  ) {
    return this.stock.updateLocation(actor, id, body);
  }

  @Get('items')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({
    summary: 'The stock-item catalogue (picker; capped at 500 — pass q to search)',
    description:
      'Capped rather than paginated because this fills a dropdown. Past a few hundred options ' +
      'the picker is the limitation, not the query, so pass q to narrow it.',
  })
  listItems(@CurrentUser() actor: AuthUser, @Query('q') q?: string) {
    return this.stock.listItems(actor, q);
  }

  @Post('items')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({
    summary: 'Add an item to the stock catalogue',
    description:
      'Describes the item only - add quantity with POST /stock/adjust (positive delta + reason), ' +
      'so every unit on a shelf has a ledger row. SKU is unique per company, case-insensitively ' +
      '(409). unitCost needs the cost permission (403 otherwise).',
  })
  createItem(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createInventoryItemSchema)) body: CreateInventoryItemInput,
  ) {
    return this.stock.createItem(actor, body);
  }

  @Get('levels')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({
    summary: 'Per-location stock levels, paginated (filter by item or location)',
    description:
      'v2.10: paginated. One row per item/location pair, so it grows as the product of both.',
  })
  listLevels(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(pageQuerySchema)) query: PageQuery,
    @Query('inventoryItemId') inventoryItemId?: string,
    @Query('stockLocationId') stockLocationId?: string,
  ) {
    return this.stock.listLevels(actor, query, inventoryItemId, stockLocationId);
  }

  @Get('movements')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'The append-only movement ledger, newest first' })
  listMovements(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(stockMovementQuerySchema)) query: StockMovementQuery,
  ) {
    return this.stock.listMovements(actor, query);
  }

  @Post('issue')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({ summary: 'Issue stock out (guarded: never below reservations)' })
  issue(@CurrentUser() actor: AuthUser, @Body(zodBody(issueStockSchema)) body: IssueStockInput) {
    return this.stock.issue(actor, body);
  }

  @Post('return')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({
    summary: 'Take a consumable back from the person it was issued to (v2.21)',
    description: 'Refuses to take back more than that person is recorded as holding.',
  })
  returnFromUser(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(returnStockSchema)) body: ReturnStockInput,
  ) {
    return this.stock.returnFromUser(actor, body);
  }

  @Get('held-by/:userId')
  @ApiOperation({
    summary: 'Consumables a person currently holds (v2.21)',
    description:
      'Summed from the movement ledger - issues minus returns - so it cannot drift. ' +
      'No permission is required to read your own holdings; reading anyone else’s needs ' +
      'inventory:read. Enforced in the service, which is why the guard is absent here.',
  })
  heldBy(@CurrentUser() actor: AuthUser, @Param('userId') userId: string) {
    return this.stock.heldBy(actor, userId);
  }

  @Post('adjust')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({ summary: 'Manual correction with a mandatory reason' })
  adjust(@CurrentUser() actor: AuthUser, @Body(zodBody(adjustStockSchema)) body: AdjustStockInput) {
    return this.stock.adjust(actor, body);
  }

  @Post('transfer')
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({ summary: 'Move stock between locations (one tx, two ledger rows)' })
  transfer(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(transferStockSchema)) body: TransferStockInput,
  ) {
    return this.stock.transfer(actor, body);
  }

  @Post('reserve')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({ summary: 'Earmark stock without removing it' })
  reserve(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(reserveStockSchema)) body: ReserveStockInput,
  ) {
    return this.stock.reserve(actor, body);
  }

  @Post('release')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({ summary: 'Release a reservation' })
  release(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(reserveStockSchema)) body: ReserveStockInput,
  ) {
    return this.stock.release(actor, body);
  }

  @Post('count-correction')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({ summary: 'Post a cycle-count difference to the ledger' })
  countCorrection(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(countCorrectionSchema)) body: CountCorrectionInput,
  ) {
    return this.stock.countCorrection(actor, body);
  }

  @Post('convert-to-asset')
  @RequirePermissions(PERMISSIONS.INVENTORY_CONVERT)
  @ApiOperation({
    summary: 'Turn one stock unit into a tracked asset',
    description: 'Decrement and draft-asset creation happen in a single transaction.',
  })
  convertToAsset(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(convertToAssetSchema)) body: ConvertToAssetInput,
  ) {
    return this.stock.convertToAsset(actor, body);
  }
}
