import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { toCsv } from '../common/csv.js';
import {
  assetListQuerySchema,
  assignAssetSchema,
  bulkChangeStatusSchema,
  changeAssetStatusSchema,
  type BulkChangeStatusInput,
  createAssetSchema,
  pageQuerySchema,
  disposeAssetSchema,
  reassignAssetSchema,
  receiveTransferSchema,
  returnAssetSchema,
  transferAssetSchema,
  setAssetPriceSchema,
  updateAssetSchema,
  type AssetListQuery,
  type AssignAssetInput,
  type AuthUser,
  type CreateAssetInput,
  type PageQuery,
  type DisposeAssetInput,
  type ReassignAssetInput,
  type ReceiveTransferInput,
  type ReturnAssetInput,
  type TransferAssetInput,
  type UpdateAssetInput,
  warrantyExtractSchema,
} from '@techpioasset/contracts';
import { ASSET_VERIFY_PERMISSIONS, PERMISSIONS, type AssetStatus } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { AppError } from '../common/errors/app-error.js';
import { AssetPhotosService } from './asset-photos.service.js';
import { AssetVerificationService } from './asset-verification.service.js';
import { assertSpreadsheet } from '../providers/storage/file-validation.js';
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../auth/decorators.js';
import { AssetsService } from './assets.service.js';
import { AssetImportService } from './asset-import.service.js';
import { AssetPriceSheetService } from './asset-price-sheet.service.js';
import { LenovoWarrantyService } from './lenovo-warranty.service.js';
import { AssetHealthService } from '../asset-health/asset-health.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '@prisma/client';

/**
 * A phone photograph, not a scan. 15 MB covers a modern handset's full-quality
 * output with room to spare, and the service re-checks against the tenant's
 * own MAX_UPLOAD_MB, so a deployment that wants less gets less.
 */
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

