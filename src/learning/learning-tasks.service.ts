import { Injectable, Logger } from '@nestjs/common';
import {
  LearningAssignmentReviewKind,
  LearningAssignmentStatus,
  LearningCertificateStatus,
  RoleTaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LearningSettingsService } from './learning-settings.service';

/**
 * Learning work for the office in My tasks (18 Nov 2026, user decision). Tasks go to one role
 * (Learning settings › taskRoleId, else the Admin role) for the carer's branch, and close
 * themselves when the work is done in Learning. Each sync reads the record's current state,
 * so calling it again is always safe.
 */
export const LEARNING_TASK = {
  OUTCOME: 'LEARNING_OUTCOME',
  OVERDUE: 'LEARNING_OVERDUE',
  LATE_REVIEW: 'LEARNING_LATE_REVIEW',
  CERTIFICATE: 'LEARNING_CERTIFICATE',
} as const;
type LearningTaskType = (typeof LEARNING_TASK)[keyof typeof LEARNING_TASK];

export const LEARNING_TASK_TYPES: string[] = Object.values(LEARNING_TASK);

const OPEN_TASK: RoleTaskStatus[] = [RoleTaskStatus.OPEN, RoleTaskStatus.IN_PROGRESS];
const OFFICE_REVIEW_KINDS: LearningAssignmentReviewKind[] = [
  LearningAssignmentReviewKind.REASON,
  LearningAssignmentReviewKind.EXTENDED,
  LearningAssignmentReviewKind.NOT_COMPLETED,
];
const CLOSED_ASSIGNMENT: LearningAssignmentStatus[] = [
  LearningAssignmentStatus.CANCELLED,
  LearningAssignmentStatus.EXEMPT,
];

type Wanted = { title: string; description: string | null; dueDate: Date; link: string };

function dayOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

@Injectable()
export class LearningTasksService {
  private readonly logger = new Logger(LearningTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: LearningSettingsService,
  ) {}

  /**
   * Run a change, then bring this assignment's tasks (and the certificate tasks for the same
   * carer and course) up to date. Used by the controllers so it runs after the change commits.
   */
  async after<T>(assignmentId: string, change: Promise<T>): Promise<T> {
    const result = await change;
    await this.syncAssignment(assignmentId);
    const a = await this.prisma.learningAssignment
      .findUnique({ where: { id: assignmentId }, select: { employeeId: true, courseId: true } })
      .catch(() => null);
    if (a?.employeeId) await this.syncCertificatesFor(a.employeeId, a.courseId);
    return result;
  }

