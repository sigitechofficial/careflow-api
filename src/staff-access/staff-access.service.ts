import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, ACCOUNT_INVITE_TOKEN_TTL_HOURS, PASSWORD_RESET_TOKEN_TTL_MINUTES } from '../auth/auth.service';
import { MailService } from '../mail/mail.service';
import { MessageHeldError } from '../message-delivery/message-held.error';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { endAllSignInSessions } from '../auth/sign-in-sessions/sign-in-sessions.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { IDENTITY_ROLE, maxRolePrivilege } from '../common/org-scope/org-scope.types';
import { RbacEmploymentSyncService } from '../employee-employment/rbac-employment-sync.service';
import { RBAC_LEVEL_TO_IDENTITY_ROLE_NAME } from '../employee-employment/rbac-employment-sync.config';
import { hashPassword } from '../common/utils/password.util';
import { loadBranchContact, type BranchContact } from '../account-emails/account-email-branding';
import {
  WELCOME_MESSAGE_KIND,
  buildPasswordResetEmail,
  buildWelcomeEmail,
  setPasswordLink,
  type StaffAccess,
  type StaffEmployment,
} from '../account-emails/staff-account-emails.content';
import {
  endStaffSignIns,
  leavingDateHasPassed,
  rbacLevelKind,
  signInState,
  suggestedAccess,
  unusablePasswordHash,
  welcomeVariant,
  type SignInState,
} from './staff-access.util';

const employeeSelect = {
  id: true,
  isActive: true,
  deletedAt: true,
  personalDetail: { select: { firstName: true, lastName: true, email: true, status: { select: { name: true } } } },
  employment: {
    select: {
      endDate: true,
      locationId: true,
      rbacLevel: { select: { name: true } },
      role: { select: { name: true } },
      jobTitle: { select: { name: true } },
      workArea: { select: { name: true } },
    },
  },
  portalAccount: {
    select: { id: true, email: true, isEnabled: true, deletedAt: true, passwordSetAt: true, userId: true, lastLoginAt: true },
  },
} satisfies Prisma.EmployeeSelect;

