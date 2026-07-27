import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
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
  LearningListQueryDto,
  ReassignAssignmentDto,
} from './dto/learning.dto';
import { LearningNotificationHook } from './learning-notification.hook';
import { LearningSettingsService } from './learning-settings.service';
import { LearningComplianceService } from './learning-compliance.service';

const ACTIVE_STATUSES: LearningAssignmentStatus[] = [
  LearningAssignmentStatus.ASSIGNED,
  LearningAssignmentStatus.NOT_STARTED,
  LearningAssignmentStatus.IN_PROGRESS,
  LearningAssignmentStatus.AWAITING_ASSESSMENT,
  LearningAssignmentStatus.AWAITING_APPROVAL,
  LearningAssignmentStatus.OVERDUE,
];

@Injectable()
export class LearningAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly settings: LearningSettingsService,
    private readonly notifications: LearningNotificationHook,
    private readonly compliance: LearningComplianceService,
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
      status: row.status,
      completedAt: row.completedAt?.toISOString() ?? null,
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
    if (courseVersionId) return courseVersionId;
    const course = await this.prisma.learningCourse.findFirst({
      where: { id: courseId, deletedAt: null },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.status !== LearningCourseStatus.PUBLISHED || !course.currentVersionId) {
      throw new BadRequestException('Course has no published version');
    }
    return course.currentVersionId;
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
  }) {
    await this.validateActiveEmployee(params.employeeId);
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

  async list(query: LearningListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.learningAssignment.findMany({
        where: { employeeId: { not: null } },
        include: {
          course: { select: { title: true, code: true } },
        },
        orderBy: { assignedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.learningAssignment.count({ where: { employeeId: { not: null } } }),
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

    return {
      data: rows.map((r) =>
        this.mapAssignment(r, {
          employeeName: r.employeeId ? employeeNameById.get(r.employeeId) ?? null : null,
          courseTitle: r.course?.title ?? null,
          courseCode: r.course?.code ?? null,
        }),
      ),
      meta: buildPaginationMeta({ page, limit, total }),
    };
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
        },
        select: { employeeId: true },
      });
      rows.forEach((r) => employeeIdSet.add(r.employeeId));
    }

    if (employeeIdSet.size === 0) {
      throw new BadRequestException(
        'No eligible employees matched the selected employees, roles, locations, or work areas',
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

    for (const employeeId of employeeIdSet) {
      const result = await this.createAssignmentForEmployee({
        employeeId,
        courseId: dto.courseId,
        courseVersionId: versionId,
        assignedById: userId,
        assignmentType: LearningAssignmentType.BULK,
        dueAt,
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
        select: { employeeId: true },
      });
      await this.notifications.notifyAssignmentCreated({
        employeeIds: assignments.map((a) => a.employeeId!).filter(Boolean),
        assignmentId: parent.id,
        courseTitle: course?.title ?? 'Course',
        dueAt,
      });
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