@ApiTags('Assets')
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly photos: AssetPhotosService,
    private readonly verification: AssetVerificationService,
    private readonly imports: AssetImportService,
    private readonly health: AssetHealthService,
    private readonly audit: AuditService,
    private readonly lenovoWarranty: LenovoWarrantyService,
    private readonly priceSheet: AssetPriceSheetService,
  ) {}

  @Post('import')
  @RequirePermissions(PERMISSIONS.ASSETS_IMPORT)
  @ApiOperation({
    summary: 'Bulk-import assets from an Excel sheet',
    description:
      'Upserts assets by serial number and creates any referenced employees as ' +
      'no-login records. Returns a summary of what was created, updated and skipped.',
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async import(
    @CurrentUser() actor: AuthUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 15 * 1024 * 1024 })],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file?.buffer) throw new AppError('FILE_REJECTED', 'No file was received');
    // Verify the bytes are a workbook before the parser sees them - the
    // filename is a claim, not evidence.
    assertSpreadsheet(file.buffer);
    const rows = await this.imports.parseWorkbook(file.buffer);
    return this.imports.importRows(actor, rows);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Price sheet (v2.59) - purchase price and date for existing assets, by Excel.
  // Money needs cost visibility; writing to assets needs import OR update.
  // Declared before ':id' so the static path wins the route match.
  // ───────────────────────────────────────────────────────────────────────────

  @Get('price-sheet')
  @RequirePermissions(PERMISSIONS.ASSETS_COST_READ)
  @RequireAnyPermission(PERMISSIONS.ASSETS_IMPORT, PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({
    summary: 'Download the price sheet (.xlsx)',
    description:
      'Every asset in scope with its current purchase price and date, and two columns to fill ' +
      'in. Needs assets:cost:read and either assets:import or assets:update.',
  })
  async downloadPriceSheet(
    @CurrentUser() actor: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, filename } = await this.priceSheet.download(actor);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(file);
  }

  @Post('price-sheet')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ASSETS_COST_READ)
  @RequireAnyPermission(PERMISSIONS.ASSETS_IMPORT, PERMISSIONS.ASSETS_UPDATE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Check or apply a filled price sheet',
    description:
      'dryRun=true (the default) reports what each row would do and changes nothing; ' +
      'dryRun=false applies it. A recorded price or date is never overwritten.',
  })
  async uploadPriceSheet(
    @CurrentUser() actor: AuthUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 15 * 1024 * 1024 })],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
    @Query('dryRun') dryRun?: string,
  ) {
    if (!file?.buffer) throw new AppError('FILE_REJECTED', 'No file was received');
    if (dryRun !== undefined && dryRun !== 'true' && dryRun !== 'false') {
      throw new AppError('VALIDATION_FAILED', 'dryRun must be true or false');
    }
    assertSpreadsheet(file.buffer);
    // Anything but an explicit false is a preview: applying must be deliberate.
    return this.priceSheet.upload(actor, file.buffer, dryRun !== 'false');
  }

  @Get()
  @RequirePermissions(PERMISSIONS.ASSETS_READ)
  @ApiOperation({
    summary: 'List assets',
    description:
      'Results are restricted to the caller’s data scope. An employee sees only assets assigned ' +
      'to them; cost columns are omitted entirely without assets:cost:read.',
  })
  list(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(assetListQuerySchema)) query: AssetListQuery,
  ) {
    return this.assets.list(actor, query);
  }

  // Declared before ':id' so the static path wins the route match.
  @Get('export')
  @RequirePermissions(PERMISSIONS.ASSETS_READ)
  @ApiOperation({
    summary: 'Export the current asset view as CSV',
    description:
      'Honours the same filters and scope as the list; cost is a column only with access.',
  })
  async export(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(assetListQuerySchema)) query: AssetListQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { columns, rows } = await this.assets.exportRows(actor, query);
    // v2.7 R2 (AUD-009): the asset CSV is an export like any other.
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.REPORT_EXPORTED,
      entityType: 'Report',
      entityId: 'ASSET_CSV',
      newValues: { format: 'CSV', rows: rows.length, delivery: 'DOWNLOAD' },
    });
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="assets-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store',
    });
    return toCsv(columns, rows);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Physical verification (v2.72). Declared before ':id' so "verification" is
  // never read as an asset id.
  // ───────────────────────────────────────────────────────────────────────────

  @Get('verification/summary')
  @RequirePermissions(PERMISSIONS.ASSETS_READ)
  @ApiOperation({
    summary: 'Where this quarter’s verification round stands',
    description:
      'How many assets the round expects, how many have been physically seen since the ' +
      'quarter began, and the first 50 that have not. Scoped like every asset read, so an ' +
      'auditor sees the company and an employee sees their own equipment.',
  })
  verificationSummary(@CurrentUser() actor: AuthUser) {
    return this.verification.summary(actor);
  }

  @Get('by-qr/:token')
  @RequirePermissions(PERMISSIONS.ASSETS_READ)
  @ApiOperation({
    summary: 'Resolve a QR token',
    description: 'Requires authentication and honours scope, so a scanned code leaks nothing.',
  })
  async byQr(@CurrentUser() actor: AuthUser, @Param('token') token: string) {
    const asset = await this.assets.findByQrToken(actor, token);
    // v2.72 - the scanner shows when the unit was last seen, and offers to mark it.
    return { ...asset, lastVerification: await this.verification.latestFor(asset.id) };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ASSETS_READ)
  @ApiOperation({
    summary: 'Read one asset with history, discovered hardware/OS and health',
  })
  async findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    const asset = await this.assets.findOne(actor, id);
    return { ...asset, lastVerification: await this.verification.latestFor(id) };
  }

  @Post(':id/verifications')
  @RequireAnyPermission(...ASSET_VERIFY_PERMISSIONS)
  @ApiOperation({
    summary: 'Record that this asset was physically seen',
    description:
      'For a verification round. Changes nothing about the asset. A repeat by the same person ' +
      'within two minutes answers with the first confirmation. Refused for an asset recorded ' +
      'as disposed, donated, retired, lost or stolen.',
  })
  verifyAsset(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: { note?: unknown; method?: unknown },
  ) {
    const note = typeof body?.note === 'string' ? body.note : null;
    const method = body?.method === 'MANUAL' ? 'MANUAL' : 'SCAN';
    return this.verification.verify(actor, id, { note, method });
  }

  @Get(':id/software')
  @RequirePermissions(PERMISSIONS.ASSETS_READ)
  @ApiOperation({ summary: 'Discovered software inventory, paginated' })
  listSoftware(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Query(zodBody(pageQuerySchema)) query: PageQuery,
  ) {
    return this.assets.listSoftware(actor, id, query);
  }

  @Post(':id/health/recompute')
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({
    summary: 'Recompute the health score now',
    description: 'Returns null when nothing is known about the machine - never a fabricated score.',
  })
  async recomputeHealth(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    // Scope check first: the service recomputes by companyId, the actor must see the asset.
    await this.assets.findOne(actor, id);
    return this.health.recomputeForAsset(actor.companyId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ASSETS_CREATE)
  @ApiOperation({ summary: 'Create an asset' })
  create(@CurrentUser() actor: AuthUser, @Body(zodBody(createAssetSchema)) body: CreateAssetInput) {
    return this.assets.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({ summary: 'Update an asset' })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateAssetSchema)) body: UpdateAssetInput,
  ) {
    return this.assets.update(actor, id, body);
  }

  @Post(':id/warranty-refresh')
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({
    summary: 'Fetch and record the warranty dates from the manufacturer (Lenovo)',
    description:
      'Looks the serial up at Lenovo and records the returned coverage dates ' +
      'with an audit entry. Available for Lenovo devices; other makers refuse ' +
      'with an explanation.',
  })
  refreshWarranty(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.lenovoWarranty.refreshAsset(actor, id);
  }

  @Post(':id/warranty-extract')
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({
    summary: 'Propose a warranty end date from pasted vendor-page text (AI)',
    description:
      'Reads text the caller pasted from the manufacturer warranty page and ' +
      'proposes a coverage end date. Nothing is saved - the caller confirms via ' +
      'the ordinary asset update. Gated on the WARRANTY_EXTRACTION AI feature.',
  })
  extractWarranty(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(warrantyExtractSchema)) body: { text: string },
  ) {
    return this.assets.extractWarranty(actor, id, body.text);
  }

  @Patch(':id/price')
  @RequirePermissions(PERMISSIONS.ASSETS_COST_READ)
  @ApiOperation({
    summary: 'Record an asset price (write-once)',
    description:
      'Finance records a price once; after that it is locked and only a Super Admin ' +
      'may correct it. Every price write is audit-logged.',
  })
  setPrice(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(setAssetPriceSchema)) body: { purchaseCost: string; currency?: string },
  ) {
    return this.assets.setPrice(actor, id, body);
  }

  // Declared before ':id/status' so the static path wins the route match.
  @Post('bulk/status')
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({
    summary: 'Change status on many assets at once',
    description:
      'Each asset is validated individually against the state machine; the response ' +
      'lists what succeeded and what did not, so partial failures are explicit.',
  })
  changeStatusBulk(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(bulkChangeStatusSchema)) body: BulkChangeStatusInput,
  ) {
    return this.assets.changeStatusBulk(actor, body.ids, body.status, body.reason);
  }

  @Post(':id/status')
  @ApiOperation({
    summary: 'Change status, validated against the state machine',
    description:
      'Needs assets:update, with one narrow exception enforced in the service: the person ' +
      'currently holding an asset may report it DAMAGED without it. That is why there is no ' +
      'guard here - the rule depends on who holds the asset, which a decorator cannot see.',
  })
  changeStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(changeAssetStatusSchema)) body: { status: AssetStatus; reason?: string },
  ) {
    return this.assets.changeStatus(actor, id, body.status, body.reason);
  }

  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.ASSETS_ASSIGN)
  @ApiOperation({ summary: 'Assign an asset to an employee' })
  assign(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(assignAssetSchema)) body: AssignAssetInput,
  ) {
    return this.assets.assign(actor, id, body);
  }

  @Post(':id/reassign')
  @RequirePermissions(PERMISSIONS.ASSETS_ASSIGN, PERMISSIONS.ASSETS_RETURN)
  @ApiOperation({
    summary: 'Hand an asset straight from its current holder to another',
    description:
      'One transaction: the outgoing holder gets a real return record and the incoming one a new assignment, with no window where the asset belongs to nobody.',
  })
  reassign(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(reassignAssetSchema)) body: ReassignAssetInput,
  ) {
    return this.assets.reassign(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ASSETS_DELETE)
  @ApiOperation({
    summary: 'Delete a record that should never have existed',
    description:
      'For import mistakes and duplicates - a device that was never there. Distinct from ' +
      'dispose, which records a real end of life. Soft: the row keeps its history, is ' +
      'excluded from every read, and any open assignment is closed with it.',
  })
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    return this.assets.softDelete(actor, id, reason);
  }

  @Post(':id/dispose')
  @RequirePermissions(PERMISSIONS.ASSETS_DISPOSE)
  @ApiOperation({
    summary: "Record an asset's end of life",
    description:
      'Writes a DisposalRecord (method, date, recipient, proceeds, reason) and moves the asset to its terminal status. Recorded, never a delete.',
  })
  dispose(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(disposeAssetSchema)) body: DisposeAssetInput,
  ) {
    return this.assets.dispose(actor, id, body);
  }

  @Post(':id/transfer')
  @RequirePermissions(PERMISSIONS.ASSETS_TRANSFER)
  @ApiOperation({
    summary: 'Send an asset to another office',
    description:
      'The asset goes IN_TRANSIT and stays attributed to the origin office until the destination confirms arrival.',
  })
  transfer(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(transferAssetSchema)) body: TransferAssetInput,
  ) {
    return this.assets.transfer(actor, id, body);
  }

  @Post(':id/transfer/receive')
  @RequirePermissions(PERMISSIONS.ASSETS_TRANSFER)
  @ApiOperation({
    summary: 'Confirm an in-transit asset arrived',
    description: 'Closes the open transfer and moves the asset to the destination office.',
  })
  receiveTransfer(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(receiveTransferSchema)) body: ReceiveTransferInput,
  ) {
    return this.assets.receiveTransfer(actor, id, body);
  }

  @Post(':id/return')
  @RequirePermissions(PERMISSIONS.ASSETS_RETURN)
  @ApiOperation({ summary: 'Receive an asset back from an employee' })
  return(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(returnAssetSchema)) body: ReturnAssetInput,
  ) {
    return this.assets.return(actor, id, body);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Condition photos (v2.32) — evidence at handover and at return.
  // ───────────────────────────────────────────────────────────────────────────

  @Post(':id/photos')
  // No permission decorator on purpose - authorisation is in the service,
  // because it is not a pure role question. Either custody right is enough (the
  // person handing kit out and the person taking it back are often different
  // people), and so is simply BEING the current holder, until you confirm
  // receipt. A guard here could only express the first half.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Photograph an asset at handover or at return',
    description:
      'stage=HANDOVER files the photo against the open assignment; stage=RETURN against the ' +
      'return that closed one. The custody event is resolved on the server, never sent by the client. ' +
      'Open to assets:assign / assets:return, and to the current holder until they confirm receipt.',
  })
  addPhoto(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_PHOTO_BYTES })],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
    @Body('stage') stage?: string,
    @Body('caption') caption?: string,
  ) {
    if (!file?.buffer) throw new AppError('FILE_REJECTED', 'No photo was received');
    if (stage !== 'HANDOVER' && stage !== 'RETURN') {
      throw new AppError('VALIDATION_FAILED', 'stage must be HANDOVER or RETURN');
    }
    return this.photos.add(
      actor,
      id,
      stage,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      caption,
    );
  }

  @Get(':id/photos')
  @RequirePermissions(PERMISSIONS.ASSETS_READ)
  @ApiOperation({ summary: "An asset's condition photos, grouped by custody event" })
  listPhotos(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.photos.list(actor, id);
  }

  @Get(':id/photos/:photoId')
  @RequirePermissions(PERMISSIONS.ASSETS_READ)
  @ApiOperation({ summary: 'Fetch one condition photo' })
  async readPhoto(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const photo = await this.photos.read(actor, id, photoId);
    res.set({
      'Content-Type': photo.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(photo.originalName)}"`,
      // Evidence about a named person's equipment: never a shared cache.
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(photo.data);
  }

  @Delete(':id/photos/:photoId')
  @HttpCode(200)
  // Same as the upload: the service decides, since a holder may take back their
  // own photo before confirming receipt.
  @ApiOperation({
    summary: 'Remove a condition photo',
    description:
      'Only while its handover is still open. Once a return has closed it the photo is the ' +
      '"before" side of a comparison and is kept.',
  })
  removePhoto(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ) {
    return this.photos.remove(actor, id, photoId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // The asset's own picture (v2.61) — what the unit looks like, for the image
  // card. One per asset; a second upload replaces the first.
  // ───────────────────────────────────────────────────────────────────────────

  @Post(':id/photo')
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: "Set or replace the asset's picture",
    description:
      'JPG/PNG/WEBP/HEIC, decided by the file signature. Replaces any picture already ' +
      'there. Shown on the detail page unless the unit came through the catalogue, whose ' +
      'listing picture takes precedence.',
  })
  setPhoto(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_PHOTO_BYTES })],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file?.buffer) throw new AppError('FILE_REJECTED', 'No photo was received');
    return this.photos.setAssetPhoto(actor, id, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    });
  }

  @Delete(':id/photo')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({ summary: "Remove the asset's picture" })
  removeAssetPhoto(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.photos.removeAssetPhoto(actor, id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Up to five photographs of the unit (v2.65). The two routes above stay for
  // the phones already installed: they set, replace and remove the cover.
  // ───────────────────────────────────────────────────────────────────────────

  @Post(':id/unit-photos')
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Add a photograph of the unit, or replace one',
    description:
      'At most five per asset; a sixth is refused. `?replace=<photoId>` swaps that ' +
      'photograph for the upload and deletes the old file. The first becomes the cover, ' +
      'and a replacement of the cover stays the cover.',
  })
  addUnitPhoto(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Query('replace') replace: string | undefined,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_PHOTO_BYTES })],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file?.buffer) throw new AppError('FILE_REJECTED', 'No photo was received');
    return this.photos.addAssetPhoto(
      actor,
      id,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      replace || null,
    );
  }

  @Post(':id/unit-photos/:photoId/cover')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({ summary: "Make one of the unit's photographs the cover" })
  setUnitPhotoCover(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ) {
    return this.photos.setAssetCover(actor, id, photoId);
  }

  @Patch(':id/primary-photo')
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({
    summary: "Choose the asset's primary picture",
    description:
      'Body `{ photoId }`: any photograph on the asset - of the unit, or a handover or ' +
      'return photo. It leads the detail page and the slideshow. `{ photoId: null }` ' +
      'clears the choice. Nothing is moved or deleted.',
  })
  setPrimaryPhoto(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: { photoId?: unknown },
  ) {
    const photoId = body?.photoId ?? null;
    if (photoId !== null && (typeof photoId !== 'string' || photoId.length > 64)) {
      throw new AppError('VALIDATION_FAILED', 'Expected a photo id or null', {
        fieldErrors: [{ path: 'photoId', message: 'Expected a photo id or null' }],
      });
    }
    return this.photos.setPrimaryPhoto(actor, id, photoId);
  }

  @Delete(':id/unit-photos/:photoId')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ASSETS_UPDATE)
  @ApiOperation({
    summary: "Remove one of the unit's photographs",
    description: 'Deletes the file. Removing the cover hands the cover to the oldest one left.',
  })
  removeUnitPhoto(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ) {
    return this.photos.removeAssetPhotoById(actor, id, photoId);
  }

  @Post('assignments/:assignmentId/acknowledge')
  @ApiOperation({
    summary: 'Confirm receipt of an assigned asset',
    description:
      'No permission required - but only the assignee may acknowledge, enforced in the service.',
  })
  acknowledge(@CurrentUser() actor: AuthUser, @Param('assignmentId') assignmentId: string) {
    return this.assets.acknowledgeAssignment(actor, assignmentId);
  }
}
