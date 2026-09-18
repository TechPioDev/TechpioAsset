import { Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '@techpioasset/contracts';
import { MAX_ASSET_PHOTOS, PERMISSIONS, assetPhotoLimitMessage } from '@techpioasset/domain';
import { AuditAction } from '@prisma/client';
import { AppConfig } from '../config/config.module.js';
import { AppError } from '../common/errors/app-error.js';
import { tenantFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageProvider } from '../providers/storage/storage.provider.js';
import { validateUpload } from '../providers/storage/file-validation.js';

/**
 * Condition photos for an asset (v2.32).
 *
 * The point is not a picture of a laptop. It is evidence of what condition a
 * specific laptop was in at the two moments that are ever disputed: when it was
 * handed to someone, and when they gave it back. "It already had that dent" is
 * unanswerable without them, and the argument always happens months later.
 *
 * So a photo is not filed against the asset in general - it is filed against a
 * custody event:
 *
 *   HANDOVER - the open AssetAssignment. What it looked like going out.
 *   RETURN   - the AssetReturn that closed one. What came back.
 *
 * That is what makes the pair comparable. A flat gallery on the asset would
 * hold the same images and answer none of the question, because nobody could
 * say which visit each one belonged to.
 *
 * Reuses the existing Attachment table rather than adding one. It already
 * carries the hash, the size, the scan status and the uploader, and its
 * entityType/entityId pair is indexed for exactly this.
 */

/** The two moments worth photographing. */
export type PhotoStage = 'HANDOVER' | 'RETURN';

const ENTITY_TYPE: Record<PhotoStage, string> = {
  HANDOVER: 'AssetAssignment',
  RETURN: 'AssetReturn',
};

/**
 * The asset's own picture (v2.61) - not evidence of anything, just what the
 * unit looks like, for the detail page's image card. Filed under its own
 * entity type so the condition-photo list and its removal rules never see it.
 */
const ASSET_PHOTO_ENTITY = 'AssetPhoto';

/**
 * Photos only. The generic attachment endpoint takes spreadsheets and PDFs;
 * this one is evidence a person will look at and compare, and a PDF cannot be
 * put side by side with a photograph.
 *
 * HEIC is deliberately in the list: it is what an iPhone produces by default,
 * and the people photographing equipment at a desk are using their phones.
 */
const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/**
 * Ceilings for the photo list (v2.39).
 *
 * Both reads here were unbounded, which the repo's own bounded-reads guard
 * flags: an asset's custody history and its photos both grow with use, and
 * neither has any cap on the write side - nothing stops fifty photos being
 * attached to one handover.
 *
 * These are set far beyond any real asset's life rather than tuned tight,
 * because the payload is evidence: an asset that hit the ceiling would be one
 * whose oldest handover quietly stopped being visible, and that is the one
 * moment somebody is arguing about. Reaching either is logged rather than
 * passed over in silence, so if it ever happens we find out from a log line
 * instead of from a dispute.
 */
const MAX_CUSTODY_EVENTS = 200;
const MAX_PHOTOS = 1000;

@Injectable()
export class AssetPhotosService {
  private readonly logger = new Logger(AssetPhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageProvider,
    private readonly config: AppConfig,
  ) {}

  /** The asset, scoped to the caller's tenant. 404 rather than 403 for another company's id. */
  private async assetOr404(actor: AuthUser, assetId: string) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id: assetId, deletedAt: null, ...tenantFilter(actor) },
      select: { id: true, assetTag: true, name: true },
    });
    if (!asset) throw AppError.notFound('Asset not found');
    return asset;
  }

  /**
   * The custody event a photo of this stage belongs to.
   *
   * Resolved on the server from the asset's current state rather than taken
   * from the client. A client that has to name the assignment id can name the
   * wrong one, and a photo filed against the previous holder's handover is
   * worse than no photo - it is evidence pointing at the wrong person.
   */
  private async resolveEvent(assetId: string, stage: PhotoStage) {
    if (stage === 'HANDOVER') {
      const open = await this.prisma.client.assetAssignment.findFirst({
        where: { assetId, returnedAt: null },
        orderBy: { assignedAt: 'desc' },
        select: { id: true, assignedAt: true },
      });
      if (!open) {
        throw new AppError('VALIDATION_FAILED', 'This asset is not currently assigned to anyone', {
          detail: 'Handover photos belong to an active assignment. Assign the asset first.',
        });
      }
      return { id: open.id, at: open.assignedAt };
    }

    const latest = await this.prisma.client.assetReturn.findFirst({
      where: { assignment: { assetId } },
      orderBy: { returnedAt: 'desc' },
      select: { id: true, returnedAt: true },
    });
    if (!latest) {
      throw new AppError('VALIDATION_FAILED', 'This asset has never been returned', {
        detail: 'Return photos belong to a return record. Complete the return first.',
      });
    }
    return { id: latest.id, at: latest.returnedAt };
  }

  /** True when the actor holds a custody right, which is the general licence. */
  private hasCustodyRight(actor: AuthUser): boolean {
    return PHOTO_WRITE_PERMISSIONS.some((p) => actor.permissions.includes(p));
  }

  /**
   * Who may add or remove a photo, and until when (v2.35).
   *
   * Two quite different licences:
   *
   * CUSTODY - assets:assign / assets:return. The general one. Bounded only by
   *   the rules in `remove`.
   *
   * HOLDER - the person the asset is currently out with, with no permission at
   *   all. They may ADD a photo of anything they hold at any time: a mouse or a
   *   monitor gets damaged months after it was issued, and the person holding
   *   it is the only one looking at it.
   *
   *   What their confirmation of receipt locks is REMOVAL, not addition. Photos
   *   taken before they confirmed are their account of what they were handed,
   *   and once they have said "I received this" that account stops being theirs
   *   to withdraw - otherwise the record could be quietly revised later by the
   *   person it would exonerate. Adding to the record is harmless; every photo
   *   carries the moment it was taken, so a picture added a year later cannot
   *   pass as evidence of the handover.
   *
   * A holder may only add HANDOVER photos. A return is a custody act performed
   *   by whoever receives the equipment back, and letting the departing holder
   *   file the "what came back" evidence would defeat the comparison entirely.
   */
  private async authorizeWrite(
    actor: AuthUser,
    assetId: string,
    stage: PhotoStage,
    intent: 'add' | 'remove',
  ): Promise<'custody' | 'holder'> {
    if (this.hasCustodyRight(actor)) return 'custody';

    const open = await this.prisma.client.assetAssignment.findFirst({
      where: { assetId, returnedAt: null },
      orderBy: { assignedAt: 'desc' },
      select: { userId: true, acknowledgedAt: true },
    });

    if (!open || open.userId !== actor.id) {
      throw AppError.forbidden('You may only add photos to equipment issued to you');
    }
    if (stage !== 'HANDOVER') {
      throw AppError.forbidden('Only the person receiving equipment back can photograph a return');
    }
    if (intent === 'remove' && open.acknowledgedAt) {
      throw new AppError('FORBIDDEN', 'You have already confirmed receipt of this asset', {
        detail:
          'Photos can no longer be removed once you have confirmed. You can still add more; ask IT if something needs taking down.',
      });
    }
    return 'holder';
  }

  async add(
    actor: AuthUser,
    assetId: string,
    stage: PhotoStage,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    caption?: string,
  ) {
    const asset = await this.assetOr404(actor, assetId);
    await this.authorizeWrite(actor, assetId, stage, 'add');
    const event = await this.resolveEvent(assetId, stage);

    // Intersected with the tenant's configured allow-list, so a deployment that
    // narrows uploads narrows these too - this cannot widen what is accepted.
    const configured = this.config.get('ALLOWED_UPLOAD_MIME');
    const allowed = PHOTO_MIMES.filter((m) => configured.includes(m));

    const { contentType } = validateUpload({
      data: file.buffer,
      declaredMime: file.mimetype,
      allowedMimes: allowed,
      maxBytes: this.config.get('MAX_UPLOAD_MB') * 1024 * 1024,
    });

    const stored = await this.storage.put({
      prefix: `asset-photos/${actor.companyId}/${assetId}`,
      originalName: file.originalname,
      contentType,
      data: file.buffer,
    });

    const photo = await this.prisma.client.attachment.create({
      data: {
        companyId: actor.companyId,
        entityType: ENTITY_TYPE[stage],
        entityId: event.id,
        // Also hung off the asset, so the whole history is one query from the
        // asset page without walking every assignment it has ever had.
        assetId,
        storageKey: stored.key,
        originalName: file.originalname,
        mimeType: contentType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        scanStatus: 'SKIPPED',
        caption: caption?.trim() || null,
        uploadedById: actor.id,
      },
      select: { id: true, originalName: true, caption: true, createdAt: true, sizeBytes: true },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'Asset',
      entityId: assetId,
      newValues: {
        conditionPhoto: photo.id,
        stage,
        event: event.id,
        asset: asset.assetTag,
        sha256: stored.sha256,
      },
    });

    return { ...photo, stage };
  }

  /**
   * Every condition photo for an asset, newest custody event first.
   *
   * Returned grouped by event rather than as a flat list, because the question
   * this answers is always "what did it look like at THAT handover, and at the
   * return that closed it" - and the condition recorded in words at each of
   * those moments belongs beside the pictures of it.
   */
  async list(actor: AuthUser, assetId: string) {
    await this.assetOr404(actor, assetId);

    // The custody events come first, and the photo read is then scoped to the
    // events being returned. That is what makes the second query bounded by
    // construction rather than by a number picked to look safe: a photo that
    // belongs to no listed event was never going to be displayed anyway.
    const assignments = await this.prisma.client.assetAssignment.findMany({
      where: { assetId },
      orderBy: { assignedAt: 'desc' },
      take: MAX_CUSTODY_EVENTS,
      select: {
        id: true,
        assignedAt: true,
        returnedAt: true,
        conditionOut: true,
        acknowledgedAt: true,
        userId: true,
        user: { select: { profile: { select: { firstName: true, lastName: true } } } },
        assetReturn: { select: { id: true, returnedAt: true, conditionIn: true } },
      },
    });
    if (assignments.length === MAX_CUSTODY_EVENTS) {
      this.logger.warn(
        `Asset ${assetId} has at least ${MAX_CUSTODY_EVENTS} custody events; ` +
          'older ones are not being shown with their photos',
      );
    }

    const eventIds = [
      ...assignments.map((a) => a.id),
      ...assignments.map((a) => a.assetReturn?.id).filter(Boolean),
    ] as string[];

    const photos = eventIds.length
      ? await this.prisma.client.attachment.findMany({
          where: {
            assetId,
            deletedAt: null,
            entityType: { in: [ENTITY_TYPE.HANDOVER, ENTITY_TYPE.RETURN] },
            entityId: { in: eventIds },
            ...tenantFilter(actor),
          },
          orderBy: { createdAt: 'asc' },
          take: MAX_PHOTOS,
          select: {
            id: true,
            entityType: true,
            entityId: true,
            originalName: true,
            caption: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
            uploadedById: true,
          },
        })
      : [];
    if (photos.length === MAX_PHOTOS) {
      this.logger.warn(`Asset ${assetId} returned the ${MAX_PHOTOS}-photo ceiling; some are hidden`);
    }

    // Attachment carries only the uploader's id, so the names are resolved in
    // one extra query rather than N joins - a photo list is small, and the
    // person who took the picture is part of the evidence.
    const uploaderIds = [...new Set(photos.map((p) => p.uploadedById).filter(Boolean))] as string[];
    const uploaders = uploaderIds.length
      ? await this.prisma.client.userProfile.findMany({
          where: { userId: { in: uploaderIds } },
          select: { userId: true, firstName: true, lastName: true },
        })
      : [];
    const nameOf = new Map(
      uploaders.map((u) => [u.userId, `${u.firstName} ${u.lastName}`.trim()]),
    );

    /**
     * `byHolder` is what makes a holder's photo worth more than an anonymous
     * one: it says the person who received the equipment took this, not the
     * team that issued it. Both sides of a dispute are then visible in one
     * list, attributed.
     */
    const shape = (holderUserId: string | null) => (a: (typeof photos)[number]) => ({
      id: a.id,
      originalName: a.originalName,
      caption: a.caption,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      takenAt: a.createdAt,
      by: a.uploadedById ? (nameOf.get(a.uploadedById) ?? null) : null,
      byHolder: Boolean(a.uploadedById && holderUserId && a.uploadedById === holderUserId),
    });

    return assignments.map((assignment) => ({
      assignmentId: assignment.id,
      holder: assignment.user?.profile
        ? `${assignment.user.profile.firstName} ${assignment.user.profile.lastName}`.trim()
        : null,
      assignedAt: assignment.assignedAt,
      conditionOut: assignment.conditionOut,
      returnedAt: assignment.assetReturn?.returnedAt ?? null,
      conditionIn: assignment.assetReturn?.conditionIn ?? null,
      open: assignment.returnedAt === null,
      /** Set once the holder confirms receipt, which closes their photo window. */
      acknowledgedAt: assignment.acknowledgedAt,
      handover: photos
        .filter((p) => p.entityType === ENTITY_TYPE.HANDOVER && p.entityId === assignment.id)
        .map(shape(assignment.userId)),
      returned: assignment.assetReturn
        ? photos
            .filter(
              (p) =>
                p.entityType === ENTITY_TYPE.RETURN && p.entityId === assignment.assetReturn?.id,
            )
            .map(shape(assignment.userId))
        : [],
    }));
  }

  /** The bytes, for inline display. */
  async read(actor: AuthUser, assetId: string, photoId: string) {
    await this.assetOr404(actor, assetId);

    const photo = await this.prisma.client.attachment.findFirst({
      where: { id: photoId, assetId, deletedAt: null, ...tenantFilter(actor) },
      select: { storageKey: true, mimeType: true, originalName: true },
    });
    if (!photo) throw AppError.notFound('Photo not found');

    return { ...photo, data: await this.storage.get(photo.storageKey) };
  }

  /**
   * Remove a photo - but only while its custody event is still open.
   *
   * A photo taken at handover stops being an ordinary upload the moment the
   * asset comes back: it is then the "before" half of a comparison somebody may
   * be held to. Deleting it at that point removes one side of an argument, and
   * it is precisely when someone would most want to. So the window is: while
   * the assignment is still open, anyone with custody rights can clear a bad
   * shot; after the return, nobody can, through this route.
   *
   * Soft delete, so the row and its hash survive for the audit trail even
   * though the photo stops being served.
   */
  async remove(actor: AuthUser, assetId: string, photoId: string) {
    await this.assetOr404(actor, assetId);

    const photo = await this.prisma.client.attachment.findFirst({
      where: {
        id: photoId,
        assetId,
        deletedAt: null,
        // Condition evidence only: the asset's own picture has its own route
        // and rules, and removing it here would leave the asset pointing at a
        // deleted row.
        entityType: { in: [ENTITY_TYPE.HANDOVER, ENTITY_TYPE.RETURN] },
        ...tenantFilter(actor),
      },
      select: { id: true, entityType: true, entityId: true, uploadedById: true },
    });
    if (!photo) throw AppError.notFound('Photo not found');

    /**
     * A holder may take a photo back only while their own window is open, and
     * only one they took themselves - a blurred shot is worth retaking, but
     * the photo IT recorded at handover is not theirs to delete.
     */
    if (!this.hasCustodyRight(actor)) {
      await this.authorizeWrite(actor, assetId, 'HANDOVER', 'remove');
      if (photo.uploadedById !== actor.id) {
        throw AppError.forbidden('You may only remove a photo you took yourself');
      }
    }

    if (photo.entityType === ENTITY_TYPE.RETURN) {
      throw new AppError('FORBIDDEN', 'A return photo cannot be removed', {
        detail: 'It is the record of what came back. Ask a Super Admin if it is genuinely wrong.',
      });
    }

    const assignment = await this.prisma.client.assetAssignment.findUnique({
      where: { id: photo.entityId },
      select: { returnedAt: true },
    });
    if (assignment?.returnedAt) {
      throw new AppError('FORBIDDEN', 'This handover has already been closed by a return', {
        detail:
          'Its photos are the "before" side of the return comparison and can no longer be removed.',
      });
    }

    await this.prisma.client.attachment.update({
      where: { id: photo.id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'Asset',
      entityId: assetId,
      previousValues: { conditionPhoto: photo.id },
      newValues: { conditionPhotoRemoved: true },
    });

    return { id: photo.id, removed: true };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // The asset's own picture (v2.61)
  // ───────────────────────────────────────────────────────────────────────────

  /** The asset with its current picture, tenant-scoped; 404 outside it. */
  private async assetWithPhotoOr404(actor: AuthUser, assetId: string) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id: assetId, deletedAt: null, ...tenantFilter(actor) },
      select: {
        id: true,
        assetTag: true,
        photo: { select: { id: true, storageKey: true } },
      },
    });
    if (!asset) throw AppError.notFound('Asset not found');
    return asset;
  }

  /** The unit's photographs still on file, oldest first. */
  private unitPhotos(assetId: string, companyId: string) {
    return this.prisma.client.attachment.findMany({
      where: { assetId, companyId, entityType: ASSET_PHOTO_ENTITY, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      // The ceiling the add route enforces, so there are never more to read.
      take: MAX_ASSET_PHOTOS,
      select: { id: true, storageKey: true, mimeType: true, sizeBytes: true, createdAt: true },
    });
  }

  /**
   * Add a photograph of the unit, or replace one (v2.65).
   *
   * An asset holds at most MAX_ASSET_PHOTOS. Naming `replaceId` swaps that
   * photograph for the new one: the old row is retired (soft, so its hash
   * stays in the audit trail) and its bytes are deleted - they are not
   * evidence of anything, and the owner asked that an update never leaves the
   * old file behind. The first photograph becomes the cover; a replacement of
   * the cover stays the cover. Authorisation is assets:update at the
   * controller - this is an edit to the record, not a custody act.
   */
  async addAssetPhoto(
    actor: AuthUser,
    assetId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    replaceId?: string | null,
  ) {
    const asset = await this.assetWithPhotoOr404(actor, assetId);
    const existing = await this.unitPhotos(assetId, actor.companyId);

    const previous = replaceId ? existing.find((row) => row.id === replaceId) : undefined;
    if (replaceId && !previous) throw AppError.notFound('Photo not found');
    if (!previous && existing.length >= MAX_ASSET_PHOTOS) {
      throw new AppError('FILE_REJECTED', assetPhotoLimitMessage());
    }

    const configured = this.config.get('ALLOWED_UPLOAD_MIME');
    const allowed = PHOTO_MIMES.filter((m) => configured.includes(m));
    const { contentType } = validateUpload({
      data: file.buffer,
      declaredMime: file.mimetype,
      allowedMimes: allowed,
      maxBytes: this.config.get('MAX_UPLOAD_MB') * 1024 * 1024,
    });

    const stored = await this.storage.put({
      prefix: `asset-photos/${actor.companyId}/${assetId}`,
      originalName: file.originalname,
      contentType,
      data: file.buffer,
    });

    const coverId = asset.photo?.id ?? null;
    const becomesCover = !coverId || coverId === previous?.id;
    const photo = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          companyId: actor.companyId,
          entityType: ASSET_PHOTO_ENTITY,
          entityId: assetId,
          assetId,
          storageKey: stored.key,
          originalName: file.originalname,
          mimeType: contentType,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
          scanStatus: 'SKIPPED',
          uploadedById: actor.id,
        },
        select: { id: true, mimeType: true, sizeBytes: true, createdAt: true },
      });
      await tx.asset.update({
        where: { id: assetId },
        data: {
          ...(becomesCover ? { photoAttachmentId: created.id } : {}),
          updatedById: actor.id,
        },
      });
      if (previous) {
        await tx.attachment.update({ where: { id: previous.id }, data: { deletedAt: new Date() } });
      }
      return created;
    });
    if (previous) await this.storage.delete(previous.storageKey).catch(() => undefined);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'Asset',
      entityId: assetId,
      previousValues: previous ? { photo: previous.id } : undefined,
      newValues: { photo: photo.id, asset: asset.assetTag, sha256: stored.sha256 },
    });

    return { ...photo, isCover: becomesCover, replaced: previous?.id ?? null };
  }

  /**
   * The v2.61 route, kept for the phones still in people's pockets: set the
   * picture, or replace the cover when there is one.
   */
  setAssetPhoto(
    actor: AuthUser,
    assetId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    return this.assetWithPhotoOr404(actor, assetId).then((asset) =>
      this.addAssetPhoto(actor, assetId, file, asset.photo?.id ?? null),
    );
  }

  /** Make one of the unit's photographs the cover. */
  async setAssetCover(actor: AuthUser, assetId: string, photoId: string) {
    const asset = await this.assetWithPhotoOr404(actor, assetId);
    const existing = await this.unitPhotos(assetId, actor.companyId);
    if (!existing.some((row) => row.id === photoId)) throw AppError.notFound('Photo not found');

    if (asset.photo?.id !== photoId) {
      await this.prisma.client.asset.update({
        where: { id: assetId },
        data: { photoAttachmentId: photoId, updatedById: actor.id },
      });
      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.ASSET_UPDATED,
        entityType: 'Asset',
        entityId: assetId,
        previousValues: asset.photo ? { cover: asset.photo.id } : undefined,
        newValues: { cover: photoId, asset: asset.assetTag },
      });
    }
    return { id: photoId, isCover: true };
  }

  /**
   * Remove one of the unit's photographs: the row is retired and the bytes
   * deleted. Removing the cover hands the cover to the oldest one left.
   */
  async removeAssetPhotoById(actor: AuthUser, assetId: string, photoId: string) {
    const asset = await this.assetWithPhotoOr404(actor, assetId);
    const existing = await this.unitPhotos(assetId, actor.companyId);
    const photo = existing.find((row) => row.id === photoId);
    if (!photo) throw AppError.notFound('Photo not found');

    const wasCover = asset.photo?.id === photoId;
    const nextCover = wasCover ? (existing.find((row) => row.id !== photoId)?.id ?? null) : undefined;

    await this.prisma.client.$transaction([
      this.prisma.client.asset.update({
        where: { id: assetId },
        data: {
          ...(nextCover !== undefined ? { photoAttachmentId: nextCover } : {}),
          updatedById: actor.id,
        },
      }),
      this.prisma.client.attachment.update({
        where: { id: photo.id },
        data: { deletedAt: new Date() },
      }),
    ]);
    await this.storage.delete(photo.storageKey).catch(() => undefined);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'Asset',
      entityId: assetId,
      previousValues: { photo: photo.id },
      newValues: { photoRemoved: true, asset: asset.assetTag },
    });

    return { id: photo.id, removed: true };
  }

  /** The v2.61 route: remove the cover. 404 when there is none. */
  async removeAssetPhoto(actor: AuthUser, assetId: string) {
    const asset = await this.assetWithPhotoOr404(actor, assetId);
    if (!asset.photo) throw AppError.notFound('Photo not found');
    return this.removeAssetPhotoById(actor, assetId, asset.photo.id);
  }
}

/** Custody rights, which is who may add condition evidence. */
export const PHOTO_WRITE_PERMISSIONS = [PERMISSIONS.ASSETS_ASSIGN, PERMISSIONS.ASSETS_RETURN];
