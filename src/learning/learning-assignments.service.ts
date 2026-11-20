import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LearningAssessmentResult,
  LearningAssignmentReviewKind,
  LearningAssignmentStatus,
  LearningAssignmentType,
  LearningCourseStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import {
  BulkLearningAssignmentDto,
  CancelAssignmentDto,
  CreateLearningAssignmentDto,
  ExemptAssignmentDto,
  ExtendDueDateDto,
  LearningAssignmentListQueryDto,
  LearningListQueryDto,
  ReassignAssignmentDto,
  UpdateAssignmentDto,
} from './dto/learning.dto';
import { LearningNotificationHook } from './learning-notification.hook';
import { LearningSettingsService } from './learning-settings.service';
import { LearningPushService } from './learning-push.service';
import { LearningComplianceService } from './learning-compliance.service';

/** Status tabs on the admin Assignments page (16 Nov 2026). */
export const ASSIGNMENT_STATUS_GROUPS: Record<
  | 'OPEN'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'OVERDUE'
  | 'COMPLETED'
  | 'NOT_COMPLETED'
  | 'NOT_PASSED'
  | 'INCOMPLETE'
  | 'CANCELLED',
  LearningAssignmentStatus[]
> = {
  // Tabs (16 Nov 2026): All, Open, Completed, Not completed, Cancelled. ASSIGNED / IN_PROGRESS /
  // OVERDUE are quick filters inside Open.
  OPEN: [
    LearningAssignmentStatus.ASSIGNED,
    LearningAssignmentStatus.NOT_STARTED,
    LearningAssignmentStatus.IN_PROGRESS,
    LearningAssignmentStatus.AWAITING_ASSESSMENT,
    LearningAssignmentStatus.AWAITING_APPROVAL,
    LearningAssignmentStatus.OVERDUE,
  ],
  ASSIGNED: [LearningAssignmentStatus.ASSIGNED, LearningAssignmentStatus.NOT_STARTED],
  IN_PROGRESS: [
    LearningAssignmentStatus.IN_PROGRESS,
    LearningAssignmentStatus.AWAITING_ASSESSMENT,
    LearningAssignmentStatus.AWAITING_APPROVAL,
  ],
  OVERDUE: [LearningAssignmentStatus.OVERDUE],
  COMPLETED: [LearningAssignmentStatus.COMPLETED, LearningAssignmentStatus.PASSED],
  NOT_COMPLETED: [LearningAssignmentStatus.EXPIRED, LearningAssignmentStatus.FAILED],
  // Separate result tabs (17 Nov 2026): Not passed = failed quiz / trainer outcome; Incomplete = closed by the office.
  NOT_PASSED: [LearningAssignmentStatus.FAILED],
  INCOMPLETE: [LearningAssignmentStatus.EXPIRED],
  CANCELLED: [LearningAssignmentStatus.CANCELLED, LearningAssignmentStatus.EXEMPT],
};

const CLOSED_RESULT_STATUSES: LearningAssignmentStatus[] = [
  ...ASSIGNMENT_STATUS_GROUPS.COMPLETED,
  ...ASSIGNMENT_STATUS_GROUPS.NOT_COMPLETED,
];

/** Statuses the office can edit or unassign (18 Nov 2026). */
const EDITABLE_STATUSES: LearningAssignmentStatus[] = [
  LearningAssignmentStatus.ASSIGNED,
  LearningAssignmentStatus.NOT_STARTED,
  LearningAssignmentStatus.IN_PROGRESS,
];

const ACTIVE_STATUSES: LearningAssignmentStatus[] = [
  LearningAssignmentStatus.ASSIGNED,
  LearningAssignmentStatus.NOT_STARTED,
  LearningAssignmentStatus.IN_PROGRESS,
  LearningAssignmentStatus.AWAITING_ASSESSMENT,
  LearningAssignmentStatus.AWAITING_APPROVAL,
  LearningAssignmentStatus.OVERDUE,
];

/** Carers are people whose job role name contains "carer" (Carer, Senior Carer). Agreed 13 Nov 2026. */
const CARER_ROLE_FILTER = {
  name: { contains: 'carer', mode: 'insensitive' as const },
};

