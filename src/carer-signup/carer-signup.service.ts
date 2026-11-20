import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AllocationStatus,
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
  ScheduledJobStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { EmployeesService } from '../employees/employees.service';
import { AllocationComplianceService } from '../employee-compliance/allocation-compliance.service';
import { hashPassword } from '../common/utils/password.util';
import { branchLabelsById } from '../location-management/location-management.util';
import { IDENTITY_ROLE } from '../common/org-scope/org-scope.types';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type {
  CarerDeletionDecisionDto,
  CarerDeletionRequestDto,
  CarerSignupDecisionDto,
  CarerSignupDto,
} from './dto/carer-signup.dto';
export * from './carer-signup.constants';

/** RoleTask.sourceType values raised by this feature (shown in admin › My tasks). */
export const CARER_SIGNUP_TASK_SOURCE = 'CARER_SIGNUP';
export const CARER_DELETION_TASK_SOURCE = 'CARER_DELETION_REQUEST';

/**
 * Who reviews Care app sign-ups and delete requests (approved default, 19 Nov 2026): the branch's
 * Managers and Branch Admins, plus Admins and Super Admins (company-wide). One My-tasks task per role;
 * a decision by any of them closes them all.
 */
export const CARER_REVIEW_ROLE_NAMES = [
  IDENTITY_ROLE.MANAGER,
  IDENTITY_ROLE.BRANCH_ADMIN,
  IDENTITY_ROLE.ADMIN,
  IDENTITY_ROLE.SUPER_ADMIN,
] as const;

/** Job details given on approval when the office does not choose others (approved default, 19 Nov 2026). */
const DEFAULT_ROLE_NAME = 'Carer';
const DEFAULT_RBAC_LEVEL_NAME = 'Carer/Domestic';
const DEFAULT_WORK_AREA_NAME = 'Care';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const normEmail = (e: string) => e.trim().toLowerCase();
const fullName = (p: { firstName?: string | null; lastName?: string | null } | null | undefined) =>
  [p?.firstName, p?.lastName].filter(Boolean).join(' ').trim() || 'A carer';

/**
 * Who may approve or decline a Care app sign-up or delete request (user decision, 20 Nov 2026): the review
 * roles that receive the task (Manager, Branch Admin, Admin, Super Admin), or anyone who may edit staff
 * (sign-up) / delete staff (delete request).
 */
export function canDecideCarerRequest(actor: RequestUser, kind: 'signup' | 'deletion'): boolean {
  if ((actor.roles ?? []).some((r) => (CARER_REVIEW_ROLE_NAMES as readonly string[]).includes(r))) return true;
  return (actor.permissions ?? []).includes(kind === 'signup' ? 'employees.update' : 'employees.delete');
}

@Injectable()
export class CarerSignupService {
  private readonly logger = new Logger(CarerSignupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly notifications: NotificationsService,
    private readonly employees: EmployeesService,
    private readonly allocationCompliance: AllocationComplianceService,
    private readonly orgScope: OrgScopeService,
  ) {}

  /** Branch-limited office users may only decide requests for carers in their own branches. */
  private async assertInScope(actor: RequestUser, employeeId: string) {
    await this.orgScope.assertEmployeeInScope(this.orgScope.fromRequestUser(actor), employeeId);
  }

  // ───────────────────────────── Care app (public) ─────────────────────────────

