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
import 'multer';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  openDuplicateQuerySchema,
  type OpenDuplicateQuery,
  catalogItemSchema,
  approvalDecisionSchema,
  createRequestSchema,
  requestCommentSchema,
  requestListQuerySchema,
  requestStatusEnum,
  upsertAssessmentSchema,
  type AuthUser,
  type CreateRequestInput,
  type RequestListQuery,
  type UpsertAssessmentInput,
} from '@techpioasset/contracts';
import { PERMISSIONS, type RequestStatus } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { AssessmentsService } from './assessments.service.js';
import { toCsv } from '../common/csv.js';
import { AppError } from '../common/errors/app-error.js';
import { CurrentUser, Public, RequireAnyPermission, RequirePermissions } from '../auth/decorators.js';
import { safeDownloadName } from '../common/signed-download-link.js';
import { RequestsService } from './requests.service.js';

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const advanceSchema = z.object({ status: requestStatusEnum });
const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

@ApiTags('Requests')
@Controller('requests')
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly assessments: AssessmentsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.REQUESTS_READ)
  @ApiOperation({
    summary: 'List requests',
    description:
      'Scoped to the caller. An employee sees only their own requests and those raised for them; ' +
      'a manager also sees their direct reports’. Pass awaitingMe=true for an approvals inbox.',
  })
  list(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(requestListQuerySchema)) query: RequestListQuery,
  ) {
    return this.requests.list(actor, query);
  }

  // Declared before ':id' so the static path wins the route match.
  @Get('export')
  @RequirePermissions(PERMISSIONS.REQUESTS_READ)
  @ApiOperation({ summary: 'Export the current requests view as CSV' })
  async export(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(requestListQuerySchema)) query: RequestListQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { columns, rows } = await this.requests.exportRows(actor, query);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="requests-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store',
    });
    return toCsv(columns, rows);
  }

  @Get('types')
  @ApiOperation({ summary: 'Request types' })
  types() {
    return this.requests.types();
  }

  @Get('can-create')
  @ApiOperation({
    summary: 'May the caller raise a request right now? (v2.22)',
    description:
      'The company policy and any per-person exception, resolved. The form asks this so the ' +
      'button and the server give the same answer; the server enforces it regardless.',
  })
  canCreate(@CurrentUser() actor: AuthUser) {
    return this.requests.canCreate(actor);
  }

  @Get('eligible-assets')
  @RequirePermissions(PERMISSIONS.REQUESTS_CREATE)
  @ApiOperation({
    summary: "The caller's own assigned assets, for asset-linked requests",
    description:
      'Upgrade, repair and replacement requests pick from here. Scoped to the ' +
      'requester server-side; contains no cost fields.',
  })
  eligibleAssets(@CurrentUser() actor: AuthUser) {
    return this.requests.eligibleAssets(actor);
  }

  @Get('catalog')
  @RequirePermissions(PERMISSIONS.REQUESTS_CREATE)
  @ApiOperation({
    summary: 'Equipment catalog for the request form',
    description:
      'Domain baseline merged with the distinct asset names this company owns, ' +
      'grouped by category.',
  })
  catalog(@CurrentUser() actor: AuthUser) {
    return this.requests.equipmentCatalog(actor);
  }

  @Get('open-duplicate')
  @RequirePermissions(PERMISSIONS.REQUESTS_CREATE)
  @ApiOperation({
    summary: 'Whether an open ticket already covers this request',
    description:
      'Pre-check for the form: same type about the same asset (or item), still ' +
      'in flight and younger than 10 days. The create endpoint enforces the ' +
      'same rule with a 409.',
  })
  openDuplicate(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(openDuplicateQuerySchema)) query: OpenDuplicateQuery,
  ) {
    return this.requests.openDuplicate(actor, query);
  }

  @Post('catalog-items')
  @RequirePermissions(PERMISSIONS.ASSETS_CREATE)
  @ApiOperation({
    summary: 'Promote an uncatalogued item name into the equipment catalog',
    description:
      'Admin review action. Creates a catalog NAME only - never an asset or ' +
      'serial; rejects case-insensitive duplicates.',
  })
  addCatalogItem(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(catalogItemSchema)) body: { name: string; categoryId?: string | null },
  ) {
    return this.requests.addCatalogItem(actor, body);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.REQUESTS_READ)
  @ApiOperation({ summary: 'Read a request with its approval chain and comments' })
  findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.requests.findOne(actor, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.REQUESTS_CREATE)
  @ApiOperation({ summary: 'Create a draft request' })
  create(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createRequestSchema)) body: CreateRequestInput,
  ) {
    return this.requests.create(actor, body);
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.REQUESTS_CREATE)
  @ApiOperation({
    summary: 'Submit a draft for approval',
    description:
      'Materialises the configured workflow into an approval chain, applying cost thresholds.',
  })
  submit(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.requests.submit(actor, id);
  }

  @Get(':id/assessment')
  @RequirePermissions(PERMISSIONS.REQUESTS_ASSESS)
  @ApiOperation({
    summary: 'The commercial assessment of a request',
    description:
      'Inventory check, vendor, prices and the computed total. Behind requests:assess, so the ' +
      'requester never sees the commercial side of their own request.',
  })
  getAssessment(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.assessments.get(actor, id);
  }

  @Patch(':id/assessment')
  @RequirePermissions(PERMISSIONS.REQUESTS_ASSESS)
  @ApiOperation({
    summary: 'Record or update the commercial assessment',
    description:
      'Fields are merged, so a partial update leaves the rest alone. The total is computed from ' +
      'the parts and is never accepted from the caller - it is what decides whether Finance ' +
      'reviews the spend.',
  })
  upsertAssessment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(upsertAssessmentSchema)) body: UpsertAssessmentInput,
  ) {
    return this.assessments.upsert(actor, id, body);
  }

  @Post(':id/review')
  @RequirePermissions(PERMISSIONS.REQUESTS_APPROVE)
  @ApiOperation({
    summary: 'Mark the current step as under review',
    description:
      'The approver of the current step signals they are looking at the request without deciding ' +
      'yet. Informational only: the chain shows "Under review" instead of "Awaiting decision" and ' +
      'the requester is notified. Idempotent - the first reviewer sticks.',
  })
  startReview(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.requests.startReview(actor, id);
  }

  @Post(':id/decision')
  // Approving and refusing are different rights held by different roles, so the
  // door opens to either and `decide` enforces which one the body asks for.
  @RequireAnyPermission(PERMISSIONS.REQUESTS_APPROVE, PERMISSIONS.REQUESTS_DECLINE)
  @ApiOperation({
    summary: 'Approve or reject the current step',
    description:
      'Approving needs requests:approve; rejecting needs requests:approve or requests:decline. ' +
      'Neither is sufficient alone — the caller must also be the approver for the step the ' +
      'request is currently waiting on (directly or via an active delegation), and a delegation ' +
      'alone is not enough without the permission.',
  })
  decide(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(approvalDecisionSchema))
    body: { decision: 'APPROVED' | 'REJECTED'; comment?: string },
  ) {
    return this.requests.decide(actor, id, body.decision, body.comment);
  }

  @Post(':id/advance')
  @RequirePermissions(PERMISSIONS.REQUESTS_APPROVE)
  @ApiOperation({ summary: 'Move an approved request through fulfilment' })
  advance(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(advanceSchema)) body: { status: RequestStatus },
  ) {
    return this.requests.advance(actor, id, body.status);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.REQUESTS_CANCEL)
  @ApiOperation({ summary: 'Cancel a request' })
  cancel(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(cancelSchema)) body: { reason?: string },
  ) {
    return this.requests.cancel(actor, id, body.reason);
  }

  @Post(':id/comments')
  @RequirePermissions(PERMISSIONS.REQUESTS_READ)
  @ApiOperation({ summary: 'Add a comment' })
  comment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(requestCommentSchema)) body: { body: string; isInternal: boolean },
  ) {
    return this.requests.addComment(actor, id, body.body, body.isInternal);
  }

  // Attachments — read permission is enough because the service gates on the
  // request's own scope (findOne 404s a request the caller may not see).
  @Post(':id/attachments')
  @RequirePermissions(PERMISSIONS.REQUESTS_READ)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Attach a file to a request (photo, spec sheet, quote)' })
  addAttachment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_ATTACHMENT_BYTES })],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
    @Body('caption') caption?: string,
  ) {
    if (!file?.buffer) throw new AppError('FILE_REJECTED', 'No file was received');
    return this.requests.addAttachment(
      actor,
      id,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      caption,
    );
  }

  @Get(':id/attachments/:attachmentId')
  @RequirePermissions(PERMISSIONS.REQUESTS_READ)
  @ApiOperation({ summary: 'Download a request attachment' })
  async downloadAttachment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const att = await this.requests.getAttachment(actor, id, attachmentId);
    res.set({
      'Content-Type': att.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(att.originalName)}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(att.data);
  }

  @Post(':id/attachments/:attachmentId/link')
  @RequirePermissions(PERMISSIONS.REQUESTS_READ)
  @ApiOperation({
    summary: 'A two-minute download link for one request attachment',
    description:
      'For the phone app, which can open a link in the system browser but cannot attach a ' +
      'sign-in header to it. Access is checked here, through the same scope gate as the ' +
      'download; the link names only that attachment and stops working after two minutes.',
  })
  attachmentLink(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.requests.createAttachmentLink(actor, id, attachmentId);
  }

  // Public on purpose, and only this one route: the signature is the credential.
  @Get('attachment-links/:token')
  @Public()
  @ApiOperation({ summary: 'Download a request attachment through a signed link' })
  async readAttachmentLink(@Param('token') token: string, @Res() res: Response) {
    const att = await this.requests.readAttachmentByLink(token);
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeDownloadName(att.originalName)}"`);
    // Never cached: a link is meant to stop working, and a cache would not.
    res.setHeader('Cache-Control', 'no-store');
    res.send(att.data);
  }

  @Delete(':id/attachments/:attachmentId')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.REQUESTS_READ)
  @ApiOperation({ summary: 'Remove a request attachment you added' })
  removeAttachment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.requests.removeAttachment(actor, id, attachmentId);
  }
}