@Injectable()
export class LearningAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly settings: LearningSettingsService,
    private readonly notifications: LearningNotificationHook,
    private readonly compliance: LearningComplianceService,
    private readonly push: LearningPushService,
  ) {}

  private mapAssignment(
    row: Prisma.LearningAssignmentGetPayload<object>,
    extras?: { employeeName?: string | null; courseTitle?: string | null; courseCode?: string | null },
  ) {
    return {
      id: row.id,
      assignmentType: row.assignmentType,
      courseId: row.courseId,
      courseTitle: extras?.courseTitle ?? null,
      courseCode: extras?.courseCode ?? null,
      courseVersionId: row.courseVersionId,
      pathwayId: row.pathwayId,
      employeeId: row.employeeId,
      employeeName: extras?.employeeName ?? null,
      locationId: row.locationId,
      workAreaId: row.workAreaId,
      roleId: row.roleId,
      assignedAt: row.assignedAt.toISOString(),
      availableFrom: row.availableFrom?.toISOString() ?? null,
      dueAt: row.dueAt?.toISOString() ?? null,
      priority: row.priority,
      isMandatory: row.isMandatory,
      assignmentReason: row.assignmentReason,
      sourceEntityType: row.sourceEntityType,
      sourceEntityId: row.sourceEntityId,
      status: row.status,
      completedAt: row.completedAt?.toISOString() ?? null,
      completedLate: row.completedLate,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      exemptAt: row.exemptAt?.toISOString() ?? null,
    };
  }

  async validateActiveEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null, isActive: true },
    });
    if (!employee) throw new NotFoundException('Employee not found or inactive');
    return employee;
  }

  private async resolveCourseVersionId(courseId: string, courseVersionId?: string | null) {
    // The course must be open for new assignments, even when a version is named explicitly.
    const course = await this.prisma.learningCourse.findFirst({
      where: { id: courseId, deletedAt: null },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.status === LearningCourseStatus.WITHDRAWN) {
      throw new BadRequestException(
        'This course is withdrawn and cannot be assigned',
      );
    }
    if (course.status !== LearningCourseStatus.PUBLISHED || !course.currentVersionId) {
      throw new BadRequestException('Course has no published version');
    }
    if (courseVersionId && courseVersionId !== course.currentVersionId) {
      const version = await this.prisma.learningCourseVersion.findFirst({
        where: {
          id: courseVersionId,
          courseId,
          status: LearningCourseStatus.PUBLISHED,
        },
        select: { id: true },
      });
      if (!version)
        throw new BadRequestException(
          'That course version is not published for this course',
        );
    }
    return courseVersionId ?? course.currentVersionId;
  }

  private async hasActiveAssignment(employeeId: string, courseId: string) {
    return this.prisma.learningAssignment.findFirst({
      where: {
        employeeId,
        courseId,
        status: { in: ACTIVE_STATUSES },
      },
    });
  }

  private async createAssignmentForEmployee(params: {
    employeeId: string;
    courseId: string;
    courseVersionId: string;
    assignedById: string;
    assignmentType: LearningAssignmentType;
    dueAt?: Date | null;
    isMandatory?: boolean;
    assignmentReason?: string | null;
    pathwayId?: string | null;
    parentAssignmentId?: string | null;
    refresherOfAssignmentId?: string | null;
    sourceEntityType?: string | null;
    sourceEntityId?: string | null;
    allowInactiveEmployee?: boolean;
  }) {
    if (params.allowInactiveEmployee) {
      const employee = await this.prisma.employee.findFirst({
        where: { id: params.employeeId, deletedAt: null },
      });
      if (!employee) throw new NotFoundException('Employee not found');
    } else {
      await this.validateActiveEmployee(params.employeeId);
    }
    const duplicate = await this.hasActiveAssignment(params.employeeId, params.courseId);
    if (duplicate) return { skipped: true as const, reason: 'duplicate_active_assignment' as const };

    const assignment = await this.prisma.$transaction(async (tx) => {
      const row = await tx.learningAssignment.create({
        data: {
          assignmentType: params.assignmentType,
          courseId: params.courseId,
          courseVersionId: params.courseVersionId,
          employeeId: params.employeeId,
          pathwayId: params.pathwayId,
          parentAssignmentId: params.parentAssignmentId,
          refresherOfAssignmentId: params.refresherOfAssignmentId,
          sourceEntityType: params.sourceEntityType ?? null,
          sourceEntityId: params.sourceEntityId ?? null,
          assignedById: params.assignedById,
          dueAt: params.dueAt,
          isMandatory: params.isMandatory ?? true,
          assignmentReason: params.assignmentReason,
          status: LearningAssignmentStatus.ASSIGNED,
        },
      });

      await tx.learningEmployeeProgress.create({
        data: {
          assignmentId: row.id,
          employeeId: params.employeeId,
          courseVersionId: params.courseVersionId,
        },
      });

      return row;
    });

    await this.compliance.recalculateForAssignment(assignment.id);
    return { skipped: false as const, assignment };
  }

  private async employeeIdsForLocation(locationId: string): Promise<string[]> {
    const rows = await this.prisma.employeeEmployment.findMany({
      where: {
        OR: [
          { locationId },
          { baseLocationId: locationId },
          { floorLocations: { some: { locationId } } },
        ],
      },
      select: { employeeId: true },
    });
    return [...new Set(rows.map((r) => r.employeeId))];
  }

  /** Base filter for the list and its tab counts (location + search). */
  private async listWhere(
    query: LearningListQueryDto,
  ): Promise<Prisma.LearningAssignmentWhereInput> {
    const and: Prisma.LearningAssignmentWhereInput[] = [{ employeeId: { not: null } }];
    if (query.source === 'INCIDENT') and.push({ sourceEntityType: 'Incident' });
    if (query.employeeId) and.push({ employeeId: query.employeeId });
    if (query.courseId) and.push({ courseId: query.courseId });
    if (query.locationId) {
      and.push({
        OR: [
          { locationId: query.locationId },
          { employeeId: { in: await this.employeeIdsForLocation(query.locationId) } },
        ],
      });
    }
    // Search by course title / code or carer name (the box was not used before, 16 Nov 2026).
    const term = query.search?.trim();
    if (term) {
      const people = await this.prisma.employeePersonalDetail.findMany({
        where: {
          OR: [
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
          ],
        },
        select: { employeeId: true },
        take: 500,
      });
      and.push({
        OR: [
          { course: { title: { contains: term, mode: 'insensitive' } } },
          { course: { code: { contains: term, mode: 'insensitive' } } },
          { employeeId: { in: people.map((p) => p.employeeId) } },
        ],
      });
    }
    return { AND: and };
  }

  /** Counts per status tab, with the same location / search filter as the list. */
  async statusCounts(query: LearningListQueryDto) {
    const base = await this.listWhere(query);
    const grouped = await this.prisma.learningAssignment.groupBy({
      by: ['status'],
      where: base,
      _count: { _all: true },
    });
    const counts: Record<string, number> = { ALL: 0 };
    for (const key of Object.keys(ASSIGNMENT_STATUS_GROUPS)) counts[key] = 0;
    for (const g of grouped) {
      counts.ALL += g._count._all;
      for (const [key, statuses] of Object.entries(ASSIGNMENT_STATUS_GROUPS)) {
        if (statuses.includes(g.status)) counts[key] += g._count._all;
      }
    }
    return counts;
  }

  async list(query: LearningAssignmentListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const base = await this.listWhere(query);
    const where: Prisma.LearningAssignmentWhereInput = query.statusGroup
      ? { AND: [base, { status: { in: ASSIGNMENT_STATUS_GROUPS[query.statusGroup] } }] }
      : base;

    const [rows, total] = await Promise.all([
      this.prisma.learningAssignment.findMany({
        where,
        include: {
          course: { select: { title: true, code: true, deliveryMethod: true } },
        },
        orderBy: { assignedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.learningAssignment.count({ where }),
    ]);

    const employeeIds = [...new Set(rows.map((r) => r.employeeId).filter(Boolean))] as string[];
    const employees = employeeIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: employeeIds } },
          include: { personalDetail: { select: { firstName: true, lastName: true } } },
        })
      : [];
    const employeeNameById = new Map(
      employees.map((e) => [
        e.id,
        [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' ').trim() ||
          e.id,
      ]),
    );

    const results = await this.closedResults(rows);
    const locks = await this.courseCarerLocks(rows);

    return {
      data: rows.map((r) => ({
        ...this.mapAssignment(r, {
          employeeName: r.employeeId ? employeeNameById.get(r.employeeId) ?? null : null,
          courseTitle: r.course?.title ?? null,
          courseCode: r.course?.code ?? null,
        }),
        deliveryMethod: r.course?.deliveryMethod ?? null,
        result: results.get(r.id) ?? null,
        courseCarerLock: locks.get(r.id) ?? null,
      })),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  /**
   * Pass / fail for finished rows (Completed and Not completed tabs, 16 Nov 2026):
   * manager outcome for face to face / workplace, else the final quiz, else plain completion.
   */
  private async closedResults(rows: { id: string; status: LearningAssignmentStatus }[]) {
    const out = new Map<
      string,
      {
        result: 'PASSED' | 'NOT_PASSED' | 'EXPIRED';
        by: 'MANAGER' | 'MANAGER_QUIZ' | 'QUIZ' | null;
        score: number | null;
      }
    >();
    const closed = rows.filter((r) => CLOSED_RESULT_STATUSES.includes(r.status));
    if (!closed.length) return out;
    const ids = closed.map((r) => r.id);
    const [outcomes, attempts] = await Promise.all([
      this.prisma.learningAssignmentReview.findMany({
        where: {
          assignmentId: { in: ids },
          kind: {
            in: [
              LearningAssignmentReviewKind.OUTCOME_PASSED,
              LearningAssignmentReviewKind.OUTCOME_PASSED_AFTER_QUIZ,
              LearningAssignmentReviewKind.OUTCOME_NOT_PASSED,
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        select: { assignmentId: true, kind: true },
      }),
      this.prisma.learningAssessmentAttempt.findMany({
        where: { assignmentId: { in: ids }, submittedAt: { not: null }, assessment: { sectionId: null } },
        select: { assignmentId: true, percentage: true, result: true },
      }),
    ]);
    const outcomeOf = new Map<string, LearningAssignmentReviewKind>();
    for (const o of outcomes) if (!outcomeOf.has(o.assignmentId)) outcomeOf.set(o.assignmentId, o.kind);
    const bestScore = new Map<string, number>();
    const passedQuiz = new Set<string>();
    for (const a of attempts) {
      const pct = a.percentage == null ? null : Math.round(Number(a.percentage));
      if (pct != null && pct > (bestScore.get(a.assignmentId) ?? -1)) bestScore.set(a.assignmentId, pct);
      if (a.result === LearningAssessmentResult.PASSED) passedQuiz.add(a.assignmentId);
    }
    for (const r of closed) {
      const outcome = outcomeOf.get(r.id);
      const score = bestScore.get(r.id) ?? null;
      if (r.status === LearningAssignmentStatus.EXPIRED) {
        out.set(r.id, { result: 'EXPIRED', by: null, score: null });
      } else if (r.status === LearningAssignmentStatus.FAILED) {
        out.set(r.id, outcome === LearningAssignmentReviewKind.OUTCOME_NOT_PASSED
          ? { result: 'NOT_PASSED', by: 'MANAGER', score: null }
          : { result: 'NOT_PASSED', by: 'QUIZ', score });
      } else if (outcome === LearningAssignmentReviewKind.OUTCOME_PASSED_AFTER_QUIZ) {
        out.set(r.id, { result: 'PASSED', by: 'MANAGER_QUIZ', score });
      } else if (outcome === LearningAssignmentReviewKind.OUTCOME_PASSED) {
        out.set(r.id, { result: 'PASSED', by: 'MANAGER', score: null });
      } else {
        out.set(r.id, { result: 'PASSED', by: passedQuiz.has(r.id) ? 'QUIZ' : null, score: passedQuiz.has(r.id) ? score : null });
      }
    }
    return out;
  }

  async getById(id: string) {
    const row = await this.prisma.learningAssignment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Assignment not found');
    return this.mapAssignment(row);
  }

  async create(userId: string, dto: CreateLearningAssignmentDto, meta?: RequestAuditMeta) {
    if (!dto.employeeId) throw new BadRequestException('employeeId is required for individual assignment');
    const versionId = await this.resolveCourseVersionId(dto.courseId, dto.courseVersionId);
    const settings = await this.settings.getOrCreate();
    const dueAt = dto.dueAt
      ? new Date(dto.dueAt)
      : new Date(Date.now() + settings.defaultAssignmentDueDays * 86_400_000);

    const result = await this.createAssignmentForEmployee({
      employeeId: dto.employeeId,
      courseId: dto.courseId,
      courseVersionId: versionId,
      assignedById: userId,
      assignmentType: dto.assignmentType,
      dueAt,
      isMandatory: dto.isMandatory,
      assignmentReason: dto.assignmentReason,
      pathwayId: dto.pathwayId,
    });

    if (result.skipped) {
      throw new BadRequestException('Employee already has an active assignment for this course');
    }

    const course = await this.prisma.learningCourse.findUnique({ where: { id: dto.courseId } });
    await this.notifications.notifyAssignmentCreated({
      employeeIds: [dto.employeeId],
      assignmentId: result.assignment.id,
      courseTitle: course?.title ?? 'Course',
      dueAt,
    });
    await this.push.assigned(
      [{ employeeId: dto.employeeId, assignmentId: result.assignment.id }],
      course?.title ?? 'Course',
      dueAt,
    );

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_assignment_created',
      recordType: 'LearningAssignment',
      recordId: result.assignment.id,
      newValues: this.mapAssignment(result.assignment),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapAssignment(result.assignment);
  }

  /**
   * Create an individual assignment linked to an external source (e.g. incident).
   * Allows inactive employees so courses can be recommended after carer suspension.
   */
  async createFromSource(
    userId: string,
    params: {
      employeeId: string;
      courseId: string;
      dueAt?: string | null;
      isMandatory?: boolean;
      assignmentReason?: string | null;
      sourceEntityType: string;
      sourceEntityId: string;
      allowInactiveEmployee?: boolean;
    },
    meta?: RequestAuditMeta,
  ) {
    const versionId = await this.resolveCourseVersionId(params.courseId);
    const settings = await this.settings.getOrCreate();
    const dueAt = params.dueAt
      ? new Date(params.dueAt)
      : new Date(Date.now() + settings.defaultAssignmentDueDays * 86_400_000);

    const result = await this.createAssignmentForEmployee({
      employeeId: params.employeeId,
      courseId: params.courseId,
      courseVersionId: versionId,
      assignedById: userId,
      assignmentType: LearningAssignmentType.INDIVIDUAL,
      dueAt,
      isMandatory: params.isMandatory ?? true,
      assignmentReason: params.assignmentReason,
      sourceEntityType: params.sourceEntityType,
      sourceEntityId: params.sourceEntityId,
      allowInactiveEmployee: params.allowInactiveEmployee ?? true,
    });

    if (result.skipped) {
      throw new BadRequestException(
        'Employee already has an active assignment for this course',
      );
    }

    const course = await this.prisma.learningCourse.findUnique({
      where: { id: params.courseId },
    });
    await this.notifications.notifyAssignmentCreated({
      employeeIds: [params.employeeId],
      assignmentId: result.assignment.id,
      courseTitle: course?.title ?? 'Course',
      dueAt,
    });
    await this.push.assigned(
      [{ employeeId: params.employeeId, assignmentId: result.assignment.id }],
      course?.title ?? 'Course',
      dueAt,
    );

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_assignment_created',
      recordType: 'LearningAssignment',
      recordId: result.assignment.id,
      newValues: this.mapAssignment(result.assignment),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapAssignment(result.assignment);
  }

  async bulkCreate(userId: string, dto: BulkLearningAssignmentDto, meta?: RequestAuditMeta) {
    const versionId = await this.resolveCourseVersionId(dto.courseId, dto.courseVersionId);
    const settings = await this.settings.getOrCreate();
    const dueAt = dto.dueAt
      ? new Date(dto.dueAt)
      : new Date(Date.now() + settings.defaultAssignmentDueDays * 86_400_000);

    const employeeIdSet = new Set<string>(dto.employeeIds ?? []);

    if (dto.roleIds?.length) {
      const rows = await this.prisma.employeeEmployment.findMany({
        where: {
          roleId: { in: dto.roleIds },
          isActive: true,
          employee: { deletedAt: null, isActive: true },
          // For now training is assigned to carers only (agreed 13 Nov 2026).
          role: CARER_ROLE_FILTER,
        },
        select: { employeeId: true },
      });
      rows.forEach((r) => employeeIdSet.add(r.employeeId));
    }

    if (dto.locationIds?.length) {
      const rows = await this.prisma.employeeEmployment.findMany({
        where: {
          OR: [
            { locationId: { in: dto.locationIds } },
            { baseLocationId: { in: dto.locationIds } },
          ],
          isActive: true,
          employee: { deletedAt: null, isActive: true },
          // For now training is assigned to carers only (agreed 13 Nov 2026).
          role: CARER_ROLE_FILTER,
        },
        select: { employeeId: true },
      });
      rows.forEach((r) => employeeIdSet.add(r.employeeId));
    }

    if (dto.workAreaIds?.length) {
      const rows = await this.prisma.employeeEmployment.findMany({
        where: {
          workAreaId: { in: dto.workAreaIds },
          isActive: true,
          employee: { deletedAt: null, isActive: true },
          // For now training is assigned to carers only (agreed 13 Nov 2026).
          role: CARER_ROLE_FILTER,
        },
        select: { employeeId: true },
      });
      rows.forEach((r) => employeeIdSet.add(r.employeeId));
    }

    // Individually chosen people must be carers too.
    if (dto.employeeIds?.length) {
      const carers = await this.prisma.employeeEmployment.findMany({
        where: { employeeId: { in: dto.employeeIds }, role: CARER_ROLE_FILTER },
        select: { employeeId: true },
      });
      const carerIds = new Set(carers.map((c) => c.employeeId));
      for (const id of dto.employeeIds) {
        if (!carerIds.has(id)) employeeIdSet.delete(id);
      }
    }

    if (employeeIdSet.size === 0) {
      throw new BadRequestException(
        'No carers matched the selected people, roles, locations or work areas. Training can only be assigned to carers for now.',
      );
    }

    const parent = await this.prisma.learningAssignment.create({
      data: {
        assignmentType: LearningAssignmentType.BULK,
        courseId: dto.courseId,
        courseVersionId: versionId,
        assignedById: userId,
        dueAt,
        assignmentReason: dto.assignmentReason,
        status: LearningAssignmentStatus.ASSIGNED,
      },
    });

    const created: string[] = [];
    const skipped: Array<{ employeeId: string; reason: string }> = [];

    // A carer's own due date wins over the one for everyone (13 Nov 2026).
    const ownDueAt = new Map(
      (dto.employeeDueDates ?? []).map((d) => [d.employeeId, new Date(d.dueAt)]),
    );

    for (const employeeId of employeeIdSet) {
      const result = await this.createAssignmentForEmployee({
        employeeId,
        courseId: dto.courseId,
        courseVersionId: versionId,
        assignedById: userId,
        assignmentType: LearningAssignmentType.BULK,
        dueAt: ownDueAt.get(employeeId) ?? dueAt,
        assignmentReason: dto.assignmentReason,
        parentAssignmentId: parent.id,
      });

      if (result.skipped) {
        skipped.push({ employeeId, reason: result.reason });
      } else {
        created.push(result.assignment.id);
      }
    }

    const course = await this.prisma.learningCourse.findUnique({ where: { id: dto.courseId } });
    if (created.length) {
      const assignments = await this.prisma.learningAssignment.findMany({
        where: { id: { in: created } },
        select: { id: true, employeeId: true, dueAt: true },
      });
      // In-app notice per due date, so each carer is told their own date.
      const byDue = new Map<string, string[]>();
      for (const a of assignments) {
        if (!a.employeeId) continue;
        const key = a.dueAt?.toISOString() ?? '';
        byDue.set(key, [...(byDue.get(key) ?? []), a.employeeId]);
      }
      for (const [key, employeeIds] of byDue) {
        await this.notifications.notifyAssignmentCreated({
          employeeIds,
          assignmentId: parent.id,
          courseTitle: course?.title ?? 'Course',
          dueAt: key ? new Date(key) : null,
        });
      }
      // Phone push per carer, each opening their own assignment with their own due date.
      await this.push.assigned(
        assignments.map((a) => ({
          employeeId: a.employeeId,
          assignmentId: a.id,
          dueAt: a.dueAt,
        })),
        course?.title ?? 'Course',
        dueAt,
      );
    }

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_assignment_bulk_created',
      recordType: 'LearningAssignment',
      recordId: parent.id,
      newValues: { created: created.length, skipped: skipped.length },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { parentAssignmentId: parent.id, createdCount: created.length, skipped };
  }

  async cancel(id: string, userId: string, dto: CancelAssignmentDto, meta?: RequestAuditMeta) {
    const existing = await this.getById(id);
    const row = await this.prisma.learningAssignment.update({
      where: { id },
      data: {
        status: LearningAssignmentStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledById: userId,
        cancellationReason: dto.cancellationReason,
      },
    });

    await this.compliance.recalculateForAssignment(id);
    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_assignment_cancelled',
      recordType: 'LearningAssignment',
      recordId: id,
      oldValues: existing,
      newValues: this.mapAssignment(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapAssignment(row);
  }

  /**
   * Office edit of an open course before its due date (18 Nov 2026, user decision):
   * due date any time; course and carer only while the carer has not started it.
   */
  async update(id: string, userId: string, dto: UpdateAssignmentDto, meta?: RequestAuditMeta) {
    const row = await this.prisma.learningAssignment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Assignment not found');
    this.assertEditable(row);

    const courseChanged = !!dto.courseId && dto.courseId !== row.courseId;
    const carerChanged = !!dto.employeeId && dto.employeeId !== row.employeeId;
    const newDueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    const dueChanged = !!newDueAt && newDueAt.getTime() !== row.dueAt?.getTime();
    if (!courseChanged && !carerChanged && !dueChanged) return this.mapAssignment(row);

    if (newDueAt && dueChanged && newDueAt.getTime() <= Date.now()) {
      throw new BadRequestException('The due date must be in the future');
    }

    const courseId = dto.courseId ?? row.courseId;
    const employeeId = dto.employeeId ?? row.employeeId;
    let courseVersionId = row.courseVersionId;
    if (courseChanged || carerChanged) {
      if (await this.hasStarted(row.id, row.status)) {
        throw new BadRequestException(
          'The carer has started this course. Only the due date can be changed. To give a different course or carer, unassign it and assign again.',
        );
      }
      const booked = await this.prisma.learningTrainingEventAttendee.count({
        where: { assignmentId: row.id, bookingStatus: { not: 'CANCELLED' } },
      });
      if (booked) {
        throw new BadRequestException(
          'This course is booked on a session. Only the due date can be changed. To give a different course or carer, unassign it and assign again.',
        );
      }
      if (!employeeId) throw new BadRequestException('Choose a carer');
      if (carerChanged) await this.validateActiveEmployee(employeeId);
      if (courseChanged) courseVersionId = await this.resolveCourseVersionId(courseId);
      const duplicate = await this.prisma.learningAssignment.findFirst({
        where: { employeeId, courseId, status: { in: ACTIVE_STATUSES }, id: { not: row.id } },
        select: { id: true },
      });
      if (duplicate) throw new BadRequestException('This carer already has this course');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.learningAssignment.update({
        where: { id },
        data: {
          courseId,
          courseVersionId,
          employeeId,
          ...(dueChanged ? { dueAt: newDueAt } : {}),
        },
      });
      if (courseChanged || carerChanged) {
        await tx.learningEmployeeProgress.updateMany({
          where: { assignmentId: id },
          data: {
            employeeId: employeeId!,
            ...(courseVersionId ? { courseVersionId } : {}),
          },
        });
        // The compliance row for the old carer/course came only from this assignment.
        await tx.learningComplianceSnapshot.deleteMany({
          where: { assignmentId: id, NOT: { employeeId: employeeId!, courseId } },
        });
      }
      return next;
    });

    await this.compliance.recalculateForAssignment(id);

    const course = await this.prisma.learningCourse.findUnique({ where: { id: courseId }, select: { title: true } });
    const title = course?.title ?? 'Course';
    if ((courseChanged || carerChanged) && employeeId) {
      await this.notifications.notifyAssignmentCreated({
        employeeIds: [employeeId],
        assignmentId: id,
        courseTitle: title,
        dueAt: updated.dueAt ?? undefined,
      });
      await this.push.assigned([{ employeeId, assignmentId: id }], title, updated.dueAt);
    } else if (dueChanged && employeeId && updated.dueAt) {
      await this.push.dueDateChanged({ employeeId, assignmentId: id, courseTitle: title, dueAt: updated.dueAt });
    }

    const changed = [courseChanged && 'course', carerChanged && 'carer', dueChanged && 'due date'].filter(Boolean);
    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_assignment_updated',
      recordType: 'LearningAssignment',
      recordId: id,
      description: `Assignment edited (${changed.join(', ')})${dto.note?.trim() ? `: ${dto.note.trim()}` : ''}`,
      oldValues: this.mapAssignment(row),
      newValues: this.mapAssignment(updated),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapAssignment(updated);
  }

  /** Office unassigns an open course before its due date (18 Nov 2026). Record kept as Cancelled. */
  async unassign(id: string, userId: string, dto: CancelAssignmentDto, meta?: RequestAuditMeta) {
    const row = await this.prisma.learningAssignment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Assignment not found');
    this.assertEditable(row);
    if (!dto.cancellationReason?.trim()) throw new BadRequestException('Write why the course is unassigned');
    const result = await this.cancel(id, userId, { cancellationReason: dto.cancellationReason.trim() }, meta);
    await this.prisma.learningTrainingEventAttendee.updateMany({
      where: { assignmentId: id, bookingStatus: { not: 'CANCELLED' } },
      data: { bookingStatus: 'CANCELLED' },
    });
    return result;
  }

  /**
   * Why course and carer can't be edited on an open row (18 Nov 2026), using the same rules as
   * update(): STARTED (status, progress or a quiz attempt) or BOOKED (on a session).
   */
  private async courseCarerLocks(rows: { id: string; status: LearningAssignmentStatus }[]) {
    const out = new Map<string, 'STARTED' | 'BOOKED'>();
    const open = rows.filter((r) => EDITABLE_STATUSES.includes(r.status));
    for (const r of open) {
      if (r.status === LearningAssignmentStatus.IN_PROGRESS) out.set(r.id, 'STARTED');
    }
    const ids = open.filter((r) => !out.has(r.id)).map((r) => r.id);
    if (!ids.length) return out;
    const [progress, attempts, bookings] = await Promise.all([
      this.prisma.learningEmployeeProgress.findMany({
        where: { assignmentId: { in: ids }, OR: [{ startedAt: { not: null } }, { completedContentItems: { gt: 0 } }] },
        select: { assignmentId: true },
      }),
      this.prisma.learningAssessmentAttempt.findMany({
        where: { assignmentId: { in: ids } },
        select: { assignmentId: true },
        distinct: ['assignmentId'],
      }),
      this.prisma.learningTrainingEventAttendee.findMany({
        where: { assignmentId: { in: ids }, bookingStatus: { not: 'CANCELLED' } },
        select: { assignmentId: true },
      }),
    ]);
    for (const r of [...progress, ...attempts]) out.set(r.assignmentId, 'STARTED');
    for (const r of bookings) if (r.assignmentId && !out.has(r.assignmentId)) out.set(r.assignmentId, 'BOOKED');
    return out;
  }

  /** Open (not finished) and the due date has not passed. */
  private assertEditable(row: { status: LearningAssignmentStatus; dueAt: Date | null }) {
    if (!EDITABLE_STATUSES.includes(row.status)) {
      throw new BadRequestException('Only a scheduled or in-progress course can be changed');
    }
    if (row.dueAt && row.dueAt.getTime() <= Date.now()) {
      throw new BadRequestException('The due date has passed. Use Review on the course record instead.');
    }
  }

  private async hasStarted(id: string, status: LearningAssignmentStatus) {
    if (status !== LearningAssignmentStatus.ASSIGNED && status !== LearningAssignmentStatus.NOT_STARTED) return true;
    const [progress, attempts] = await Promise.all([
      this.prisma.learningEmployeeProgress.findUnique({
        where: { assignmentId: id },
        select: { startedAt: true, completedContentItems: true },
      }),
      this.prisma.learningAssessmentAttempt.count({ where: { assignmentId: id } }),
    ]);
    return !!progress?.startedAt || (progress?.completedContentItems ?? 0) > 0 || attempts > 0;
  }

  async exempt(id: string, userId: string, dto: ExemptAssignmentDto, meta?: RequestAuditMeta) {
    const existing = await this.getById(id);
    const row = await this.prisma.learningAssignment.update({
      where: { id },
      data: {
        status: LearningAssignmentStatus.EXEMPT,
        exemptAt: new Date(),
        exemptById: userId,
        exemptionReason: dto.exemptionReason,
      },
    });

    await this.compliance.recalculateForAssignment(id);
    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_assignment_exempted',
      recordType: 'LearningAssignment',
      recordId: id,
      oldValues: existing,
      newValues: this.mapAssignment(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapAssignment(row);
  }

  async extendDueDate(id: string, userId: string, dto: ExtendDueDateDto, meta?: RequestAuditMeta) {
    const existing = await this.getById(id);
    const row = await this.prisma.learningAssignment.update({
      where: { id },
      data: { dueAt: new Date(dto.dueAt) },
    });

    await this.compliance.recalculateForAssignment(id);
    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_assignment_due_extended',
      recordType: 'LearningAssignment',
      recordId: id,
      oldValues: existing,
      newValues: this.mapAssignment(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapAssignment(row);
  }

  async reassign(id: string, userId: string, dto: ReassignAssignmentDto, meta?: RequestAuditMeta) {
    const existing = await this.getById(id);
    await this.cancel(id, userId, { cancellationReason: 'Reassigned' }, meta);

    const versionId =
      existing.courseVersionId ??
      (await this.resolveCourseVersionId(existing.courseId, existing.courseVersionId));

    const result = await this.createAssignmentForEmployee({
      employeeId: dto.employeeId,
      courseId: existing.courseId,
      courseVersionId: versionId,
      assignedById: userId,
      assignmentType: LearningAssignmentType.INDIVIDUAL,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : existing.dueAt ? new Date(existing.dueAt) : null,
      assignmentReason: existing.assignmentReason,
    });

    if (result.skipped) {
      throw new BadRequestException('Target employee already has an active assignment');
    }

    return this.mapAssignment(result.assignment);
  }
}