  /** Branches a carer can sign up to, with the office's map position when the branch has one. */
  async signupBranches() {
    const [locations, areas] = await Promise.all([
      this.prisma.location.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.scheduleArea.findMany({
        where: { deletedAt: null, locationId: { not: null }, latitude: { not: null }, longitude: { not: null } },
        select: { locationId: true, latitude: true, longitude: true, postcode: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    const labels = await branchLabelsById(this.prisma, locations.map((l) => l.id));
    const pos = new Map<string, { latitude: number; longitude: number; postcode: string | null }>();
    for (const a of areas) {
      if (!a.locationId || pos.has(a.locationId)) continue;
      pos.set(a.locationId, { latitude: Number(a.latitude), longitude: Number(a.longitude), postcode: a.postcode ?? null });
    }
    return {
      message: 'Branches',
      data: locations.map((l) => ({
        id: l.id,
        name: labels.get(l.id) ?? l.name,
        latitude: pos.get(l.id)?.latitude ?? null,
        longitude: pos.get(l.id)?.longitude ?? null,
        postcode: pos.get(l.id)?.postcode ?? null,
      })),
    };
  }

  /**
   * A carer's own sign-up. Makes the staff record (inactive), its branch, and a Care app account that
   * waits for approval; raises a My-tasks task and a notification for the reviewers.
   */
  async signup(dto: CarerSignupDto, req: Request) {
    const meta = this.audit.getRequestMeta(req);
    const email = normEmail(dto.email);
    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, deletedAt: null, isActive: true },
      select: { id: true, name: true },
    });
    if (!location) throw new BadRequestException('Choose a branch from the list.');
    const branchLabel = (await branchLabelsById(this.prisma, [location.id])).get(location.id) ?? location.name;

    const [personal, portal, user] = await Promise.all([
      this.prisma.employeePersonalDetail.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } }),
      this.prisma.employeePortalAccount.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } }),
      this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } }),
    ]);
    if (personal || portal || user) {
      throw new ConflictException('An account already uses this email address. Log in, or use “Forgot password”.');
    }

    const passwordHash = await hashPassword(dto.password);
    const username = await this.uniqueUsername(email);
    const now = new Date();
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();

    let employeeId: string;
    try {
      employeeId = await this.prisma.$transaction(async (tx) => {
        const employee = await tx.employee.create({
          data: {
            // Inactive until approved: it can't be given visits or sign in before then.
            isActive: false,
            creationSource: 'CARE_APP_SIGNUP',
            personalDetail: {
              create: {
                firstName,
                lastName,
                email,
                username,
                mobileTelephone: dto.mobile.trim(),
                dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
                addressLine1: dto.addressLine1?.trim() || null,
                town: dto.town?.trim() || null,
                postcode: dto.postcode?.trim().toUpperCase() || null,
              },
            },
            employment: {
              create: {
                locationId: location.id,
                nationalInsuranceNo: dto.nationalInsuranceNo?.replace(/\s+/g, '').toUpperCase() || null,
              },
            },
          },
          select: { id: true },
        });
        await tx.employeePortalAccount.create({
          data: {
            employeeId: employee.id,
            email,
            passwordHash,
            passwordSetAt: now,
            isEnabled: false,
            approvalStatus: 'PENDING',
          },
        });
        await this.raiseTasks(tx, {
          sourceType: CARER_SIGNUP_TASK_SOURCE,
          sourceId: employee.id,
          locationId: location.id,
          title: `New carer sign-up: ${firstName} ${lastName}`,
          description: `${firstName} ${lastName} made an account in the Care app (${branchLabel}). Check their details and approve or decline.`,
          link: `/employee/${employee.id}/review`,
        });
        await this.audit.logAudit({
          tx,
          module: AuditModule.EMPLOYEE,
          action: AuditAction.CARER_SIGNUP_REQUESTED,
          recordType: 'Employee',
          recordId: employee.id,
          description: `Care app sign-up (${branchLabel})`,
          newValues: { firstName, lastName, email, locationId: location.id, creationSource: 'CARE_APP_SIGNUP' },
          ipAddress: meta.ipAddress ?? undefined,
          userAgent: meta.userAgent ?? undefined,
        });
        return employee.id;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('An account already uses this email address. Log in, or use “Forgot password”.');
      }
      throw e;
    }

    await this.notifyReviewers(location.id, {
      title: 'New carer sign-up',
      message: `${firstName} ${lastName} signed up in the Care app (${branchLabel}) and is waiting for approval.`,
      recordType: 'Employee',
      recordId: employeeId,
      href: `/employee/${employeeId}/review`,
      eventType: 'CARER_SIGNUP_REQUESTED',
    });

    return {
      message: 'Your account has been sent to the office for approval.',
      data: { status: 'PENDING' as const },
    };
  }

  // ───────────────────────────── Care app (signed in) ─────────────────────────────

  async myDeletionRequest(employeeId: string) {
    const row = await this.latestDeletionRequest(employeeId);
    return { message: 'Delete request', data: row ? this.deletionView(row) : null };
  }

  async requestDeletion(employeeId: string, dto: CarerDeletionRequestDto, req: Request) {
    const meta = this.audit.getRequestMeta(req);
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Tell us why you want to delete your account.');
    const existing = await this.prisma.employeeAccountDeletionRequest.findFirst({
      where: { employeeId, status: 'PENDING' },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Your delete request is already waiting for your manager.');

    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { personalDetail: { select: { firstName: true, lastName: true } }, employment: { select: { locationId: true } } },
    });
    if (!emp) throw new NotFoundException('Account not found');
    const name = fullName(emp.personalDetail);
    const locationId = emp.employment?.locationId ?? null;

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeAccountDeletionRequest.create({ data: { employeeId, reason } });
      await this.raiseTasks(tx, {
        sourceType: CARER_DELETION_TASK_SOURCE,
        sourceId: created.id,
        locationId,
        title: `Account delete request: ${name}`,
        description: `${name} asked in the Care app for their account to be deleted. Review their future visits, then approve or decline.`,
        link: `/employee/${employeeId}/review`,
      });
      await this.audit.logAudit({
        tx,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.CARER_DELETION_REQUESTED,
        recordType: 'Employee',
        recordId: employeeId,
        description: `Reason: ${reason.slice(0, 500)}`,
        ipAddress: meta.ipAddress ?? undefined,
        userAgent: meta.userAgent ?? undefined,
      });
      return created;
    });

    await this.notifyReviewers(locationId, {
      title: 'Account delete request',
      message: `${name} asked to delete their Care app account. It waits for your approval.`,
      recordType: 'Employee',
      recordId: employeeId,
      href: `/employee/${employeeId}/review`,
      eventType: 'CARER_DELETION_REQUESTED',
    });
    return { message: 'Your delete request has been sent to your manager.', data: this.deletionView(row) };
  }

  // ───────────────────────────── Office ─────────────────────────────

  /** The review for an office user: only for carers in their branches (branch-limited users). */
  async reviewFor(actor: RequestUser, employeeId: string) {
    await this.assertInScope(actor, employeeId);
    const result = await this.review(employeeId);
    return {
      ...result,
      data: {
        ...result.data,
        canDecide: { signup: canDecideCarerRequest(actor, 'signup'), deletion: canDecideCarerRequest(actor, 'deletion') },
      },
    };
  }

  /** What the staff record shows: how it was made, a waiting sign-up, a waiting delete request. */
  async review(employeeId: string) {
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: {
        id: true,
        createdById: true,
        createdAt: true,
        creationSource: true,
        employment: {
          select: { locationId: true, roleId: true, rbacLevelId: true, contractedWeeklyHours: true, nationalInsuranceNo: true },
        },
        personalDetail: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            mobileTelephone: true,
            dateOfBirth: true,
            addressLine1: true,
            town: true,
            postcode: true,
          },
        },
        portalAccount: {
          select: { approvalStatus: true, approvalDecidedAt: true, approvalDecidedById: true, approvalNote: true, deletedAt: true },
        },
      },
    });
    if (!emp) throw new NotFoundException('Employee not found');

    const creator = emp.createdById ? await this.userSummary(emp.createdById) : null;
    const portal = emp.portalAccount && !emp.portalAccount.deletedAt ? emp.portalAccount : null;
    const decidedBy = portal?.approvalDecidedById ? await this.userSummary(portal.approvalDecidedById) : null;
    const deletion = await this.latestDeletionRequest(employeeId);
    const deletionDecidedBy = deletion?.decidedById ? await this.userSummary(deletion.decidedById) : null;
    const futureVisits = deletion?.status === 'PENDING' ? await this.futureVisits(employeeId) : null;
    const defaults = portal?.approvalStatus === 'PENDING' ? await this.defaultJobDetails() : null;
    const isSignup = emp.creationSource === 'CARE_APP_SIGNUP' && !!portal;
    const p = emp.personalDetail;
    const branchLabel = emp.employment?.locationId
      ? ((await branchLabelsById(this.prisma, [emp.employment.locationId])).get(emp.employment.locationId) ?? null)
      : null;
    // What the carer typed in the Care app (the record may since have been edited by the office).
    const submitted = isSignup
      ? {
          signedUpAt: emp.createdAt,
          firstName: p?.firstName ?? null,
          lastName: p?.lastName ?? null,
          email: p?.email ?? null,
          mobile: p?.mobileTelephone ?? null,
          dateOfBirth: p?.dateOfBirth ?? null,
          address: [p?.addressLine1, p?.town, p?.postcode].filter(Boolean).join(', ') || null,
          nationalInsuranceNo: emp.employment?.nationalInsuranceNo ?? null,
          branch: branchLabel,
        }
      : null;
    const missing = isSignup && portal?.approvalStatus === 'APPROVED' ? await this.missingSetup(employeeId) : null;
    // Branch picker on the approval card: "Zone · Branch", the same names as everywhere else.
    const branchOptions =
      isSignup && portal?.approvalStatus === 'PENDING' ? (await this.signupBranches()).data.map((b) => ({ id: b.id, label: b.name })) : null;

    return {
      message: 'Account review',
      data: {
        createdAt: emp.createdAt,
        creationSource: emp.creationSource,
        createdBy: creator,
        signup:
          emp.creationSource === 'CARE_APP_SIGNUP' && portal
            ? {
                status: portal.approvalStatus,
                decidedAt: portal.approvalDecidedAt,
                decidedBy,
                note: portal.approvalNote,
                submitted,
                missing,
                branchOptions,
                current: {
                  locationId: emp.employment?.locationId ?? null,
                  roleId: emp.employment?.roleId ?? null,
                  rbacLevelId: emp.employment?.rbacLevelId ?? null,
                  contractedWeeklyHours:
                    emp.employment?.contractedWeeklyHours != null ? Number(emp.employment.contractedWeeklyHours) : null,
                },
                defaults,
              }
            : null,
        deletionRequest: deletion ? { ...this.deletionView(deletion), decidedBy: deletionDecidedBy, futureVisits } : null,
      },
    };
  }

  async decideSignup(actor: RequestUser, employeeId: string, dto: CarerSignupDecisionDto, meta?: RequestAuditMeta) {
    if (!canDecideCarerRequest(actor, 'signup')) {
      throw new ForbiddenException('Only a manager, branch admin or admin can approve or decline a sign-up.');
    }
    await this.assertInScope(actor, employeeId);
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: {
        id: true,
        creationSource: true,
        personalDetail: { select: { firstName: true, lastName: true } },
        employment: { select: { locationId: true, roleId: true, rbacLevelId: true, workAreaId: true } },
        portalAccount: { select: { id: true, approvalStatus: true, deletedAt: true } },
      },
    });
    if (!emp) throw new NotFoundException('Employee not found');
    const portal = emp.portalAccount && !emp.portalAccount.deletedAt ? emp.portalAccount : null;
    if (!portal || emp.creationSource !== 'CARE_APP_SIGNUP') {
      throw new BadRequestException('This staff member did not sign up in the Care app.');
    }
    if (portal.approvalStatus !== 'PENDING') throw new ConflictException('This sign-up has already been decided.');
    const name = fullName(emp.personalDetail);
    const note = dto.note?.trim() || null;
    const now = new Date();

    if (dto.decision === 'approve') {
      const defaults = await this.defaultJobDetails();
      const locationId = dto.locationId ?? emp.employment?.locationId ?? null;
      if (!locationId) throw new BadRequestException('Choose a branch before approving.');
      const loc = await this.prisma.location.findFirst({ where: { id: locationId, deletedAt: null }, select: { id: true } });
      if (!loc) throw new BadRequestException('Choose a branch from the list.');
      const roleId = dto.roleId ?? emp.employment?.roleId ?? defaults.roleId;
      const rbacLevelId = dto.rbacLevelId ?? emp.employment?.rbacLevelId ?? defaults.rbacLevelId;
      const workAreaId = emp.employment?.workAreaId ?? defaults.workAreaId;
      // Optional: the office may approve without hours (they are warned in the admin); visits then wait for them.
      const hours = dto.contractedWeeklyHours != null && dto.contractedWeeklyHours > 0 ? dto.contractedWeeklyHours : undefined;

      await this.prisma.$transaction(async (tx) => {
        await tx.employee.update({ where: { id: employeeId }, data: { isActive: true, updatedById: actor.id } });
        await tx.employeeEmployment.upsert({
          where: { employeeId },
          create: {
            employeeId,
            locationId,
            roleId,
            rbacLevelId,
            workAreaId,
            ...(hours !== undefined ? { contractedWeeklyHours: hours } : {}),
            createdById: actor.id,
          },
          update: {
            locationId,
            roleId,
            rbacLevelId,
            workAreaId,
            ...(hours !== undefined ? { contractedWeeklyHours: hours } : {}),
            updatedById: actor.id,
          },
        });
        await tx.employeePortalAccount.update({
          where: { id: portal.id },
          data: {
            isEnabled: true,
            approvalStatus: 'APPROVED',
            approvalDecidedAt: now,
            approvalDecidedById: actor.id,
            approvalNote: note,
            updatedById: actor.id,
          },
        });
        await this.closeTasks(tx, CARER_SIGNUP_TASK_SOURCE, employeeId, actor.id, note ?? 'Approved');
        await this.audit.logAudit({
          tx,
          userId: actor.id,
          module: AuditModule.EMPLOYEE,
          action: AuditAction.CARER_SIGNUP_APPROVED,
          recordType: 'Employee',
          recordId: employeeId,
          description: note ? `Approved: ${note}` : 'Approved',
          newValues: { locationId, roleId, rbacLevelId, workAreaId, contractedWeeklyHours: hours ?? null },
          ipAddress: meta?.ipAddress ?? undefined,
          userAgent: meta?.userAgent ?? undefined,
        });
      });
      return {
        message: `${name} is approved and can now log in to the Care app.`,
        data: { ...(await this.review(employeeId)).data, missing: await this.missingSetup(employeeId) },
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.employeePortalAccount.update({
        where: { id: portal.id },
        data: {
          isEnabled: false,
          approvalStatus: 'DECLINED',
          approvalDecidedAt: now,
          approvalDecidedById: actor.id,
          approvalNote: note,
          refreshTokenHash: null,
          updatedById: actor.id,
        },
      });
      await this.closeTasks(tx, CARER_SIGNUP_TASK_SOURCE, employeeId, actor.id, note ?? 'Declined');
      await this.audit.logAudit({
        tx,
        userId: actor.id,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.CARER_SIGNUP_DECLINED,
        recordType: 'Employee',
        recordId: employeeId,
        description: note ? `Declined: ${note}` : 'Declined',
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return { message: `${name}’s sign-up was declined.`, data: (await this.review(employeeId)).data };
  }

  async decideDeletion(actor: RequestUser, employeeId: string, dto: CarerDeletionDecisionDto, meta?: RequestAuditMeta) {
    if (!canDecideCarerRequest(actor, 'deletion')) {
      throw new ForbiddenException('Only a manager, branch admin or admin can approve or decline this request.');
    }
    await this.assertInScope(actor, employeeId);
    const request = await this.prisma.employeeAccountDeletionRequest.findFirst({
      where: { employeeId, status: 'PENDING' },
      orderBy: { requestedAt: 'desc' },
    });
    if (!request) throw new NotFoundException('No delete request is waiting for this staff member.');
    const note = dto.note?.trim() || null;
    const now = new Date();

    if (dto.decision === 'approve') {
      if (!canDecideCarerRequest(actor, 'deletion')) {
        throw new ForbiddenException('Only a manager, branch admin or admin can approve this request.');
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.employeeAccountDeletionRequest.update({
          where: { id: request.id },
          data: { status: 'APPROVED', decidedAt: now, decidedById: actor.id, decisionNote: note },
        });
        await this.closeTasks(tx, CARER_DELETION_TASK_SOURCE, request.id, actor.id, note ?? 'Approved');
        await this.audit.logAudit({
          tx,
          userId: actor.id,
          module: AuditModule.EMPLOYEE,
          action: AuditAction.CARER_DELETION_APPROVED,
          recordType: 'Employee',
          recordId: employeeId,
          description: note ? `Approved: ${note}` : 'Approved',
          ipAddress: meta?.ipAddress ?? undefined,
          userAgent: meta?.userAgent ?? undefined,
        });
      });
      // The usual staff delete: past records stay, future visits are unassigned, sign-ins end.
      const result = await this.employees.softDelete(
        actor.id,
        employeeId,
        meta,
        `Carer asked to delete their account in the Care app: ${request.reason}`.slice(0, 500),
      );
      return { message: 'The account is deleted. Their past records are kept.', data: { scheduleImpact: result.scheduleImpact ?? null } };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.employeeAccountDeletionRequest.update({
        where: { id: request.id },
        data: { status: 'DECLINED', decidedAt: now, decidedById: actor.id, decisionNote: note },
      });
      await this.closeTasks(tx, CARER_DELETION_TASK_SOURCE, request.id, actor.id, note ?? 'Declined');
      await this.audit.logAudit({
        tx,
        userId: actor.id,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.CARER_DELETION_DECLINED,
        recordType: 'Employee',
        recordId: employeeId,
        description: note ? `Declined: ${note}` : 'Declined',
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return { message: 'The delete request was declined.', data: (await this.review(employeeId)).data };
  }

  // ───────────────────────────── helpers ─────────────────────────────

  /**
   * What an approved carer still needs before they can work and be paid (shown after approval, 20 Nov 2026).
   * Each item names the staff-record tab where the office adds it.
   */
  async missingSetup(employeeId: string): Promise<Array<{ key: string; label: string; tab: string }>> {
    const [employment, patterns, payroll, compliance] = await Promise.all([
      this.prisma.employeeEmployment.findUnique({ where: { employeeId }, select: { contractedWeeklyHours: true } }),
      this.prisma.employeeWorkingPattern.count({ where: { employeeId, deletedAt: null, isActive: true } }),
      this.prisma.employeePayrollProfile.findFirst({ where: { employeeId, deletedAt: null }, select: { status: true } }),
      this.allocationCompliance.evaluateForEmployee(employeeId).catch(() => null),
    ]);
    const out: Array<{ key: string; label: string; tab: string }> = [];
    if (!employment?.contractedWeeklyHours || Number(employment.contractedWeeklyHours) <= 0) {
      out.push({ key: 'contractedHours', label: 'Contracted weekly hours (needed before visits can be given)', tab: 'employment' });
    }
    if (!patterns) out.push({ key: 'workingPattern', label: 'Working pattern (when they are available)', tab: 'working-pattern' });
    if (compliance && compliance.blockingIssues.length) {
      out.push({
        key: 'compliance',
        label: `Compliance documents (${compliance.blockingIssues.length} required item${compliance.blockingIssues.length === 1 ? '' : 's'} missing)`,
        tab: 'employment-compliance',
      });
    }
    if (payroll?.status !== 'READY') {
      out.push({ key: 'payroll', label: 'Payroll details for HMRC (NI number, tax code, address)', tab: 'salary' });
    }
    return out;
  }

  private async uniqueUsername(email: string): Promise<string> {
    const base = (email.split('@')[0] ?? 'carer').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40) || 'carer';
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? base : `${base}${i + 1}`;
      const taken = await this.prisma.employeePersonalDetail.findFirst({ where: { username: candidate }, select: { id: true } });
      if (!taken) return candidate;
    }
    return `${base}-${randomUUID().slice(0, 8)}`;
  }

  private async defaultJobDetails() {
    const [role, rbac, area] = await Promise.all([
      this.prisma.employeeRoleLookup.findFirst({ where: { name: DEFAULT_ROLE_NAME, deletedAt: null }, select: { id: true } }),
      this.prisma.rBACLevel.findFirst({ where: { name: DEFAULT_RBAC_LEVEL_NAME, deletedAt: null }, select: { id: true } }),
      this.prisma.workArea.findFirst({ where: { name: DEFAULT_WORK_AREA_NAME, deletedAt: null }, select: { id: true } }),
    ]);
    return { roleId: role?.id ?? null, rbacLevelId: rbac?.id ?? null, workAreaId: area?.id ?? null };
  }

  private async raiseTasks(
    tx: Prisma.TransactionClient,
    input: { sourceType: string; sourceId: string; locationId: string | null; title: string; description: string; link: string },
  ) {
    const roles = await tx.role.findMany({
      where: { name: { in: [...CARER_REVIEW_ROLE_NAMES] }, deletedAt: null },
      select: { id: true },
    });
    const today = new Date();
    const dueDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    for (const role of roles) {
      await tx.roleTask.create({
        data: {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          roleId: role.id,
          locationId: input.locationId,
          title: input.title,
          description: input.description,
          link: input.link,
          dueDate,
        },
      });
    }
  }

  private async closeTasks(tx: Prisma.TransactionClient, sourceType: string, sourceId: string, actorId: string, note: string) {
    await tx.roleTask.updateMany({
      where: { sourceType, sourceId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      data: { status: 'DONE', completedAt: new Date(), completedById: actorId, note: note.slice(0, 1000) },
    });
  }

  /** Office users with a review role who can see this branch (company-wide users always). Never fails the caller. */
  private async notifyReviewers(
    locationId: string | null,
    n: { title: string; message: string; recordType: string; recordId: string; href: string; eventType: string },
  ) {
    try {
      const links = await this.prisma.userRole.findMany({
        where: {
          role: { name: { in: [...CARER_REVIEW_ROLE_NAMES] }, deletedAt: null },
          user: { deletedAt: null, isActive: true },
        },
        select: {
          userId: true,
          role: { select: { name: true } },
          user: { select: { userLocations: { select: { locationId: true } } } },
        },
      });
      const companyWide = new Set<string>([IDENTITY_ROLE.SUPER_ADMIN, IDENTITY_ROLE.ADMIN]);
      const ids = [
        ...new Set(
          links
            .filter(
              (l) =>
                companyWide.has(l.role.name) ||
                !locationId ||
                !l.user.userLocations.length ||
                l.user.userLocations.some((x) => x.locationId === locationId),
            )
            .map((l) => l.userId),
        ),
      ];
      if (!ids.length) return;
      await this.notifications.notifyUsers({
        recipientUserIds: ids,
        type: NotificationType.SYSTEM_MESSAGE,
        module: NotificationModule.EMPLOYEE,
        severity: NotificationSeverity.WARNING,
        title: n.title,
        message: n.message,
        recordType: n.recordType,
        recordId: n.recordId,
        metadata: { href: n.href, eventType: n.eventType },
      });
    } catch (e) {
      this.logger.warn(`Carer review notification failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async userSummary(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, email: true, userRoles: { select: { role: { select: { name: true } } } } },
    });
    if (!u) return null;
    return {
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email,
      roles: u.userRoles.map((r) => r.role.name),
    };
  }

  private latestDeletionRequest(employeeId: string) {
    return this.prisma.employeeAccountDeletionRequest.findFirst({
      where: { employeeId },
      orderBy: { requestedAt: 'desc' },
    });
  }

  private deletionView(row: {
    id: string;
    reason: string;
    status: string;
    requestedAt: Date;
    decidedAt: Date | null;
    decisionNote: string | null;
  }) {
    return {
      id: row.id,
      reason: row.reason,
      status: row.status,
      requestedAt: row.requestedAt,
      decidedAt: row.decidedAt,
      decisionNote: row.decisionNote,
    };
  }

  /** Visits from now on that would lose this carer if the account is deleted. */
  private async futureVisits(employeeId: string) {
    const rows = await this.prisma.jobAllocation.findMany({
      where: {
        employeeId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_ALLOCATION },
        scheduledJob: {
          deletedAt: null,
          isActive: true,
          scheduledStartDateTime: { gte: new Date() },
          status: { notIn: [ScheduledJobStatus.DRAFT, ScheduledJobStatus.CANCELLED, ScheduledJobStatus.CALLED_OFF] },
        },
      },
      orderBy: { scheduledJob: { scheduledStartDateTime: 'asc' } },
      take: 200,
      select: {
        scheduledJob: {
          select: {
            id: true,
            scheduledStartDateTime: true,
            scheduledEndDateTime: true,
            serviceUser: { select: { firstName: true, lastName: true, preferredName: true } },
          },
        },
      },
    });
    return {
      count: rows.length,
      visits: rows.map((r) => ({
        jobId: r.scheduledJob.id,
        start: r.scheduledJob.scheduledStartDateTime,
        end: r.scheduledJob.scheduledEndDateTime,
        client: [r.scheduledJob.serviceUser?.preferredName || r.scheduledJob.serviceUser?.firstName, r.scheduledJob.serviceUser?.lastName]
          .filter(Boolean)
          .join(' '),
      })),
    };
  }
}
