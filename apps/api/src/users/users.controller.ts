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
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import { ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  adminUpdateProfileSchema,
  inviteUserSchema,
  setUserRolesSchema,
  updateMyProfileSchema,
  changeUserEmailSchema,
  setUserStatusSchema,
  userListQuerySchema,
  type AdminUpdateProfileInput,
  type InviteUserInput,
  type AuthUser,
  type SetUserRolesInput,
  type ChangeUserEmailInput,
  type SetUserStatusInput,
  type UpdateMyProfileInput,
  type UserListQuery,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { AppError } from '../common/errors/app-error.js';
import { toCsv } from '../common/csv.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { UsersService } from './users.service.js';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.EMPLOYEES_READ)
  @ApiOperation({ summary: 'List users visible to the caller, optionally filtered by role' })
  list(@CurrentUser() actor: AuthUser, @Query(zodBody(userListQuerySchema)) query: UserListQuery) {
    return this.users.list(actor, query);
  }

  // Declared before ':id' so the static path wins the route match.
  @Get('export')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_READ)
  @ApiOperation({ summary: 'Export the current people view as CSV' })
  async export(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(userListQuerySchema)) query: UserListQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { columns, rows } = await this.users.exportRows(actor, query);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="people-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store',
    });
    return toCsv(columns, rows);
  }

  // Declared before ':id' so the static path wins the route match.
  @Get('invitations')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({
    summary: 'List pending invitations (v2.19)',
    description:
      'Every INVITED account with when it was invited, when the current link expires, and how many reminders have gone out.',
  })
  invitations(@CurrentUser() actor: AuthUser) {
    return this.users.listInvitations(actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_READ)
  @ApiOperation({
    summary: 'Read one user',
    description: 'Returns 404 rather than 403 for records outside the caller’s scope.',
  })
  findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.findOne(actor, id);
  }

  @Patch('me/profile')
  @ApiOperation({
    summary: 'Edit your own profile (name, phone, job title)',
    description:
      'Self-service stops where access begins: department and office feed the data scope, ' +
      'so they are set by an administrator, and roles are never edited here.',
  })
  updateMyProfile(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(updateMyProfileSchema)) body: UpdateMyProfileInput,
  ) {
    return this.users.updateProfile(actor, actor.id, body, 'self');
  }

  // ── profile photo — always the caller's own; no id parameter exists ──────
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload or replace your profile photo' })
  setAvatar(
    @CurrentUser() actor: AuthUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 })],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file?.buffer) throw new AppError('FILE_REJECTED', 'No file was received');
    return this.users.setAvatar(actor, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    });
  }

  @Get('me/avatar')
  @ApiOperation({ summary: 'Your profile photo' })
  async getAvatar(
    @CurrentUser() actor: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const avatar = await this.users.getAvatar(actor);
    // The stored object keeps its original bytes; tell the browser what they
    // are so its image pipeline (colour management included) runs properly,
    // rather than sniffing an octet-stream.
    const head = avatar.data.subarray(0, 8);
    const contentType = head.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))
      ? 'image/jpeg'
      : head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        ? 'image/png'
        : 'application/octet-stream';
    res.set({ 'Cache-Control': 'private, max-age=300', 'Content-Type': contentType });
    return new StreamableFile(avatar.data);
  }

  @Delete('me/avatar')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove your profile photo' })
  async deleteAvatar(@CurrentUser() actor: AuthUser): Promise<void> {
    await this.users.deleteAvatar(actor);
  }

  @Patch(':id/profile')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: "Edit a user's profile, including department and office" })
  updateProfile(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(adminUpdateProfileSchema)) body: AdminUpdateProfileInput,
  ) {
    return this.users.updateProfile(actor, id, body, 'admin');
  }

  @Patch(':id/roles')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  @ApiOperation({
    summary: 'Replace a user’s roles',
    description: 'The company must always keep at least one active Super Admin.',
  })
  setRoles(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(setUserRolesSchema)) body: SetUserRolesInput,
  ) {
    return this.users.setRoles(actor, id, body);
  }

  @Patch(':id/email')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({
    summary: 'Change the address a user signs in with',
    description:
      'Its own endpoint because it is the account’s identity rather than a profile detail: login ' +
      'resolves by email, so this both locks people out when mistyped and hands over the account ' +
      'when misused. Audited, and announced to the old address as well as the new one. Refused for ' +
      'a designated platform operator, whose access is granted by address.',
  })
  changeEmail(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(changeUserEmailSchema)) body: ChangeUserEmailInput,
  ) {
    return this.users.changeEmail(actor, id, body);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({
    summary: 'Activate, suspend or deactivate a user',
    description:
      'You cannot change your own status, and the last active Super Admin cannot be disabled.',
  })
  setStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(setUserStatusSchema)) body: SetUserStatusInput,
  ) {
    return this.users.setStatus(actor, id, body);
  }

  // No @RequirePermissions here: the rule is users:manage OR employees:create
  // (HR registers joiners), and the guard can only AND. The service holds the
  // gate - including the escalation line that HR-style inviters may only
  // invite Registered Employees.
  @Post('invite')
  @ApiOperation({
    summary: 'Invite a new user',
    description:
      'Creates the account as INVITED and emails a 7-day single-use link. The link is also returned once so it can be handed over directly.',
  })
  invite(@CurrentUser() actor: AuthUser, @Body(zodBody(inviteUserSchema)) body: InviteUserInput) {
    return this.users.invite(actor, body);
  }

  // Declared before ':id/resend-invite' so the static path wins the match.
  @Post('invite-all-pending')
  @ApiOperation({
    summary: 'Send the invitation email to every account still Invited',
    description:
      'The post-import onboarding move. Every pending person gets a fresh link; links they already held are invalidated.',
  })
  inviteAllPending(@CurrentUser() actor: AuthUser) {
    return this.users.inviteAllPending(actor);
  }

  // Same OR rule as invite - authorization lives in the service.
  @Post(':id/resend-invite')
  @ApiOperation({
    summary: 'Re-send an invitation',
    description:
      'Issues a fresh 7-day link (invalidating the old one) for an account still in the Invited state, emails it, and returns it once.',
  })
  resendInvite(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.resendInvite(actor, id);
  }

  @Post(':id/impersonate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.USERS_IMPERSONATE)
  @ApiOperation({
    summary: 'Sign in as another user',
    description:
      'Returns a 15-minute access-only session with the target\'s exact permissions. Super Admin accounts can never be impersonated. Audited from both identities.',
  })
  impersonate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.impersonate(actor, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({
    summary: 'Soft-delete a user',
    description:
      'The account disappears from lists and cannot sign in; assignment history and the audit trail are retained. Refused while assets are still assigned.',
  })
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string): Promise<void> {
    await this.users.softDelete(actor, id);
  }
}