type EmployeeRow = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>;

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  isActive: true,
  passwordSetAt: true,
  userRoles: { select: { role: { select: { name: true } } } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

export type SignInAccessStatus = {
  employeeId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  /** Active, not marked Inactive, and not past their end date: access can be switched on. */
  canHaveAccess: boolean;
  /** Why access can't be switched on (left, inactive), in plain words. */
  blockedReason: string | null;
  rbacLevel: string | null;
  rbacLevelKind: 'office' | 'field' | null;
  suggested: { website: boolean; app: boolean };
  website: {
    state: SignInState;
    email: string | null;
    roles: string[];
    isSuperAdmin: boolean;
    lastSignInAt: string | null;
    signedInDevices: number;
    linkSentAt: string | null;
  };
  app: {
    state: SignInState;
    email: string | null;
    lastSignInAt: string | null;
    signedInDevices: number;
    linkSentAt: string | null;
  };
  /** Both exist and share one password (set together, kept in step). */
  onePassword: boolean;
  /** The signed-in office user may give or remove office logins (users.create). */
  canManageWebsite: boolean;
};

export type SignInAccessResult = { message: string; emailed: StaffAccess | 'reset' | null; status: SignInAccessStatus };

/**
 * Sign-in access managed from the staff record: an office login (CareFlow website, identity.User) and the Care app
 * (employees.EmployeePortalAccount), each switched on or off. Nobody types a password: switching one on sends the
 * welcome email (A website, B app, C both) with a link to choose it. The two accounts of one person are linked, so
 * they have one password (see AuthService.issueSetPasswordToken / resetPassword).
 */
@Injectable()
export class StaffAccessService {
  private readonly logger = new Logger(StaffAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly audit: AuditLogsService,
    private readonly rbacSync: RbacEmploymentSyncService,
  ) {}

  async getStatus(actor: RequestUser, employeeId: string): Promise<SignInAccessStatus> {
    const emp = await this.loadEmployee(employeeId);
    const user = await this.findOfficeLogin(emp);
    return this.buildStatus(actor, emp, user);
  }

  async setAccess(
    actor: RequestUser,
    employeeId: string,
    want: { website?: boolean; app?: boolean; password?: string },
    meta?: RequestAuditMeta,
  ): Promise<SignInAccessResult> {
    const emp = await this.loadEmployee(employeeId);
    const userBefore = await this.findOfficeLogin(emp);
    const portalBefore = emp.portalAccount && !emp.portalAccount.deletedAt ? emp.portalAccount : null;
    const first = emp.personalDetail?.firstName?.trim() || 'They';

    const websiteOn = Boolean(userBefore?.isActive);
    const appOn = Boolean(portalBefore?.isEnabled);
    const turnWebsiteOn = want.website === true && !websiteOn;
    const turnWebsiteOff = want.website === false && websiteOn;
    const turnAppOn = want.app === true && !appOn;
    const turnAppOff = want.app === false && appOn;

    if (turnWebsiteOn || turnWebsiteOff) this.assertCanManageWebsite(actor);
    if (turnWebsiteOn || turnAppOn) {
      const blocked = this.blockedReason(emp);
      if (blocked) throw new BadRequestException(`${blocked}, so sign-in access can't be switched on.`);
    }
    const email = emp.personalDetail?.email?.trim().toLowerCase() || null;
    if ((turnWebsiteOn && !userBefore) || (turnAppOn && !portalBefore)) {
      if (!email) throw new BadRequestException(`Add ${first === 'They' ? 'their' : `${first}’s`} email address on the Personal tab first. The welcome email goes there.`);
    }
    if (turnWebsiteOn) {
      const level = emp.employment?.rbacLevel?.name?.trim();
      if (!level) {
        throw new BadRequestException('Choose an RBAC level on the Employment tab first. It decides what they can see in CareFlow.');
      }
      const role = RBAC_LEVEL_TO_IDENTITY_ROLE_NAME[level] ?? level;
      if (maxRolePrivilege([role]) > maxRolePrivilege(actor.roles)) {
        throw new ForbiddenException(`You can't give an office login at the ${level} level, because it is above your own access.`);
      }
    }
    if (want.password !== undefined && !turnWebsiteOn && !turnAppOn) {
      throw new BadRequestException('A password can only be given when switching access on. To change it, use “Set a password”.');
    }
    // The office typed a password instead of emailing a link: only its hash is kept, never the password.
    const givenHash = want.password !== undefined ? await hashPassword(want.password) : null;
    // A typed password also becomes their existing office login's password (one password): same rules as changing it.
    if (want.password !== undefined && websiteOn && userBefore) {
      this.assertCanManageWebsite(actor);
      if (this.isSuperAdmin(userBefore) && !actor.roles.includes(IDENTITY_ROLE.SUPER_ADMIN)) {
        throw new ForbiddenException('Only a Super Admin can set a Super Admin’s password.');
      }
    }
    if (turnWebsiteOff && userBefore) {
      if (userBefore.id === actor.id) throw new BadRequestException('You can’t switch off your own office login.');
      if (this.isSuperAdmin(userBefore) && !actor.roles.includes(IDENTITY_ROLE.SUPER_ADMIN)) {
        throw new ForbiddenException('Only a Super Admin can switch off a Super Admin’s login.');
      }
    }

    const newly = { website: false, app: false };
    const changes: string[] = [];
    try {
      await this.prisma.$transaction(async (tx) => {
        let userId = userBefore?.id ?? null;
        if (turnWebsiteOn) {
          if (userBefore) {
            await tx.user.update({ where: { id: userBefore.id }, data: { isActive: true, updatedById: actor.id } });
            newly.website = !userBefore.passwordSetAt || Boolean(givenHash);
          } else {
            const created = await tx.user.create({
              data: {
                email: email!,
                firstName: emp.personalDetail?.firstName ?? null,
                lastName: emp.personalDetail?.lastName ?? null,
                passwordHash: givenHash ?? (await unusablePasswordHash()),
                passwordSetAt: givenHash ? new Date() : null,
                createdById: actor.id,
              },
              select: { id: true },
            });
            userId = created.id;
            newly.website = true;
          }
          changes.push('office login on');
        }
        if (turnWebsiteOff && userBefore) {
          await tx.user.update({ where: { id: userBefore.id }, data: { isActive: false, refreshTokenHash: null, updatedById: actor.id } });
          await endAllSignInSessions(tx, 'USER', userBefore.id, 'ACCOUNT_DISABLED');
          changes.push('office login off');
        }

        let portalId = portalBefore?.id ?? null;
        if (turnAppOn) {
          if (portalBefore) {
            await tx.employeePortalAccount.update({ where: { id: portalBefore.id }, data: { isEnabled: true, updatedById: actor.id } });
            newly.app = !portalBefore.passwordSetAt || Boolean(givenHash);
          } else {
            // A deleted account of theirs would hold the unique employeeId: bring it back as a new invitation.
            const old = await tx.employeePortalAccount.findUnique({ where: { employeeId }, select: { id: true } });
            const data = {
              email: email!,
              passwordHash: givenHash ?? (await unusablePasswordHash()),
              passwordSetAt: givenHash ? new Date() : null,
              isEnabled: true,
              refreshTokenHash: null,
              deletedAt: null,
              updatedById: actor.id,
            };
            const row = old
              ? await tx.employeePortalAccount.update({ where: { id: old.id }, data, select: { id: true } })
              : await tx.employeePortalAccount.create({ data: { ...data, employeeId, createdById: actor.id }, select: { id: true } });
            portalId = row.id;
            newly.app = true;
          }
          changes.push('Care app on');
        }
        if (turnAppOff && portalBefore) {
          await tx.employeePortalAccount.update({
            where: { id: portalBefore.id },
            data: { isEnabled: false, refreshTokenHash: null, lastSeenAt: null, updatedById: actor.id },
          });
          await endAllSignInSessions(tx, 'EMPLOYEE_APP', portalBefore.id, 'ACCOUNT_DISABLED');
          changes.push('Care app off');
        }

        // One person, one password: link their two accounts.
        if (userId && portalId) {
          const current = await tx.employeePortalAccount.findUnique({ where: { id: portalId }, select: { userId: true } });
          const taken = await tx.employeePortalAccount.findFirst({ where: { userId, NOT: { id: portalId } }, select: { id: true } });
          if (!current?.userId && !taken) {
            await tx.employeePortalAccount.update({ where: { id: portalId }, data: { userId } });
          }
        }
        // A typed password is the password for both of their sign-ins (one password), so set it on each.
        if (givenHash) {
          await this.applyPasswordHash(tx, { userId, portalId }, givenHash, actor.id);
          changes.push('password set by the office');
        }
        // Office role from the RBAC level (the same sync as saving the Employment tab).
        if (turnWebsiteOn) await this.rbacSync.syncUserRolesForEmployee(tx, employeeId);

        if (changes.length) {
          await this.audit.logAudit({
            tx,
            userId: actor.id,
            module: AuditModule.EMPLOYEE,
            action: AuditAction.STAFF_SIGN_IN_ACCESS_CHANGED,
            recordType: 'Employee',
            recordId: employeeId,
            description: `Sign-in access: ${changes.join(', ')}`,
            newValues: { website: want.website, app: want.app },
            ipAddress: meta?.ipAddress ?? undefined,
            userAgent: meta?.userAgent ?? undefined,
          });
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Another account already uses this email address. Each person needs their own email.');
      }
      throw e;
    }

    const after = await this.loadEmployee(employeeId);
    const userAfter = await this.findOfficeLogin(after);

    const variant = welcomeVariant(newly);
    let emailed: StaffAccess | null = null;
    const lines: string[] = [];
    if (variant) {
      const sent = await this.sendWelcome(actor, after, userAfter, variant, meta, Boolean(givenHash));
      if (sent.ok && givenHash) {
        emailed = variant;
        lines.push(`We’ve emailed ${first} to say their access is ready. The password isn’t in the email: give it to ${first} yourself.`);
      } else if (sent.ok) {
        emailed = variant;
        lines.push(`We’ve emailed ${first} a link to choose a password. It works for ${ACCOUNT_INVITE_TOKEN_TTL_HOURS} hours.`);
      } else {
        lines.push(`${this.accessWords(variant, true)} on, but the email didn’t go: ${sent.reason} Use “Send the link again” once that’s sorted.`);
      }
    }
    if ((turnWebsiteOn && !newly.website) || (turnAppOn && !newly.app)) {
      const which = turnWebsiteOn && !newly.website ? 'office login' : 'Care app';
      lines.push(`The ${which} is back on. ${first} can sign in with the password they already have.`);
    }
    if (turnWebsiteOff) lines.push(`Office login switched off. ${first} has been signed out of CareFlow.`);
    if (turnAppOff) lines.push(`Care app switched off. ${first} has been signed out of the app.`);
    if (!lines.length) lines.push('No changes.');

    return { message: lines.join(' '), emailed, status: await this.buildStatus(actor, after, userAfter) };
  }

  /**
   * "Send the link again": the welcome email for accounts still waiting for a password, else a reset link (the
   * person chooses a new password themselves; nobody sees it).
   */
  async resendLink(actor: RequestUser, employeeId: string, meta?: RequestAuditMeta): Promise<SignInAccessResult> {
    const emp = await this.loadEmployee(employeeId);
    const user = await this.findOfficeLogin(emp);
    const portal = emp.portalAccount && !emp.portalAccount.deletedAt && emp.portalAccount.isEnabled ? emp.portalAccount : null;
    const website = Boolean(user?.isActive);
    if (website) this.assertCanManageWebsite(actor);
    if (!website && !portal) throw new BadRequestException('Switch on an office login or the Care app first.');
    const first = emp.personalDetail?.firstName?.trim() || 'They';

    const waiting = (website && !user!.passwordSetAt) || (portal && !portal.passwordSetAt);
    const access: StaffAccess = website && portal ? 'both' : website ? 'website' : 'app';
    if (waiting) {
      const sent = await this.sendWelcome(actor, emp, user, access, meta);
      if (!sent.ok) throw new BadRequestException(`The email didn’t go: ${sent.reason}`);
      return {
        message: `We’ve emailed ${first} a new link to choose a password. It works for ${ACCOUNT_INVITE_TOKEN_TTL_HOURS} hours, and earlier links no longer work.`,
        emailed: access,
        status: await this.buildStatus(actor, emp, user),
      };
    }

    const issued = await this.auth.issueSetPasswordToken(
      { userId: website ? user!.id : null, portalAccountId: portal?.id ?? null },
      { invite: false, requestedIp: meta?.ipAddress ?? null },
    );
    if (!issued) throw new BadRequestException('Too many links have been sent in the last hour. Try again later.');
    const branding = await this.auth.accountEmailBranding();
    if (!branding) throw new BadRequestException('The CareFlow site address is not set (ADMIN_APP_URL), so links can’t be sent.');
    const to = website ? user!.email : portal!.email;
    const built = buildPasswordResetEmail({
      access,
      firstName: emp.personalDetail?.firstName ?? null,
      email: to,
      link: setPasswordLink(issued.urlBase, issued.rawToken, access !== 'app'),
      linkMinutes: PASSWORD_RESET_TOKEN_TTL_MINUTES,
      branding,
    });
    try {
      await this.mail.send({ kind: access === 'app' ? 'app-password-reset' : 'account', to, subject: built.subject, text: built.text, html: built.html, skipBcc: true });
    } catch (err) {
      throw new BadRequestException(`The email didn’t go: ${this.mailFailure(err)}`);
    }
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.EMPLOYEE,
      action: AuditAction.PASSWORD_RESET_REQUESTED,
      recordType: 'Employee',
      recordId: employeeId,
      description: `Password reset link emailed by the office (${access})`,
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
    return {
      message: `We’ve emailed ${first} a link to choose a new password. It works for ${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes. Their current password keeps working until they use it.`,
      emailed: 'reset',
      status: await this.buildStatus(actor, emp, user),
    };
  }

  /**
   * "Set a password" (as before): the office types a new password for whoever has access switched on. It becomes the
   * password for both their office login and Care app (one password), they are signed out everywhere, and nothing is
   * emailed (the office gives it to them). Only the hash is stored.
   */
  async setPasswordByOffice(actor: RequestUser, employeeId: string, password: string, meta?: RequestAuditMeta): Promise<SignInAccessResult> {
    const emp = await this.loadEmployee(employeeId);
    const user = await this.findOfficeLogin(emp);
    const website = user?.isActive ? user : null;
    const portal = emp.portalAccount && !emp.portalAccount.deletedAt && emp.portalAccount.isEnabled ? emp.portalAccount : null;
    if (!website && !portal) throw new BadRequestException('Switch on an office login or the Care app first.');
    if (website) {
      this.assertCanManageWebsite(actor);
      if (this.isSuperAdmin(website) && !actor.roles.includes(IDENTITY_ROLE.SUPER_ADMIN)) {
        throw new ForbiddenException('Only a Super Admin can set a Super Admin’s password.');
      }
    }
    const hash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      await this.applyPasswordHash(tx, { userId: website?.id ?? null, portalId: portal?.id ?? null }, hash, actor.id);
      await this.audit.logAudit({
        tx,
        userId: actor.id,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.STAFF_SIGN_IN_ACCESS_CHANGED,
        recordType: 'Employee',
        recordId: employeeId,
        description: `Password set by the office (${website && portal ? 'website and Care app' : website ? 'website' : 'Care app'})`,
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    const first = emp.personalDetail?.firstName?.trim() || 'They';
    const where = website && portal ? 'the website and the Care app' : website ? 'CareFlow' : 'the Care app';
    const after = await this.loadEmployee(employeeId);
    return {
      message: `Password set. ${first} now signs in to ${where} with it, and has been signed out everywhere. Give it to ${first} yourself: it isn’t emailed.`,
      emailed: null,
      status: await this.buildStatus(actor, after, await this.findOfficeLogin(after)),
    };
  }

  /** One password: the same hash on their office login and Care app account, and every device signed out. */
  private async applyPasswordHash(
    tx: Prisma.TransactionClient,
    ids: { userId: string | null; portalId: string | null },
    hash: string,
    actorId: string,
  ): Promise<void> {
    const now = new Date();
    if (ids.userId) {
      await tx.user.update({ where: { id: ids.userId }, data: { passwordHash: hash, passwordSetAt: now, refreshTokenHash: null, updatedById: actorId } });
      await endAllSignInSessions(tx, 'USER', ids.userId, 'PASSWORD_CHANGED');
    }
    if (ids.portalId) {
      await tx.employeePortalAccount.update({
        where: { id: ids.portalId },
        data: { passwordHash: hash, passwordSetAt: now, refreshTokenHash: null, lastSeenAt: null, updatedById: actorId },
      });
      await endAllSignInSessions(tx, 'EMPLOYEE_APP', ids.portalId, 'PASSWORD_CHANGED');
    }
  }

  /** Sign out of every device (website and app), without switching anything off. */
  async signOutEverywhere(actor: RequestUser, employeeId: string, meta?: RequestAuditMeta): Promise<SignInAccessResult> {
    const emp = await this.loadEmployee(employeeId);
    const user = await this.findOfficeLogin(emp);
    if (user && user.id !== actor.id) {
      await this.prisma.user.update({ where: { id: user.id }, data: { refreshTokenHash: null } });
      await endAllSignInSessions(this.prisma, 'USER', user.id, 'ENDED_BY_OFFICE');
    }
    if (emp.portalAccount) {
      await this.prisma.employeePortalAccount.update({ where: { id: emp.portalAccount.id }, data: { refreshTokenHash: null, lastSeenAt: null } });
      await endAllSignInSessions(this.prisma, 'EMPLOYEE_APP', emp.portalAccount.id, 'ENDED_BY_OFFICE');
    }
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.EMPLOYEE,
      action: AuditAction.STAFF_SIGN_IN_ACCESS_CHANGED,
      recordType: 'Employee',
      recordId: employeeId,
      description: 'Signed out of every device by the office',
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
    const first = emp.personalDetail?.firstName?.trim() || 'They';
    return { message: `${first} has been signed out on every device.`, emailed: null, status: await this.buildStatus(actor, emp, user) };
  }

  /**
   * Roles & permissions › Office users: invite a new office user by email (email A) once their roles and branches
   * are saved. Their staff record (same email), when there is one, fills in the details.
   */
  async inviteOfficeUser(
    actor: RequestUser,
    userId: string,
    meta?: RequestAuditMeta,
    passwordGiven = false,
  ): Promise<{ message: string; emailed: StaffAccess }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { ...userSelect, userLocations: { select: { locationId: true, location: { select: { name: true } } } } },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isActive) throw new BadRequestException('This login is switched off.');
    if (maxRolePrivilege(user.userRoles.map((r) => r.role.name)) > maxRolePrivilege(actor.roles)) {
      throw new ForbiddenException('Cannot invite a user with higher privilege');
    }
    const personal = await this.prisma.employeePersonalDetail.findFirst({
      where: { email: { equals: user.email, mode: 'insensitive' }, employee: { deletedAt: null } },
      select: { employeeId: true },
    });
    const emp = personal ? await this.loadEmployee(personal.employeeId).catch(() => null) : null;
    const first = user.firstName?.trim() || 'They';

    let employment: StaffEmployment;
    let branch: BranchContact | null;
    if (emp) {
      employment = this.employmentOf(emp);
      branch = await loadBranchContact(this.prisma, emp.employment?.locationId);
    } else {
      employment = { accessLevel: user.userRoles.map((r) => r.role.name).join(', ') || null };
      branch = user.userLocations.length === 1 ? await loadBranchContact(this.prisma, user.userLocations[0].locationId) : null;
    }
    if (passwordGiven && !user.passwordSetAt) throw new BadRequestException('No password has been set for them yet.');
    const linkedApp = await this.prisma.employeePortalAccount.findFirst({ where: { userId: user.id, deletedAt: null, isEnabled: true }, select: { id: true } });
    const sent = await this.sendWelcomeTo(actor, {
      access: 'website',
      alsoReplaces: linkedApp && !passwordGiven ? 'app' : null,
      passwordGiven,
      userId: user.id,
      portalAccountId: linkedApp?.id ?? null,
      to: user.email,
      firstName: user.firstName,
      employment,
      branch,
      recordType: 'User',
      recordId: user.id,
      meta,
    });
    if (!sent.ok) throw new BadRequestException(`The email didn’t go: ${sent.reason}`);
    return {
      message: passwordGiven
        ? `We’ve emailed ${first} to say their account is ready. The password isn’t in the email: give it to ${first} yourself.`
        : `We’ve emailed ${first} a link to choose a password. It works for ${ACCOUNT_INVITE_TOKEN_TTL_HOURS} hours.`,
      emailed: 'website',
    };
  }

  /** Hourly (StaffLeaversAccessJob): staff whose end date has passed lose their sign-ins. */
  async endAccessForLeavers(now = new Date()): Promise<number> {
    const leavers = await this.prisma.employee.findMany({
      where: { deletedAt: null, employment: { endDate: { lt: now } } },
      select: {
        id: true,
        employment: { select: { endDate: true } },
        personalDetail: { select: { email: true } },
        portalAccount: { select: { isEnabled: true, deletedAt: true, userId: true } },
      },
    });
    const emails = leavers.map((l) => l.personalDetail?.email?.trim()).filter((e): e is string => Boolean(e));
    const linkedIds = leavers.map((l) => l.portalAccount?.userId).filter((id): id is string => Boolean(id));
    const activeUsers = emails.length || linkedIds.length
      ? await this.prisma.user.findMany({
          where: { isActive: true, deletedAt: null, OR: [{ email: { in: emails, mode: 'insensitive' } }, { id: { in: linkedIds } }] },
          select: { id: true, email: true },
        })
      : [];
    const activeEmails = new Set(activeUsers.map((u) => u.email.toLowerCase()));
    const activeIds = new Set(activeUsers.map((u) => u.id));

    let ended = 0;
    for (const l of leavers) {
      if (!leavingDateHasPassed(l.employment?.endDate, now)) continue;
      const appOn = Boolean(l.portalAccount?.isEnabled && !l.portalAccount.deletedAt);
      const websiteOn =
        (l.portalAccount?.userId && activeIds.has(l.portalAccount.userId)) ||
        activeEmails.has(l.personalDetail?.email?.trim().toLowerCase() ?? '');
      if (!appOn && !websiteOn) continue;
      await this.prisma.$transaction(async (tx) => {
        const r = await endStaffSignIns(tx, l.id, 'LEFT', null);
        if (!r.description) return;
        ended += 1;
        await this.audit.logAudit({
          tx,
          module: AuditModule.EMPLOYEE,
          action: AuditAction.STAFF_SIGN_IN_ACCESS_CHANGED,
          recordType: 'Employee',
          recordId: l.id,
          description: r.description,
        });
      });
    }
    return ended;
  }

  // ─── internals ─────────────────────────────────────────────────

  private async loadEmployee(employeeId: string): Promise<EmployeeRow> {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: employeeSelect });
    if (!emp) throw new NotFoundException('Employee not found');
    return emp;
  }

  /** Their office login: the one linked to their Care app account, else the one using their staff email. */
  private async findOfficeLogin(emp: EmployeeRow): Promise<UserRow | null> {
    if (emp.portalAccount?.userId) {
      const linked = await this.prisma.user.findFirst({ where: { id: emp.portalAccount.userId, deletedAt: null }, select: userSelect });
      if (linked) return linked;
    }
    const email = emp.personalDetail?.email?.trim();
    if (!email) return null;
    return this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null }, select: userSelect });
  }

  private isSuperAdmin(user: UserRow): boolean {
    return user.userRoles.some((r) => r.role.name === IDENTITY_ROLE.SUPER_ADMIN);
  }

  private assertCanManageWebsite(actor: RequestUser) {
    if (!actor.permissions?.includes('users.create')) {
      throw new ForbiddenException('You need permission to add office users to change an office login.');
    }
  }

  private blockedReason(emp: EmployeeRow): string | null {
    const first = emp.personalDetail?.firstName?.trim() || 'They';
    if (leavingDateHasPassed(emp.employment?.endDate)) return `${first} has left (end date passed)`;
    if (!emp.isActive || emp.personalDetail?.status?.name?.trim().toLowerCase() === 'inactive') return `${first} is inactive`;
    return null;
  }

  private employmentOf(emp: EmployeeRow): StaffEmployment {
    return {
      role: emp.employment?.role?.name ?? null,
      jobTitle: emp.employment?.jobTitle?.name ?? null,
      accessLevel: emp.employment?.rbacLevel?.name ?? null,
      workArea: emp.employment?.workArea?.name ?? null,
    };
  }

  private accessWords(access: StaffAccess, capital = false): string {
    const w = access === 'both' ? 'office login and Care app are' : access === 'website' ? 'office login is' : 'Care app is';
    return capital ? `The ${w}` : `the ${w}`;
  }

  private mailFailure(err: unknown): string {
    if (err instanceof MessageHeldError) return 'this kind of email is switched off in Administration › Message delivery.';
    return 'the email service is not working right now.';
  }

  private async sendWelcome(
    actor: RequestUser,
    emp: EmployeeRow,
    user: UserRow | null,
    access: StaffAccess,
    meta?: RequestAuditMeta,
    passwordGiven = false,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const portal = emp.portalAccount && !emp.portalAccount.deletedAt && emp.portalAccount.isEnabled ? emp.portalAccount : null;
    const website = user?.isActive ? user : null;
    // The other account already there: the same link sets its password too (one password for both).
    const alsoReplaces = access === 'website' && portal ? 'app' : access === 'app' && website ? 'website' : null;
    return this.sendWelcomeTo(actor, {
      access,
      alsoReplaces: passwordGiven ? null : alsoReplaces,
      passwordGiven,
      userId: website?.id ?? null,
      portalAccountId: portal?.id ?? null,
      to: (access === 'app' ? portal?.email : website?.email) ?? portal?.email ?? website!.email,
      firstName: emp.personalDetail?.firstName ?? null,
      employment: this.employmentOf(emp),
      branch: await loadBranchContact(this.prisma, emp.employment?.locationId),
      recordType: 'Employee',
      recordId: emp.id,
      meta,
    });
  }

  private async sendWelcomeTo(
    actor: RequestUser,
    p: {
      access: StaffAccess;
      alsoReplaces: 'website' | 'app' | null;
      /** The office set the password: no link, and the email says their manager will give it to them. */
      passwordGiven?: boolean;
      userId: string | null;
      portalAccountId: string | null;
      to: string;
      firstName: string | null;
      employment: StaffEmployment;
      branch: BranchContact | null;
      recordType: string;
      recordId: string;
      meta?: RequestAuditMeta;
    },
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const issued = p.passwordGiven
      ? null
      : await this.auth.issueSetPasswordToken(
          { userId: p.userId, portalAccountId: p.portalAccountId },
          { invite: true, requestedIp: p.meta?.ipAddress ?? null },
        );
    if (!p.passwordGiven && !issued) return { ok: false, reason: 'too many links were sent in the last hour, or the set-password address is not configured.' };
    const branding = await this.auth.accountEmailBranding();
    if (!branding) return { ok: false, reason: 'the CareFlow site address is not set (ADMIN_APP_URL).' };
    const built = buildWelcomeEmail({
      access: p.access,
      alsoReplaces: p.alsoReplaces,
      passwordGiven: p.passwordGiven,
      firstName: p.firstName,
      email: p.to,
      link: issued ? setPasswordLink(issued.urlBase, issued.rawToken, p.access !== 'app') : '',
      linkHours: ACCOUNT_INVITE_TOKEN_TTL_HOURS,
      employment: p.employment,
      branch: p.branch,
      branding,
    });
    try {
      // The link signs in as this person: never copy it to MAIL_BCC.
      await this.mail.send({ kind: WELCOME_MESSAGE_KIND[p.access], to: p.to, subject: built.subject, text: built.text, html: built.html, skipBcc: true });
    } catch (err) {
      this.logger.warn(`Welcome email (${p.access}) could not be sent for ${p.recordType} ${p.recordId}: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, reason: this.mailFailure(err) };
    }
    await this.audit.logAudit({
      userId: actor.id,
      module: p.recordType === 'User' ? AuditModule.USER : AuditModule.EMPLOYEE,
      action: AuditAction.ACCOUNT_INVITE_SENT,
      recordType: p.recordType,
      recordId: p.recordId,
      description: `Welcome email sent (${p.access === 'both' ? 'website and Care app' : p.access === 'website' ? 'website login' : 'Care app'}${p.passwordGiven ? ', password given by the office' : ''})`,
      metadata: { userId: p.userId, portalAccountId: p.portalAccountId },
      ipAddress: p.meta?.ipAddress ?? undefined,
      userAgent: p.meta?.userAgent ?? undefined,
    });
    return { ok: true };
  }

  private async buildStatus(actor: RequestUser, emp: EmployeeRow, user: UserRow | null): Promise<SignInAccessStatus> {
    const portal = emp.portalAccount && !emp.portalAccount.deletedAt ? emp.portalAccount : null;
    const now = new Date();
    const [userSessions, appSessions, userLink, appLink] = await Promise.all([
      user
        ? this.prisma.authSession.findMany({ where: { kind: 'USER', accountId: user.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, revokedAt: true, expiresAt: true }, take: 50 })
        : Promise.resolve([]),
      portal
        ? this.prisma.authSession.findMany({ where: { kind: 'EMPLOYEE_APP', accountId: portal.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, revokedAt: true, expiresAt: true }, take: 50 })
        : Promise.resolve([]),
      user ? this.prisma.passwordResetToken.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }) : Promise.resolve(null),
      portal ? this.prisma.passwordResetToken.findFirst({ where: { employeePortalAccountId: portal.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }) : Promise.resolve(null),
    ]);
    const live = (rows: Array<{ revokedAt: Date | null; expiresAt: Date }>) => rows.filter((r) => !r.revokedAt && r.expiresAt > now).length;
    const level = emp.employment?.rbacLevel?.name ?? null;
    const blocked = this.blockedReason(emp);
    return {
      employeeId: emp.id,
      firstName: emp.personalDetail?.firstName ?? null,
      lastName: emp.personalDetail?.lastName ?? null,
      email: emp.personalDetail?.email ?? null,
      canHaveAccess: !blocked,
      blockedReason: blocked,
      rbacLevel: level,
      rbacLevelKind: rbacLevelKind(level),
      suggested: suggestedAccess(level),
      website: {
        state: signInState(user ? { enabled: user.isActive, passwordSetAt: user.passwordSetAt } : null),
        email: user?.email ?? null,
        roles: user?.userRoles.map((r) => r.role.name) ?? [],
        isSuperAdmin: user ? this.isSuperAdmin(user) : false,
        lastSignInAt: userSessions[0]?.createdAt.toISOString() ?? null,
        signedInDevices: live(userSessions),
        linkSentAt: userLink?.createdAt.toISOString() ?? null,
      },
      app: {
        state: signInState(portal ? { enabled: portal.isEnabled, passwordSetAt: portal.passwordSetAt } : null),
        email: portal?.email ?? null,
        lastSignInAt: appSessions[0]?.createdAt.toISOString() ?? portal?.lastLoginAt?.toISOString() ?? null,
        signedInDevices: live(appSessions),
        linkSentAt: appLink?.createdAt.toISOString() ?? null,
      },
      onePassword: Boolean(user && portal && portal.userId === user.id),
      canManageWebsite: Boolean(actor.permissions?.includes('users.create')),
    };
  }
}