  /** Outcome, overdue and late-review tasks for one assignment. Never throws. */
  async syncAssignment(assignmentId: string): Promise<void> {
    try {
      const a = await this.prisma.learningAssignment.findUnique({
        where: { id: assignmentId },
        include: {
          course: { select: { title: true } },
          reviews: { orderBy: { createdAt: 'desc' }, select: { kind: true, createdAt: true, note: true } },
        },
      });
      if (!a) return;
      const closed = CLOSED_ASSIGNMENT.includes(a.status) || !a.employeeId;
      const name = a.employeeId ? await this.employeeName(a.employeeId) : 'A carer';
      const course = a.course.title;
      const link = `/learning/assignments?open=${a.id}`;
      const today = dayOnly(new Date());

      const outcome: Wanted | null =
        !closed && a.status === LearningAssignmentStatus.AWAITING_APPROVAL
          ? {
              title: `Record the outcome: ${name}, ${course}`,
              description: 'The carer has done their part. Record Passed / Not passed or the practical sign-off.',
              dueDate: today,
              link,
            }
          : null;

      const overdue: Wanted | null =
        !closed && a.status === LearningAssignmentStatus.OVERDUE
          ? {
              title: `Overdue training: ${name}, ${course}`,
              description: 'Extend the due date, take action or mark it as incomplete.',
              dueDate: a.dueAt ? dayOnly(a.dueAt) : today,
              link,
            }
          : null;

      // Late review: the carer gave a reason, or it was finished late, and the office has not
      // reviewed it since.
      const lastOffice = a.reviews.find((r) => OFFICE_REVIEW_KINDS.includes(r.kind));
      const carerReason = a.reviews.find((r) => r.kind === LearningAssignmentReviewKind.CARER_LATE_REASON);
      const reasonOpen = !!carerReason && (!lastOffice || lastOffice.createdAt < carerReason.createdAt);
      const lateOpen =
        a.completedLate && !!a.completedAt && (!lastOffice || lastOffice.createdAt < a.completedAt);
      const lateReview: Wanted | null =
        !closed && !overdue && (reasonOpen || lateOpen)
          ? {
              title: `Review late training: ${name}, ${course}`,
              description: reasonOpen && carerReason?.note ? `Carer's reason: ${carerReason.note}` : 'Finished after the due date.',
              dueDate: today,
              link,
            }
          : null;

      const cancelled = a.status === LearningAssignmentStatus.CANCELLED;
      const ctx = { employeeId: a.employeeId, cancelled };
      await this.apply(LEARNING_TASK.OUTCOME, a.id, outcome, ctx);
      await this.apply(LEARNING_TASK.OVERDUE, a.id, overdue, ctx);
      await this.apply(LEARNING_TASK.LATE_REVIEW, a.id, lateReview, ctx);
    } catch (e) {
      this.logger.warn(`Learning tasks not synced for assignment ${assignmentId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Certificate expiring (inside the warning window) or expired, until the carer has a newer
   * certificate for the same course. Never throws.
   */
  async syncCertificate(certificateId: string): Promise<void> {
    try {
      const c = await this.prisma.learningCertificate.findUnique({
        where: { id: certificateId },
        include: { course: { select: { title: true } } },
      });
      if (!c) return;
      const settings = await this.settings.getOrCreate();
      const horizon = Date.now() + settings.defaultExpiryWarningDays * 86_400_000;
      const newer = await this.prisma.learningCertificate.findFirst({
        where: {
          id: { not: c.id },
          employeeId: c.employeeId,
          courseId: c.courseId,
          issuedAt: { gt: c.issuedAt },
          status: LearningCertificateStatus.ACTIVE,
        },
        select: { id: true },
      });
      const inWindow =
        !!c.expiresAt &&
        c.expiresAt.getTime() <= horizon &&
        (c.status === LearningCertificateStatus.ACTIVE || c.status === LearningCertificateStatus.EXPIRED);
      let wanted: Wanted | null = null;
      if (inWindow && !newer) {
        const name = await this.employeeName(c.employeeId);
        const expired = c.status === LearningCertificateStatus.EXPIRED || c.expiresAt!.getTime() < Date.now();
        wanted = {
          title: `${expired ? 'Certificate expired' : 'Certificate expiring'}: ${name}, ${c.course.title}`,
          description: `Certificate ${c.certificateNumber}. Make sure the carer does the refresher.`,
          dueDate: dayOnly(c.expiresAt!),
          link: `/learning/certificates`,
        };
      }
      await this.apply(LEARNING_TASK.CERTIFICATE, c.id, wanted, {
        employeeId: c.employeeId,
        cancelled: c.status === LearningCertificateStatus.REVOKED,
      });
    } catch (e) {
      this.logger.warn(`Learning task not synced for certificate ${certificateId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** A new certificate: close the tasks of older certificates for the same carer and course. */
  async syncCertificatesFor(employeeId: string, courseId: string): Promise<void> {
    const older = await this.prisma.learningCertificate.findMany({
      where: { employeeId, courseId },
      select: { id: true },
    });
    for (const c of older) await this.syncCertificate(c.id);
  }

  /** After attendance is marked: sync the attendee's assignment. */
  async syncAttendee(attendeeId: string): Promise<void> {
    const at = await this.prisma.learningTrainingEventAttendee
      .findUnique({ where: { id: attendeeId }, select: { assignmentId: true } })
      .catch(() => null);
    if (at?.assignmentId) await this.syncAssignment(at.assignmentId);
  }

  /** Nightly safety net: everything that should have a task, and every open Learning task. */
  async reconcileAll(): Promise<{ assignments: number; certificates: number }> {
    const settings = await this.settings.getOrCreate();
    const horizon = new Date(Date.now() + settings.defaultExpiryWarningDays * 86_400_000);
    const [open, candidates, certs] = await Promise.all([
      this.prisma.roleTask.findMany({
        where: { sourceType: { in: LEARNING_TASK_TYPES }, status: { in: OPEN_TASK } },
        select: { sourceType: true, sourceId: true },
      }),
      this.prisma.learningAssignment.findMany({
        where: {
          OR: [
            { status: { in: [LearningAssignmentStatus.AWAITING_APPROVAL, LearningAssignmentStatus.OVERDUE] } },
            { reviews: { some: { kind: LearningAssignmentReviewKind.CARER_LATE_REASON } } },
            { completedLate: true },
          ],
        },
        select: { id: true },
      }),
      this.prisma.learningCertificate.findMany({
        where: {
          status: { in: [LearningCertificateStatus.ACTIVE, LearningCertificateStatus.EXPIRED] },
          expiresAt: { lte: horizon },
        },
        select: { id: true },
      }),
    ]);
    const assignmentIds = new Set(candidates.map((c) => c.id));
    const certificateIds = new Set(certs.map((c) => c.id));
    for (const t of open) {
      if (!t.sourceId) continue;
      if (t.sourceType === LEARNING_TASK.CERTIFICATE) certificateIds.add(t.sourceId);
      else assignmentIds.add(t.sourceId);
    }
    for (const id of assignmentIds) await this.syncAssignment(id);
    for (const id of certificateIds) await this.syncCertificate(id);
    return { assignments: assignmentIds.size, certificates: certificateIds.size };
  }

  /** Open the task when wanted (once), keep its text current, close it when not wanted. */
  private async apply(
    type: LearningTaskType,
    sourceId: string,
    wanted: Wanted | null,
    ctx: { employeeId: string | null; cancelled: boolean },
  ) {
    const existing = await this.prisma.roleTask.findFirst({
      where: { sourceType: type, sourceId, status: { in: OPEN_TASK } },
      select: { id: true, title: true, description: true, dueDate: true, roleId: true },
    });
    if (!wanted) {
      if (existing) {
        await this.prisma.roleTask.update({
          where: { id: existing.id },
          data: ctx.cancelled
            ? { status: RoleTaskStatus.CANCELLED }
            : { status: RoleTaskStatus.DONE, completedAt: new Date(), note: 'Done in Learning' },
        });
      }
      return;
    }
    const roleId = await this.taskRoleId();
    if (existing) {
      // Text, due date and role kept current (the role follows Learning settings).
      if (
        existing.title !== wanted.title ||
        existing.description !== wanted.description ||
        existing.dueDate.getTime() !== wanted.dueDate.getTime() ||
        (roleId && existing.roleId !== roleId)
      ) {
        await this.prisma.roleTask.update({
          where: { id: existing.id },
          data: {
            title: wanted.title,
            description: wanted.description,
            dueDate: wanted.dueDate,
            ...(roleId ? { roleId } : {}),
          },
        });
      }
      return;
    }
    if (!roleId) return;
    await this.prisma.roleTask.create({
      data: {
        sourceType: type,
        sourceId,
        roleId,
        locationId: ctx.employeeId ? await this.branchOf(ctx.employeeId) : null,
        title: wanted.title,
        description: wanted.description,
        link: wanted.link,
        dueDate: wanted.dueDate,
      },
    });
  }

  /** Learning settings role, else the Admin role, else the first role that manages training. */
  async taskRoleId(): Promise<string | null> {
    const settings = await this.settings.getOrCreate();
    if (settings.taskRoleId) {
      const role = await this.prisma.role.findFirst({
        where: { id: settings.taskRoleId, deletedAt: null },
        select: { id: true },
      });
      if (role) return role.id;
    }
    const admin = await this.prisma.role.findFirst({
      where: { name: { equals: 'Admin', mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });
    if (admin) return admin.id;
    const manager = await this.prisma.rolePermission.findFirst({
      where: { permission: { key: 'learning.assignments.manage' }, role: { deletedAt: null } },
      select: { roleId: true },
    });
    return manager?.roleId ?? null;
  }

  private async branchOf(employeeId: string): Promise<string | null> {
    const job = await this.prisma.employeeEmployment.findFirst({
      where: { employeeId, isActive: true },
      select: { locationId: true, baseLocationId: true },
    });
    return job?.locationId ?? job?.baseLocationId ?? null;
  }

  private async employeeName(employeeId: string): Promise<string> {
    const p = await this.prisma.employeePersonalDetail.findFirst({
      where: { employeeId },
      select: { firstName: true, lastName: true },
    });
    return `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim() || 'A carer';
  }
}
