import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AuditAction, Prisma } from '@prisma/client';
import type {
  AdminUpdateProfileInput, ChangeUserEmailInput, InviteUserInput, SetUserRolesInput, SetUserStatusInput, UserListQuery } from '@techpioasset/contracts';
import type { AuthUser } from '@techpioasset/contracts';
import { findSodConflicts } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { buildOrderBy, paginate } from '../common/paginate.js';
import { userScopeFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService } from '../auth/token.service.js';
import { AppConfig } from '../config/config.module.js';
import { MailProvider } from '../providers/mail/mail.provider.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { StorageProvider } from '../providers/storage/storage.provider.js';
import { validateUpload } from '../providers/storage/file-validation.js';

const SORTABLE = ['email', 'createdAt', 'lastLoginAt', 'status', 'name', 'department'] as const;

/**
 * v2.21 - name and department live on the profile relation, so they cannot go
 * through the flat buildOrderBy. Sorting by name means first name then last,
 * which is how the column reads. Role is deliberately absent: a person can hold
 * several, so "sorted by role" would have no single honest answer.
 */
function userOrderBy(
  sort: string | undefined,
  order: 'asc' | 'desc',
): Prisma.UserOrderByWithRelationInput | Prisma.UserOrderByWithRelationInput[] {
  if (sort === 'name') {
    return [{ profile: { firstName: order } }, { profile: { lastName: order } }];
  }
  if (sort === 'department') {
    return { profile: { department: { name: order } } };
  }
  return buildOrderBy(sort, order, SORTABLE, 'createdAt');
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly mail: MailProvider,
    private readonly config: AppConfig,
    private readonly storage: StorageProvider,
    private readonly notifications: NotificationsService,
  ) {}

  /** Scope + filters, ANDed (never spread — see AssetsService.list for why). */
  private listWhere(actor: AuthUser, query: UserListQuery) {
    return {
      AND: [
        userScopeFilter(actor),
        // Soft-deleted users are gone from every list; their history is not.
        { deletedAt: null },
        // Deactivated accounts have their own view - the default list shows
        // only people who can (or could, once invited) sign in.
        query.view === 'deactivated'
          ? { status: 'DEACTIVATED' as const }
          : { status: { not: 'DEACTIVATED' as const } },
        query.q
          ? {
              OR: [
                { email: { contains: query.q, mode: 'insensitive' as const } },
                { profile: { firstName: { contains: query.q, mode: 'insensitive' as const } } },
                { profile: { lastName: { contains: query.q, mode: 'insensitive' as const } } },
                {
                  profile: { employeeNumber: { contains: query.q, mode: 'insensitive' as const } },
                },
              ],
            }
          : {},
        query.role ? { roles: { some: { role: { key: query.role } } } } : {},
      ],
    };
  }

  async list(actor: AuthUser, query: UserListQuery) {
    const where = this.listWhere(actor, query);

    return paginate(query, {
      count: () => this.prisma.client.user.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.user.findMany({
          where,
          skip,
          take,
          orderBy: userOrderBy(query.sort, query.order),
          select: {
            id: true,
            email: true,
            status: true,
            lastLoginAt: true,
            createdAt: true,
            mfaEnabledAt: true,
            profile: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
                jobTitle: true,
                employeeNumber: true,
                canRaiseRequests: true,
                avatarKey: true,
                department: { select: { id: true, name: true } },
                office: { select: { id: true, name: true } },
                manager: {
                  select: {
                    id: true,
                    email: true,
                    profile: { select: { firstName: true, lastName: true } },
                  },
                },
              },
            },
            roles: { select: { role: { select: { key: true, name: true } } } },
          },
        }),
    });
  }

  /** All users matching the list filters, flattened for CSV export (scoped, capped). */
  async exportRows(actor: AuthUser, query: UserListQuery) {
    const where = this.listWhere(actor, query);
    const users = await this.prisma.client.user.findMany({
      where,
      take: 10_000,
      orderBy: { email: 'asc' },
      select: {
        email: true,
        status: true,
        profile: {
          select: {
            firstName: true,
            lastName: true,
            employeeNumber: true,
            jobTitle: true,
            department: { select: { name: true } },
            office: { select: { name: true } },
          },
        },
        roles: { select: { role: { select: { name: true } } } },
      },
    });

    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'employeeNumber', label: 'Employee number' },
      { key: 'jobTitle', label: 'Job title' },
      { key: 'department', label: 'Department' },
      { key: 'office', label: 'Office' },
      { key: 'roles', label: 'Roles' },
      { key: 'status', label: 'Status' },
    ];
    const rows = users.map((u) => ({
      name: u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : '',
      email: u.email,
      employeeNumber: u.profile?.employeeNumber ?? '',
      jobTitle: u.profile?.jobTitle ?? '',
      department: u.profile?.department?.name ?? '',
      office: u.profile?.office?.name ?? '',
      roles: u.roles.map((r) => r.role.name).join('; '),
      status: u.status,
    }));

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.DATA_EXPORTED,
      entityType: 'User',
      entityId: 'export',
      newValues: { rows: rows.length },
    });

    return { columns, rows };
  }

  /**
   * Reads one user, honouring scope.
   *
   * A record outside the actor's scope returns 404, not 403. Distinguishing the
   * two tells the caller that a record exists at that id, which is the insecure
   * direct object reference the spec's security tests look for.
   */

  /**
   * v2.11 — profile fields finally have an editor.
   *
   * Until now NOBODY could set job title, department or office - not the user,
   * not an admin. The fields existed, the seed filled some of them, and every
   * profile rendered dashes forever after.
   *
   * `self` mode edits the caller's own record and refuses the org-placement
   * fields: department feeds the DEPARTMENT data scope, so a self-move would
   * let a user pick whose assets they can see. Admin mode (users:manage) may
   * place people. Both are audited with before/after.
   */
  /**
   * A line manager must be a real, usable approver for this person (v2.26).
   *
   * Three ways it can be wrong, and the third is the one that bites. Naming
   * yourself is an obvious mistake. Naming somebody outside the company, or a
   * deleted account, leaves the step permanently unstaffed. But naming somebody
   * whose own chain leads back here builds a cycle - A reports to B, B reports
   * to A - and the approval walk would loop until something gave out. The
   * chain is walked upward before the write so the graph can never hold one.
   */
  private async assertManagerIsUsable(companyId: string, targetUserId: string, managerId: string) {
    if (managerId === targetUserId) {
      throw new AppError('VALIDATION_FAILED', 'Somebody cannot be their own line manager');
    }
    const manager = await this.prisma.client.user.findFirst({
      where: { id: managerId, companyId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!manager) throw AppError.notFound('User', managerId);
    if (manager.status === 'DEACTIVATED') {
      throw new AppError(
        'VALIDATION_FAILED',
        'That account is deactivated and could never act on an approval. Choose an active user.',
      );
    }

    // Walk up from the proposed manager. Reaching the target means this edit
    // would close a loop. The bound is a safety net, not the exit condition:
    // an existing cycle (impossible through this method, but not through a
    // direct database edit) must not hang the request.
    let cursor: string | null = managerId;
    for (let hop = 0; cursor && hop < 64; hop += 1) {
      if (cursor === targetUserId) {
        throw new AppError(
          'VALIDATION_FAILED',
          'That would create a reporting loop - the person you picked already reports to this user, directly or through their own manager.',
        );
      }
      const next: { managerId: string | null } | null =
        await this.prisma.client.userProfile.findUnique({
          where: { userId: cursor },
          select: { managerId: true },
        });
      cursor = next?.managerId ?? null;
    }
  }

  async updateProfile(
    actor: AuthUser,
    targetUserId: string,
    input: AdminUpdateProfileInput,
    mode: 'self' | 'admin',
  ) {
    if (
      mode === 'self' &&
      (input.departmentId !== undefined ||
        input.officeId !== undefined ||
        input.employeeNumber !== undefined ||
        input.managerId !== undefined)
    ) {
      throw AppError.forbidden(
        'Department, office, employee number and line manager are set by your administrator',
      );
    }
    const user = await this.prisma.client.user.findFirst({
      where: { id: targetUserId, companyId: actor.companyId, deletedAt: null },
      select: { id: true, profile: true },
    });
    if (!user) throw AppError.notFound('User', targetUserId);

    if (input.departmentId) {
      const department = await this.prisma.client.department.findFirst({
        where: { id: input.departmentId, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!department) throw AppError.notFound('Department', input.departmentId);
    }
    if (input.officeId) {
      const office = await this.prisma.client.office.findFirst({
        where: { id: input.officeId, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!office) throw AppError.notFound('Office', input.officeId);
    }
    if (input.managerId) {
      await this.assertManagerIsUsable(actor.companyId, targetUserId, input.managerId);
    }

    const patch = {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.dateFormat !== undefined ? { dateFormat: input.dateFormat } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(input.canRaiseRequests !== undefined ? { canRaiseRequests: input.canRaiseRequests } : {}),
      ...(input.officeId !== undefined ? { officeId: input.officeId } : {}),
      ...(input.employeeNumber !== undefined ? { employeeNumber: input.employeeNumber } : {}),
      ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
    };

    const before = user.profile
      ? {
          firstName: user.profile.firstName,
          lastName: user.profile.lastName,
          jobTitle: user.profile.jobTitle,
          departmentId: user.profile.departmentId,
          officeId: user.profile.officeId,
          // Who approved this person's requests before the change is exactly
          // the kind of thing an auditor comes back for.
          managerId: user.profile.managerId,
        }
      : null;

    await this.prisma.client.userProfile.upsert({
      where: { userId: targetUserId },
      // A user with no profile row yet still deserves an editable profile;
      // names fall back to empty and can be corrected in the same breath.
      create: {
        userId: targetUserId,
        firstName: input.firstName ?? '',
        lastName: input.lastName ?? '',
        displayName: input.displayName ?? null,
        phone: input.phone ?? null,
        jobTitle: input.jobTitle ?? null,
        ...(mode === 'admin'
          ? {
              departmentId: input.departmentId ?? null,
              officeId: input.officeId ?? null,
              employeeNumber: input.employeeNumber ?? null,
              managerId: input.managerId ?? null,
            }
          : {}),
        createdById: actor.id,
      },
      update: { ...patch, updatedById: actor.id },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_UPDATED,
      entityType: 'User',
      entityId: targetUserId,
      previousValues: before ?? undefined,
      newValues: { ...patch, edited: mode === 'self' ? 'own profile' : 'by administrator' },
    });
    return this.findOne(actor, targetUserId);
  }

  async findOne(actor: AuthUser, id: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id, deletedAt: null, ...userScopeFilter(actor) },
      select: {
        id: true,
        email: true,
        status: true,
        emailVerifiedAt: true,
        mfaEnabledAt: true,
        lastLoginAt: true,
        createdAt: true,
        profile: {
          select: {
            firstName: true,
            lastName: true,
            displayName: true,
            jobTitle: true,
            phone: true,
            employeeNumber: true,
            avatarKey: true,
            hireDate: true,
            department: { select: { id: true, name: true } },
            office: { select: { id: true, name: true } },
            manager: {
                  select: {
                    id: true,
                    email: true,
                    profile: { select: { firstName: true, lastName: true } },
                  },
                },
          },
        },
        roles: { select: { role: { select: { key: true, name: true } } } },
      },
    });

    if (!user) throw AppError.notFound('User', id);
    return user;
  }

  /** Loads a user within the actor's scope, or 404s (never 403 — see findOne). */
  private async loadInScope(actor: AuthUser, id: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id, deletedAt: null, ...userScopeFilter(actor) },
      select: {
        id: true,
        email: true,
        status: true,
        roles: { select: { role: { select: { id: true, key: true } } } },
        profile: { select: { firstName: true } },
      },
    });
    if (!user) throw AppError.notFound('User', id);
    return user;
  }

  /**
   * v2.24 - there is exactly one Super Admin, and the role cannot be granted.
   *
   * The floor below stops the company losing its last Super Admin; this is the
   * ceiling: while an active Super Admin exists, nobody else can be given the
   * role - not through a role edit and not on an invitation. Checked against
   * ACTIVE holders rather than stated as an absolute, so if the sole holder is
   * ever lost through some path the guards did not foresee, granting becomes
   * possible again instead of locking the tenant out forever.
   */
  private async assertSuperAdminGrantAllowed(companyId: string): Promise<void> {
    if ((await this.activeSuperAdminCount(companyId)) >= 1) {
      throw new AppError('VALIDATION_FAILED', 'There is exactly one Super Admin', {
        detail:
          'The Super Admin role cannot be granted to another account while the current Super Admin is active.',
      });
    }
  }

  /** How many active Super Admins the company has — the floor we must not cross. */
  private async activeSuperAdminCount(companyId: string): Promise<number> {
    return this.prisma.client.user.count({
      where: {
        companyId,
        status: 'ACTIVE',
        roles: { some: { role: { key: 'SUPER_ADMIN' } } },
      },
    });
  }

  /**
   * Replaces a user's roles wholesale (roles:manage). Guards against locking the
   * company out of administration: the last active Super Admin cannot be demoted.
   */
  async setRoles(actor: AuthUser, id: string, input: SetUserRolesInput) {
    const target = await this.loadInScope(actor, id);
    const currentKeys = target.roles.map((r) => r.role.key);
    const beforeRoleNames = target.roles.map(
      (r) => (r.role as { name?: string; key: string }).name ?? r.role.key,
    );
    const nextKeys = [...new Set(input.roleKeys)];

    const losingSuperAdmin =
      currentKeys.includes('SUPER_ADMIN') && !nextKeys.includes('SUPER_ADMIN');
    if (losingSuperAdmin && (await this.activeSuperAdminCount(actor.companyId)) <= 1) {
      throw new AppError('VALIDATION_FAILED', 'The company must keep at least one Super Admin', {
        detail: 'Grant Super Admin to another active user before removing it from this one.',
      });
    }

    const gainingSuperAdmin =
      !currentKeys.includes('SUPER_ADMIN') && nextKeys.includes('SUPER_ADMIN');
    if (gainingSuperAdmin) await this.assertSuperAdminGrantAllowed(actor.companyId);

    const roles = await this.prisma.client.role.findMany({
      where: { companyId: actor.companyId, key: { in: nextKeys } },
      select: { id: true, key: true },
    });
    if (roles.length !== nextKeys.length) {
      const found = new Set(roles.map((r) => r.key));
      throw new AppError('VALIDATION_FAILED', 'Unknown role', {
        detail: `No such role: ${nextKeys.filter((k) => !found.has(k)).join(', ')}`,
      });
    }

    await this.prisma.client.$transaction([
      this.prisma.client.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.client.userRole.createMany({
        data: roles.map((r) => ({ userId: id, roleId: r.id, createdById: actor.id })),
      }),
    ]);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ROLE_CHANGED,
      entityType: 'User',
      entityId: id,
      previousValues: { roles: currentKeys },
      newValues: { roles: nextKeys },
    });

    // v2.19: tell the person their access changed - previous vs new, no
    // internal permission dump.
    const changed = await this.prisma.client.user.findUnique({
      where: { id },
      select: {
        email: true,
        companyId: true,
        profile: { select: { firstName: true, lastName: true } },
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (changed) {
      await this.notifications.sendTransactional({
        companyId: changed.companyId,
        type: 'ROLE_CHANGED',
        toEmail: changed.email,
        toUserId: id,
        recipientName: changed.profile ? `${changed.profile.firstName} ${changed.profile.lastName}` : changed.email,
        title: 'Your PioAssets access has been updated',
        body: 'An administrator updated your role in PioAssets.',
        linkPath: '/my-assets',
        emailRows: [
          ['Previous access', beforeRoleNames.join(', ') || '-'],
          ['New access', changed.roles.map((r) => r.role.name).join(', ') || '-'],
          ['Changed by', (await this.displayName(actor.id)) ?? 'Administrator'],
          ['Effective', new Date().toISOString().slice(0, 10)],
        ],
        entityType: 'User',
        entityId: id,
      });
    }

    // WS-G — advisory SoD check over the UNION of the new roles: two
    // individually-clean roles can conflict when held together. Warns, never
    // blocks; the one hard SoD rule stays at decide time (BR-04).
    const grants = await this.prisma.client.rolePermission.findMany({
      where: { roleId: { in: roles.map((r) => r.id) } },
      select: { permission: { select: { key: true } } },
    });
    const sodConflicts = findSodConflicts(grants.map((g) => g.permission.key));

    const result = await this.findOne(actor, id);
    return { ...result, sodConflicts };
  }

  /**
   * Changes the address a user signs in with (Super Admin only) - v2.54.
   *
   * There was no way to do this at all: an email was set at invite and never
   * again, so correcting a supplier contact meant editing the database by hand,
   * which leaves no audit trail and is available to nobody but a developer.
   *
   * Self-change is allowed. Blocking it would recreate the gap this closes -
   * an administrator could never fix their own address - and the risk it guards
   * against, a typo locking somebody out, is the same risk as mistyping anyone
   * else's.
   */
  async changeEmail(actor: AuthUser, id: string, input: ChangeUserEmailInput) {
    // Super Admin alone, which is narrower than the users:manage the route
    // already requires - that permission is also held by the Company Admin.
    // Suspending an account inconveniences its owner; changing the address it
    // signs in with hands it to somebody else, and the next password reset
    // goes with it. Enforced here rather than by the route decorator because
    // there is no super-admin-only permission to require: the role simply
    // holds all of them.
    if (!actor.roles.includes('SUPER_ADMIN')) {
      throw AppError.forbidden('Only a Super Admin can change the address an account signs in with');
    }

    const target = await this.loadInScope(actor, id);
    const email = input.email.trim().toLowerCase();

    if (email === target.email.toLowerCase()) {
      throw new AppError('VALIDATION_FAILED', 'That is already this account’s email address');
    }

    // Platform access is granted by listing an address in PLATFORM_ADMIN_EMAILS,
    // so changing one silently revokes it - the account keeps working and the
    // platform screens simply stop opening, with nothing to say why. Refused
    // here rather than discovered later.
    const platformAdmins = (this.config.get('PLATFORM_ADMIN_EMAILS') as string)
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (platformAdmins.includes(target.email.toLowerCase())) {
      throw new AppError(
        'VALIDATION_FAILED',
        'This account is a designated platform operator and its address cannot be changed here',
        {
          detail:
            'Platform access is granted by email address. Change PLATFORM_ADMIN_EMAILS on the server first, or the account will quietly lose that access.',
        },
      );
    }

    // Checked before writing so the answer is a sentence rather than a unique
    // constraint. Deleted users keep their address, so a match against one is
    // still a clash worth naming.
    const clash = await this.prisma.client.user.findFirst({
      where: { companyId: actor.companyId, email },
      select: { id: true },
    });
    if (clash) {
      throw new AppError('CONFLICT', 'Another account already uses that email address');
    }

    await this.prisma.client.user.update({
      where: { id },
      data: {
        email,
        // The new address has not been proved to belong to anyone. Nothing
        // currently gates on this flag, so clearing it locks nobody out; it
        // simply stops the record claiming a verification that never happened.
        emailVerifiedAt: null,
      },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_UPDATED,
      entityType: 'User',
      entityId: id,
      previousValues: { email: target.email },
      newValues: { email },
      reason: 'Sign-in email changed',
    });

    // Both addresses, deliberately. The new one so they know where to sign in;
    // the old one so an address changed by the wrong hands is visible to the
    // person losing the account rather than only to an auditor later.
    const notify = async (toEmail: string, body: string) => {
      try {
        await this.notifications.sendTransactional({
          companyId: actor.companyId,
          // A security alert, not a profile notice: mandatory, so neither the
          // person losing an account nor the one gaining it can have muted it.
          type: 'SECURITY_ALERT',
          toEmail,
          toUserId: id,
          recipientName: target.profile?.firstName ?? email,
          title: 'The email address on your PioAssets account has changed',
          body,
          linkPath: '/login',
        });
      } catch {
        // A change that has already happened is not undone by a mail server
        // having a bad day.
      }
    };
    await notify(
      email,
      `Your PioAssets account now signs in with ${email}. Your password has not changed.`,
    );
    await notify(
      target.email,
      `Your PioAssets account has been changed to sign in with ${email}. If you did not expect this, contact your administrator straight away.`,
    );

    return { id, email };
  }

  /**
   * Activates, suspends or deactivates a user (users:manage). You cannot change
   * your own status (no self-lockout), and the last active Super Admin cannot be
   * suspended or deactivated.
   */
  async setStatus(actor: AuthUser, id: string, input: SetUserStatusInput) {
    if (id === actor.id) {
      throw new AppError('VALIDATION_FAILED', 'You cannot change your own account status');
    }
    const target = await this.loadInScope(actor, id);
    const isSuperAdmin = target.roles.some((r) => r.role.key === 'SUPER_ADMIN');
    const leavingActive = target.status === 'ACTIVE' && input.status !== 'ACTIVE';

    if (isSuperAdmin && leavingActive && (await this.activeSuperAdminCount(actor.companyId)) <= 1) {
      throw new AppError(
        'VALIDATION_FAILED',
        'The company must keep at least one active Super Admin',
        {
          detail: 'Activate another Super Admin before deactivating this one.',
        },
      );
    }

    await this.prisma.client.user.update({
      where: { id },
      data: { status: input.status },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_UPDATED,
      entityType: 'User',
      entityId: id,
      previousValues: { status: target.status },
      newValues: { status: input.status, reason: input.reason ?? null },
    });

    // v2.19: coming back to ACTIVE from any blocked state is news the account
    // owner should get - it means they can sign in again right now.
    if (input.status === 'ACTIVE' && target.status !== 'ACTIVE' && target.status !== 'INVITED') {
      await this.notifications.sendTransactional({
        companyId: actor.companyId,
        type: 'USER_REACTIVATED',
        toEmail: target.email,
        toUserId: id,
        recipientName: target.profile?.firstName ?? target.email,
        title: 'Your PioAssets account has been reactivated',
        body: 'Your PioAssets account is active again. Sign in with your usual email address.',
        linkPath: '/login',
        emailRows: [
          ['Account', target.email],
          ['Reactivated', new Date().toISOString().slice(0, 10)],
        ],
        entityType: 'User',
        entityId: id,
      });
    }

    return this.findOne(actor, id);
  }

  /**
   * Invite a new user (v2.12) - the registration path tenant admins were
   * missing. Creates the account as INVITED with an unusable random password,
   * emails a 7-day single-use link, and returns that link ONCE so the inviter
   * can hand it over directly when email is not configured. The account cannot
   * sign in until the invite is accepted (INVITED blocks login).
   */
  /**
   * Who may invite: full user managers (users:manage) or HR-style inviters
   * (employees:create). The guard decorator can only AND permissions, so this
   * OR lives here - and it is also where the escalation line is held: an
   * inviter WITHOUT users:manage may only invite Registered Employees. HR
   * registering a joiner is fine; HR minting a Super Admin is not.
   */
  private assertMayInvite(actor: AuthUser, roleKeys?: string[]): void {
    const held = new Set(actor.permissions);
    const fullManager = held.has('users:manage');
    if (!fullManager && !held.has('employees:create')) {
      throw AppError.forbidden('You do not have permission to invite users');
    }
    if (!fullManager && roleKeys && (roleKeys.length !== 1 || roleKeys[0] !== 'EMPLOYEE')) {
      throw new AppError('FORBIDDEN', 'You may only invite Registered Employees', {
        detail:
          'Granting other roles needs user management permission - ask a user manager to change roles after the person joins.',
      });
    }
  }

  /**
   * v2.19 - the invitations board: every INVITED account with its timeline.
   * "expiresAt" is the newest un-consumed INVITE token (reminders re-issue, so
   * this is the link currently in the person's inbox); null means every link
   * has expired and the sweep has said so.
   */
  async listInvitations(actor: AuthUser) {
    const invited = await this.prisma.client.user.findMany({
      where: { companyId: actor.companyId, status: 'INVITED', deletedAt: null },
      select: {
        id: true,
        email: true,
        createdAt: true,
        profile: { select: { firstName: true, lastName: true } },
        roles: { select: { role: { select: { name: true, key: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    if (invited.length === 0) return [];

    const ids = invited.map((u) => u.id);
    const [tokens, reminders] = await Promise.all([
      this.prisma.client.verificationToken.findMany({
        where: { userId: { in: ids }, purpose: 'INVITE', consumedAt: null },
        select: { userId: true, expiresAt: true },
        orderBy: { expiresAt: 'desc' },
      }),
      this.prisma.client.emailLog.groupBy({
        by: ['toUserId'],
        where: { toUserId: { in: ids }, type: 'INVITE_REMINDER', status: { not: 'FAILED' } },
        _count: { _all: true },
      }),
    ]);
    const newestToken = new Map<string, Date>();
    for (const t of tokens) {
      if (!newestToken.has(t.userId)) newestToken.set(t.userId, t.expiresAt);
    }
    const reminderCount = new Map(reminders.map((r) => [r.toUserId, r._count._all]));

    const now = Date.now();
    return invited.map((u) => {
      const expiresAt = newestToken.get(u.id) ?? null;
      return {
        id: u.id,
        email: u.email,
        name: u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : null,
        roles: u.roles.map((r) => (r.role as { name?: string; key: string }).name ?? r.role.key),
        invitedAt: u.createdAt.toISOString(),
        expiresAt: expiresAt?.toISOString() ?? null,
        reminders: reminderCount.get(u.id) ?? 0,
        status: expiresAt && expiresAt.getTime() > now ? 'PENDING' : 'EXPIRED',
      };
    });
  }

  async invite(actor: AuthUser, input: InviteUserInput) {
    this.assertMayInvite(actor, input.roleKeys);
    if (input.roleKeys.includes('SUPER_ADMIN')) {
      await this.assertSuperAdminGrantAllowed(actor.companyId);
    }
    const existing = await this.prisma.client.user.findFirst({
      where: { companyId: actor.companyId, email: input.email },
      select: { id: true, deletedAt: true },
    });
    if (existing) {
      throw new AppError(
        'CONFLICT',
        existing.deletedAt
          ? 'A deleted account already uses this email address'
          : 'A user with this email already exists',
      );
    }

    if (input.departmentId) {
      const department = await this.prisma.client.department.findFirst({
        where: { id: input.departmentId, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!department) throw AppError.notFound('Department', input.departmentId);
    }
    if (input.officeId) {
      const office = await this.prisma.client.office.findFirst({
        where: { id: input.officeId, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!office) throw AppError.notFound('Office', input.officeId);
    }

    const roleKeys = [...new Set(input.roleKeys)];
    const roles = await this.prisma.client.role.findMany({
      where: { companyId: actor.companyId, key: { in: roleKeys } },
      select: { id: true, key: true },
    });
    if (roles.length !== roleKeys.length) {
      const found = new Set(roles.map((r) => r.key));
      throw new AppError('VALIDATION_FAILED', 'Unknown role', {
        detail: `No such role: ${roleKeys.filter((k) => !found.has(k)).join(', ')}`,
      });
    }

    // Unusable placeholder: random and never revealed, so the account has no
    // password anyone could guess until the invitee sets their own.
    const placeholder = await this.passwords.hash(randomBytes(32).toString('base64url'));

    const user = await this.prisma.client.user.create({
      data: {
        companyId: actor.companyId,
        email: input.email,
        passwordHash: placeholder,
        status: 'INVITED',
        profile: {
          create: {
            firstName: input.firstName,
            lastName: input.lastName,
            jobTitle: input.jobTitle ?? null,
            departmentId: input.departmentId ?? null,
            officeId: input.officeId ?? null,
          },
        },
        roles: { create: roles.map((r) => ({ roleId: r.id, createdById: actor.id })) },
      },
      select: { id: true, email: true },
    });

    const inviterName = await this.displayName(actor.id);
    const inviteUrl = await this.sendInviteLink(user.id, user.email, input.firstName, inviterName);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_CREATED,
      entityType: 'User',
      entityId: user.id,
      newValues: { email: user.email, roles: roleKeys, invited: true },
    });

    return { id: user.id, email: user.email, inviteUrl };
  }

  /**
   * Re-send an invitation (v2.12). Only INVITED accounts qualify - an active
   * account holding a fresh set-password link would be a password reset that
   * skipped the current password. Issuing the new token invalidates any
   * outstanding one, so exactly one link works at any moment.
   */
  async resendInvite(actor: AuthUser, id: string) {
    // Same OR gate as invite; no role restriction - resending changes nothing
    // about what the account will be able to do.
    this.assertMayInvite(actor);
    const target = await this.prisma.client.user.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      select: { id: true, email: true, status: true, profile: { select: { firstName: true } } },
    });
    if (!target) throw AppError.notFound('User', id);
    if (target.status !== 'INVITED') {
      throw new AppError('CONFLICT', 'This account has already been activated', {
        detail: 'Only accounts still in the Invited state can have their invitation re-sent.',
      });
    }

    const inviteUrl = await this.sendInviteLink(
      target.id,
      target.email,
      target.profile?.firstName ?? 'Hello',
      await this.displayName(actor.id),
    );

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_UPDATED,
      entityType: 'User',
      entityId: target.id,
      newValues: { email: target.email, note: 'Invitation re-sent - previous link invalidated' },
    });

    return { id: target.id, email: target.email, inviteUrl };
  }

  /**
   * Send (or re-send) the invitation to every account still in the Invited
   * state (v2.15) - the onboarding move after a bulk import, instead of
   * fifty-one clicks. Each person gets a fresh link; any link they already
   * held is invalidated, exactly like a single resend.
   */
  async inviteAllPending(actor: AuthUser) {
    this.assertMayInvite(actor);

    const pending = await this.prisma.client.user.findMany({
      where: { companyId: actor.companyId, deletedAt: null, status: 'INVITED' },
      select: { id: true, email: true, profile: { select: { firstName: true } } },
      orderBy: { email: 'asc' },
      take: 500,
    });

    let sent = 0;
    const failed: string[] = [];
    for (const target of pending) {
      try {
        await this.sendInviteLink(target.id, target.email, target.profile?.firstName ?? 'Hello');
        sent += 1;
      } catch {
        // sendInviteLink already treats mail failure as best-effort; reaching
        // here means the token itself could not be issued.
        failed.push(target.email);
      }
    }

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_UPDATED,
      entityType: 'User',
      entityId: actor.id,
      newValues: { note: 'Bulk invitation send', pending: pending.length, sent, failed },
    });

    return { pending: pending.length, sent, failed };
  }

  private async displayName(userId: string): Promise<string | undefined> {
    const row = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { email: true, profile: { select: { firstName: true, lastName: true } } },
    });
    if (!row) return undefined;
    return row.profile ? `${row.profile.firstName} ${row.profile.lastName}` : row.email;
  }

  /** Issue a fresh invite token (killing any outstanding one) and email the
   * branded invitation through the notification engine, best effort. */
  private async sendInviteLink(userId: string, email: string, firstName: string, invitedBy?: string) {
    const token = await this.auth.issueInviteToken(userId);
    const inviteUrl = `${this.config.get('WEB_URL')}/accept-invite?token=${token}`;
    const expiry = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

    const target = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        companyId: true,
        roles: { select: { role: { select: { name: true } } }, take: 3 },
        profile: { select: { department: { select: { name: true } } } },
      },
    });

    // Best effort: a mail failure must not lose the invite - the link is
    // returned to the inviter either way.
    try {
      await this.notifications.sendTransactional({
        companyId: target?.companyId ?? '',
        type: 'USER_INVITED',
        toEmail: email,
        toUserId: userId,
        recipientName: firstName,
        title: "You're invited to PioAssets",
        body: `${firstName}, you have been invited to your company's PioAssets workspace.`,
        linkPath: `/accept-invite?token=${token}`,
        vars: {
          'user.first_name': firstName,
          'invited_by.name': invitedBy ?? 'your administrator',
          'invitation.expiry_date': expiry,
          'invitation.accept_url': inviteUrl,
        },
        emailRows: [
          ['Account email', email],
          ['Role', target?.roles.map((r) => r.role.name).join(', ') || 'Registered Employee'],
          ...(target?.profile?.department?.name ? [['Department', target.profile.department.name] as [string, string]] : []),
          ['Invited by', invitedBy ?? 'Administrator'],
          ['Link expires', expiry],
        ],
        entityType: 'User',
        entityId: userId,
      });
    } catch (error) {
      this.logger.error(`Invite email failed to send: ${(error as Error).message}`);
    }
    return inviteUrl;
  }

  /**
   * Sign in as another user (v2.12). The support move: see exactly what a
   * user sees, with their permissions and their scope - never more.
   *
   * The containment lines, each deliberate:
   *  - Super Admin accounts can never be impersonated. Nobody needs it, and
   *    it closes the only privilege-relevant direction.
   *  - The token is access-only and capped at 15 minutes: no refresh token is
   *    minted, so the session cannot be renewed - on expiry the browser's
   *    refresh cookie restores the administrator's own session.
   *  - Audited from BOTH identities: whatever the impersonated session does,
   *    the trail starts with who really did it.
   */
  async impersonate(actor: AuthUser, targetUserId: string) {
    if (targetUserId === actor.id) {
      throw new AppError('VALIDATION_FAILED', 'You are already signed in as yourself');
    }
    const target = await this.prisma.client.user.findFirst({
      where: { id: targetUserId, companyId: actor.companyId, deletedAt: null },
      select: {
        id: true,
        email: true,
        status: true,
        roles: { select: { role: { select: { key: true } } } },
      },
    });
    if (!target) throw AppError.notFound('User', targetUserId);
    if (target.status !== 'ACTIVE') {
      throw new AppError('CONFLICT', 'Only active accounts can be impersonated');
    }
    if (target.roles.some((r) => r.role.key === 'SUPER_ADMIN')) {
      throw new AppError('FORBIDDEN', 'Super Admin accounts cannot be impersonated');
    }

    const user = await this.auth.buildAuthUser(target.id);
    const issued = await this.tokens.issueAccessOnly({
      userId: user.id,
      companyId: user.companyId,
      permissions: user.permissions,
      scope: user.scope,
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: target.id,
      newValues: {
        impersonation: true,
        impersonatedBy: actor.email,
        target: target.email,
        expiresInSeconds: issued.expiresIn,
      },
    });

    return { accessToken: issued.accessToken, expiresIn: issued.expiresIn, user };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Profile photo (v2.12) — yours alone: every method keys off the caller's own
  // id, so there is no id parameter that could point at somebody else.
  // ───────────────────────────────────────────────────────────────────────────

  async setAvatar(actor: AuthUser, file: { buffer: Buffer; originalname: string; mimetype: string }) {
    // Images only, verified by signature. validateUpload's allowlist is
    // configurable, so narrow it here to the image types a photo can be.
    const { contentType } = validateUpload({
      data: file.buffer,
      declaredMime: file.mimetype,
      allowedMimes: ['image/jpeg', 'image/png', 'image/heic'],
      maxBytes: 5 * 1024 * 1024,
    });

    const previous = await this.prisma.client.userProfile.findUnique({
      where: { userId: actor.id },
      select: { avatarKey: true },
    });

    const stored = await this.storage.put({
      prefix: `avatars/${actor.companyId}`,
      originalName: file.originalname,
      contentType,
      data: file.buffer,
    });

    await this.prisma.client.userProfile.update({
      where: { userId: actor.id },
      data: { avatarKey: stored.key },
    });

    // Replacing a photo should not leave the old bytes lying in the bucket.
    if (previous?.avatarKey) {
      await this.storage.delete(previous.avatarKey).catch(() => undefined);
    }
    return { avatarKey: stored.key };
  }

  async deleteAvatar(actor: AuthUser) {
    const profile = await this.prisma.client.userProfile.findUnique({
      where: { userId: actor.id },
      select: { avatarKey: true },
    });
    if (profile?.avatarKey) {
      await this.storage.delete(profile.avatarKey).catch(() => undefined);
    }
    await this.prisma.client.userProfile.update({
      where: { userId: actor.id },
      data: { avatarKey: null },
    });
  }

  /** Streams the caller's own photo. */
  async getAvatar(actor: AuthUser) {
    const profile = await this.prisma.client.userProfile.findUnique({
      where: { userId: actor.id },
      select: { avatarKey: true },
    });
    if (!profile?.avatarKey) throw AppError.notFound('Avatar', actor.id);
    const data = await this.storage.get(profile.avatarKey);
    return { data, key: profile.avatarKey };
  }

  /**
   * Soft delete (v2.11). The row keeps its id, profile, assignment history and
   * audit trail - "who had that laptop in 2025" must survive the person
   * leaving - but the user vanishes from every list, cannot sign in (status
   * DEACTIVATED + tokens revoked), and cannot be picked for new work.
   *
   * Deliberately refused while equipment is still out: deleting the holder of
   * three laptops would strand them in limbo. Return the assets first; the
   * error says exactly that.
   */
  async softDelete(actor: AuthUser, id: string) {
    if (id === actor.id) {
      throw new AppError('VALIDATION_FAILED', 'You cannot delete your own account');
    }
    const target = await this.loadInScope(actor, id);

    const isSuperAdmin = target.roles.some((r) => r.role.key === 'SUPER_ADMIN');
    if (
      isSuperAdmin &&
      target.status === 'ACTIVE' &&
      (await this.activeSuperAdminCount(actor.companyId)) <= 1
    ) {
      throw new AppError('VALIDATION_FAILED', 'The company must keep at least one active Super Admin', {
        detail: 'Make someone else a Super Admin before deleting this account.',
      });
    }

    const assetsOut = await this.prisma.client.assetAssignment.count({
      where: { userId: id, returnedAt: null },
    });
    if (assetsOut > 0) {
      throw new AppError(
        'CONFLICT',
        `${assetsOut} asset${assetsOut === 1 ? ' is' : 's are'} still assigned to this user`,
        { detail: 'Return or reassign their equipment first, then delete the account.' },
      );
    }

    await this.prisma.client.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DEACTIVATED' },
    });

    // v2.18: offboarding heads-up with the outstanding equipment picture.
    const outstanding = await this.prisma.client.asset.findMany({
      where: { companyId: actor.companyId, assignedUserId: id, deletedAt: null },
      select: { name: true, assetTag: true },
      take: 20,
    });
    await this.notifications.notifyRoles(actor.companyId, {
      type: 'USER_DEACTIVATED',
      title: `Employee offboarding: action required`,
      body:
        outstanding.length > 0
          ? `${outstanding.length} asset(s) are still assigned to this person and require return before offboarding can be completed.`
          : 'No assets remain assigned to this person.',
      linkPath: `/people/${id}`,
      entityType: 'User',
      entityId: id,
      emailRows: outstanding.map((a) => ['Outstanding', `${a.name} (${a.assetTag})`] as [string, string]),
    }, { excludeUserIds: [actor.id, id] });
    await this.tokens.revokeAllForUser(id, 'USER_DELETED');

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_UPDATED,
      entityType: 'User',
      entityId: id,
      previousValues: { status: target.status, deletedAt: null },
      newValues: {
        status: 'DEACTIVATED',
        deleted: true,
        note: 'Soft delete - assignment history and audit trail retained',
      },
    });
  }
}
