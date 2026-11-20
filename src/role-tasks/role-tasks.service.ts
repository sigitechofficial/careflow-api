import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  RoleTaskRecurrence,
  RoleTaskStatus,
  type RoleTaskTemplate,
} from '@prisma/client';
import { branchLabelsById } from '../location-management/location-management.util';
import { PrismaService } from '../prisma/prisma.service';
import { surveysWithoutResultsAccess } from '../surveys/survey-access';
import { surveyVisibleInScope } from '../surveys/survey-scope.util';

/** Role tasks whose sourceId is a survey (or period): sends to check after events, phone call lists. */
const SURVEY_TASK_SOURCES = ['SURVEY_EVENT_DUE', 'SURVEY_CALL_LIST'];
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  addDaysToOperationalIso,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import {
  roleTaskDueDates,
  roleTaskLookaheadDays,
} from './role-task-schedule.util';
import type {
  CreateRoleTaskTemplateDto,
  UpdateRoleTaskStatusDto,
  UpdateRoleTaskTemplateDto,
} from './dto/role-task.dto';

const MANAGE_PERMISSION = 'role_tasks.manage';
const OPEN_STATUSES: RoleTaskStatus[] = [
  RoleTaskStatus.OPEN,
  RoleTaskStatus.IN_PROGRESS,
];

const toIso = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const TASK_INCLUDE = {
  role: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
} satisfies Prisma.RoleTaskInclude;

type TaskRow = Prisma.RoleTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

/**
 * Role tasks — work a manager gives to an office-user role. The whole role owns each
 * task: any user with that role (and branch) can start or complete it.
 */
@Injectable()
export class RoleTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  private async timeZone() {
    return this.orgSettings.getOperationalTimezone();
  }

  private assertOfficeUser(user: RequestUser) {
    if (user.accountKind !== 'user') {
      throw new ForbiddenException('Role tasks are for office users');
    }
  }

  private canManage(user: RequestUser) {
    return user.permissions.includes(MANAGE_PERMISSION);
  }

  private async userRoleIds(user: RequestUser): Promise<string[]> {
    if (!user.roles.length) return [];
    const roles = await this.prisma.role.findMany({
      where: { name: { in: user.roles }, deletedAt: null },
      select: { id: true },
    });
    return roles.map((r) => r.id);
  }

  /** Every branch the user can see, "Zone · Branch" labels, for the My tasks Branch filter (19 Nov 2026). */
  private async branchFilterOptions(user: RequestUser): Promise<Array<{ id: string; label: string }>> {
    const locations = await this.prisma.location.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(user.assignedLocationIds ? { id: { in: user.assignedLocationIds } } : {}),
      },
      select: { id: true },
    });
    const labels = await branchLabelsById(this.prisma, locations.map((l) => l.id));
    return [...labels.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Branch-restricted users only see all-branch tasks and their own branches. */
  private branchWhere(user: RequestUser): Prisma.RoleTaskWhereInput {
    if (!user.assignedLocationIds) return {};
    return {
      OR: [
        { locationId: null },
        { locationId: { in: user.assignedLocationIds } },
      ],
    };
  }

  private inBranchScope(user: RequestUser, locationId: string | null) {
    return (
      !user.assignedLocationIds ||
      !locationId ||
      user.assignedLocationIds.includes(locationId)
    );
  }

  /** Create due occurrences up to today (a week ahead for weekly / monthly tasks). */
  private async ensureOccurrences(templateIds?: string[]) {
    const timeZone = await this.timeZone();
    const today = operationalTodayIso(new Date(), timeZone);
    const templates = await this.prisma.roleTaskTemplate.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(templateIds ? { id: { in: templateIds } } : {}),
      },
      include: {
        tasks: {
          select: { dueDate: true },
          orderBy: { dueDate: 'desc' },
          take: 1,
        },
      },
    });

    const rows: Prisma.RoleTaskCreateManyInput[] = [];
    for (const t of templates) {
      const last = t.tasks[0] ? toIso(t.tasks[0].dueDate) : null;
      const schedule = {
        recurrence: t.recurrence,
        startDate: toIso(t.startDate),
        weekday: t.weekday,
        dayOfMonth: t.dayOfMonth,
      };
      let dueDates: string[];
      if (t.recurrence === RoleTaskRecurrence.NONE) {
        dueDates = last ? [] : [schedule.startDate];
      } else {
        // Never back-fill before the task was created.
        const created = operationalTodayIso(t.createdAt, timeZone);
        let from = created > schedule.startDate ? created : schedule.startDate;
        if (last) {
          const next = addDaysToOperationalIso(last, 1);
          if (next > from) from = next;
        }
        const until = addDaysToOperationalIso(
          today,
          roleTaskLookaheadDays(t.recurrence),
        );
        dueDates = roleTaskDueDates(schedule, from, until);
      }
      for (const due of dueDates) {
        rows.push({
          templateId: t.id,
          roleId: t.roleId,
          locationId: t.locationId,
          title: t.title,
          description: t.description,
          link: t.link,
          dueDate: toDate(due),
        });
      }
    }
    if (rows.length) {
      await this.prisma.roleTask.createMany({
        data: rows,
        skipDuplicates: true,
      });
    }
    return today;
  }

  /**
   * The carer each feature-raised task is about, and its course (19 Nov 2026):
   * Care app sign-up (sourceId = employee), delete request (sourceId = request), Learning
   * (sourceId = assignment, or certificate for certificate tasks). Others: nothing.
   */
  private async taskSubjects(
    rows: TaskRow[],
  ): Promise<Map<string, { about: { kind: 'CARER'; name: string } | null; course: string | null; futureVisits?: number; decision?: string | null }>> {
    const ids = (pred: (r: TaskRow) => boolean) =>
      [...new Set(rows.filter((r) => pred(r) && r.sourceId).map((r) => r.sourceId!))];
    const signupIds = ids((r) => r.sourceType === 'CARER_SIGNUP');
    const deletionIds = ids((r) => r.sourceType === 'CARER_DELETION_REQUEST');
    const certificateIds = ids((r) => r.sourceType === 'LEARNING_CERTIFICATE');
    const assignmentIds = ids(
      (r) => !!r.sourceType?.startsWith('LEARNING_') && r.sourceType !== 'LEARNING_CERTIFICATE',
    );
    const [deletions, assignments, certificates] = await Promise.all([
      deletionIds.length
        ? this.prisma.employeeAccountDeletionRequest.findMany({
            where: { id: { in: deletionIds } },
            select: { id: true, employeeId: true, status: true },
          })
        : Promise.resolve([] as Array<{ id: string; employeeId: string; status: string }>),
      assignmentIds.length
        ? this.prisma.learningAssignment.findMany({
            where: { id: { in: assignmentIds } },
            select: { id: true, employeeId: true, course: { select: { title: true } } },
          })
        : [],
      certificateIds.length
        ? this.prisma.learningCertificate.findMany({
            where: { id: { in: certificateIds } },
            select: { id: true, employeeId: true, course: { select: { title: true } } },
          })
        : [],
    ]);
    const employeeIds = [
      ...signupIds,
      ...deletions.map((d) => d.employeeId),
      ...assignments.map((a) => a.employeeId).filter((id): id is string => !!id),
      ...certificates.map((c) => c.employeeId),
    ];
    const people = employeeIds.length
      ? await this.prisma.employeePersonalDetail.findMany({
          where: { employeeId: { in: [...new Set(employeeIds)] } },
          select: { employeeId: true, firstName: true, lastName: true },
        })
      : [];
    const nameOf = new Map(
      people.map((p) => [p.employeeId, [p.firstName, p.lastName].filter(Boolean).join(' ').trim()]),
    );
    const deletionEmployee = new Map(deletions.map((d) => [d.id, d.employeeId]));
    // Sign-ups: the office's decision (APPROVED / DECLINED / PENDING), shown on the Done card.
    const signupStatus = new Map(
      (signupIds.length
        ? await this.prisma.employeePortalAccount.findMany({
            where: { employeeId: { in: signupIds } },
            select: { employeeId: true, approvalStatus: true },
          })
        : []
      ).map((a) => [a.employeeId, a.approvalStatus as string]),
    );
    // Waiting delete requests: how many future visits would lose this carer (shown on the task card).
    const pendingDeletionEmployees = [...new Set(deletions.filter((d) => d.status === 'PENDING').map((d) => d.employeeId))];
    const futureByEmployee = new Map<string, number>();
    if (pendingDeletionEmployees.length) {
      const grouped = await this.prisma.jobAllocation.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: { in: pendingDeletionEmployees },
          deletedAt: null,
          isActive: true,
          status: { in: ['PENDING_CONFIRMATION', 'ALLOCATED', 'CONFIRMED'] },
          scheduledJob: {
            deletedAt: null,
            isActive: true,
            scheduledStartDateTime: { gte: new Date() },
            status: { notIn: ['DRAFT', 'CANCELLED', 'CALLED_OFF'] },
          },
        },
        _count: { _all: true },
      });
      for (const g of grouped) futureByEmployee.set(g.employeeId, g._count._all);
    }
    const assignmentById = new Map(assignments.map((a) => [a.id, a]));
    const certificateById = new Map(certificates.map((c) => [c.id, c]));
    const carer = (employeeId: string | null | undefined) => {
      const name = employeeId ? nameOf.get(employeeId) : undefined;
      return name ? { kind: 'CARER' as const, name } : null;
    };

    const out = new Map<string, { about: { kind: 'CARER'; name: string } | null; course: string | null; futureVisits?: number; decision?: string | null }>();
    for (const r of rows) {
      if (!r.sourceId || !r.sourceType) continue;
      if (r.sourceType === 'CARER_SIGNUP')
        out.set(r.id, { about: carer(r.sourceId), course: null, decision: signupStatus.get(r.sourceId) ?? null });
      else if (r.sourceType === 'CARER_DELETION_REQUEST') {
        const employeeId = deletionEmployee.get(r.sourceId);
        const pending = deletions.find((d) => d.id === r.sourceId)?.status === 'PENDING';
        out.set(r.id, {
          about: carer(employeeId),
          course: null,
          decision: deletions.find((d) => d.id === r.sourceId)?.status ?? null,
          ...(pending && employeeId ? { futureVisits: futureByEmployee.get(employeeId) ?? 0 } : {}),
        });
      }
      else if (r.sourceType === 'LEARNING_CERTIFICATE') {
        const c = certificateById.get(r.sourceId);
        out.set(r.id, { about: carer(c?.employeeId), course: c?.course.title ?? null });
      } else if (r.sourceType.startsWith('LEARNING_')) {
        const a = assignmentById.get(r.sourceId);
        out.set(r.id, { about: carer(a?.employeeId), course: a?.course.title ?? null });
      }
    }
    return out;
  }

  private async serializeTasks(rows: TaskRow[], today: string) {
    const userIds = [
      ...new Set(
        rows.map((r) => r.completedById).filter((id): id is string => !!id),
      ),
    ];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, firstName: true, lastName: true },
        })
      : [];
    const nameById = new Map(
      users.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email,
      ]),
    );
    // "Zone · Branch", the same as the staff record's branch picker (19 Nov 2026).
    const branchLabels = await branchLabelsById(
      this.prisma,
      rows.map((r) => r.locationId).filter((id): id is string => !!id),
    );
    const subjects = await this.taskSubjects(rows);
    const timeZone = await this.timeZone();
    return rows.map((r) => {
      const due = toIso(r.dueDate);
      const open = OPEN_STATUSES.includes(r.status);
      return {
        id: r.id,
        templateId: r.templateId,
        /** What raised it (e.g. CARER_SIGNUP, LEARNING_OVERDUE, SURVEY_ALERT); null for a role task. */
        sourceType: r.sourceType,
        /** Who the task is about (a carer, by name) and the course, when the source says so. */
        about: subjects.get(r.id)?.about ?? null,
        course: subjects.get(r.id)?.course ?? null,
        /** Waiting delete request: future visits that would be unassigned. */
        futureVisits: subjects.get(r.id)?.futureVisits ?? null,
        /** Care app sign-up / delete request: the office's decision (APPROVED, DECLINED or PENDING). */
        decision: subjects.get(r.id)?.decision ?? null,
        title: r.title,
        description: r.description,
        link: r.link,
        dueDate: due,
        dueState: !open
          ? null
          : due < today
            ? 'overdue'
            : due === today
              ? 'today'
              : 'upcoming',
        status: r.status,
        note: r.note,
        role: r.role,
        location: r.location ? { ...r.location, label: branchLabels.get(r.location.id) ?? r.location.name } : null,
        startedAt: r.startedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        /** Done on a later day than it was due (organisation's day), for compliance reporting. */
        completedLate:
          r.status === 'DONE' && !!r.completedAt && operationalTodayIso(r.completedAt, timeZone) > due,
        completedByName: r.completedById
          ? (nameById.get(r.completedById) ?? null)
          : null,
      };
    });
  }

  private statusWhere(
    status: 'open' | 'done' | 'all' = 'open',
  ): Prisma.RoleTaskWhereInput {
    if (status === 'open') return { status: { in: OPEN_STATUSES } };
    if (status === 'done') return { status: RoleTaskStatus.DONE };
    return { status: { not: RoleTaskStatus.CANCELLED } };
  }

  /**
   * Survey alert tasks from a survey whose results this user may not see (per-survey access) are
   * left out, even for those who manage every role's tasks: the task itself says an alert was raised.
   */
  private async withoutHiddenSurveyTasks<T extends { sourceType: string | null; sourceId: string | null }>(user: RequestUser, rows: T[]): Promise<T[]> {
    const alertIds = rows.filter((r) => r.sourceType === 'SURVEY_ALERT' && r.sourceId).map((r) => r.sourceId!);
    // Survey actions (Phase 2 part 6) follow the same rule: they come from results.
    const actionIds = rows.filter((r) => r.sourceType === 'SURVEY_ACTION' && r.sourceId).map((r) => r.sourceId!);
    // Tasks about a survey itself (sourceId = the survey): who to send it to after an event, the call list. Their
    // branch rule is the survey's; they name the survey, so they follow its branches like the others.
    const aboutSurveyIds = rows.filter((r) => SURVEY_TASK_SOURCES.includes(r.sourceType ?? '') && r.sourceId).map((r) => r.sourceId!);
    if (!alertIds.length && !actionIds.length && !aboutSurveyIds.length) return rows;
    const alerts = alertIds.length ? await this.prisma.surveyAlert.findMany({ where: { id: { in: alertIds } }, select: { id: true, surveyId: true } }) : [];
    const actions = actionIds.length ? await this.prisma.surveyAction.findMany({ where: { id: { in: actionIds } }, select: { id: true, surveyId: true } }) : [];
    const surveyIds = [...new Set([...alerts, ...actions].map((a) => a.surveyId))];
    const hiddenSurveys = surveyIds.length ? await surveysWithoutResultsAccess(this.prisma, user, surveyIds) : new Set<string>();
    // A task with no branch (a survey for several branches) shows only to people whose branches cover every branch
    // the survey is for, as the survey itself does (survey-scope.util).
    const scope = { locationIds: user.assignedLocationIds ?? null };
    if (scope.locationIds !== null) {
      const ids = [...new Set([...surveyIds, ...aboutSurveyIds])];
      const surveys = await this.prisma.survey.findMany({ where: { id: { in: ids } }, select: { id: true, locationIds: true, isTemplate: true } });
      for (const s of surveys) if (!surveyVisibleInScope(scope, s)) hiddenSurveys.add(s.id);
    }
    const hidden = new Set([...alerts, ...actions].filter((a) => hiddenSurveys.has(a.surveyId)).map((a) => a.id));
    return rows.filter(
      (r) =>
        !(
          r.sourceId &&
          (((r.sourceType === 'SURVEY_ALERT' || r.sourceType === 'SURVEY_ACTION') && hidden.has(r.sourceId)) ||
            (SURVEY_TASK_SOURCES.includes(r.sourceType ?? '') && hiddenSurveys.has(r.sourceId)))
        ),
    );
  }


  /** Tasks for the signed-in user's roles (and branches). */
  async listMine(user: RequestUser, status: 'open' | 'done' | 'all' = 'open') {
    this.assertOfficeUser(user);
    const today = await this.ensureOccurrences();
    const roleIds = await this.userRoleIds(user);
    if (!roleIds.length)
      return { message: 'My tasks', data: { today, tasks: [] } };
    const rows = await this.prisma.roleTask.findMany({
      where: {
        roleId: { in: roleIds },
        ...this.branchWhere(user),
        ...this.statusWhere(status),
      },
      include: TASK_INCLUDE,
      orderBy:
        status === 'done'
          ? [{ completedAt: 'desc' }]
          : [{ dueDate: 'asc' }, { title: 'asc' }],
      take: status === 'open' ? 500 : 100,
    });
    return {
      message: 'My tasks',
      data: {
        today,
        tasks: await this.serializeTasks(await this.withoutHiddenSurveyTasks(user, rows), today),
        branches: await this.branchFilterOptions(user),
      },
    };
  }

  /** Manager view: tasks across every role in the manager's branch scope. */
  async listAll(
    user: RequestUser,
    status: 'open' | 'done' | 'all' = 'open',
    roleId?: string,
  ) {
    const today = await this.ensureOccurrences();
    const rows = await this.prisma.roleTask.findMany({
      where: {
        ...(roleId ? { roleId } : {}),
        ...this.branchWhere(user),
        ...this.statusWhere(status),
      },
      include: TASK_INCLUDE,
      orderBy:
        status === 'done'
          ? [{ completedAt: 'desc' }]
          : [{ dueDate: 'asc' }, { title: 'asc' }],
      take: 300,
    });
    return {
      message: 'Role tasks',
      data: { today, tasks: await this.serializeTasks(await this.withoutHiddenSurveyTasks(user, rows), today) },
    };
  }

  async updateStatus(
    user: RequestUser,
    taskId: string,
    dto: UpdateRoleTaskStatusDto,
  ) {
    this.assertOfficeUser(user);
    const task = await this.prisma.roleTask.findUnique({
      where: { id: taskId },
    });
    if (!task) throw new NotFoundException('Task not found');
    const roleIds = await this.userRoleIds(user);
    const allowed =
      (roleIds.includes(task.roleId) || this.canManage(user)) &&
      this.inBranchScope(user, task.locationId);
    if (!allowed || !(await this.withoutHiddenSurveyTasks(user, [task])).length)
      throw new ForbiddenException('This task belongs to another role');
    if (task.status === RoleTaskStatus.CANCELLED) {
      throw new BadRequestException('This task was cancelled');
    }
    // A survey alert is closed on its follow-up, which asks what was done (and, for a contact
    // request, whether the person was reached): never here, where that would be skipped.
    // Care app sign-ups and delete requests close only by Approve / Decline on the staff record (20 Nov 2026):
    // closing or reopening the task here would leave the request out of step with its task.
    if (task.sourceType === 'CARER_SIGNUP' || task.sourceType === 'CARER_DELETION_REQUEST') {
      if (dto.status === RoleTaskStatus.DONE) {
        throw new BadRequestException('Approve or decline this request on the carer’s record (Review).');
      }
      if (task.status === RoleTaskStatus.DONE) {
        throw new BadRequestException('This request was decided on the carer’s record, so its task cannot be reopened.');
      }
    }
    if (task.sourceType === 'SURVEY_ACTION' && dto.status === RoleTaskStatus.DONE) {
      throw new BadRequestException('Close a survey action on its page (Open page), saying what was done.');
    }
    // A closed action's task is reopened with the action (which takes its CQC evidence entry back), never here.
    if (task.sourceType === 'SURVEY_ACTION' && task.status === RoleTaskStatus.DONE) {
      throw new BadRequestException('Reopen a survey action on its page (Open page).');
    }
    // A done follow-up is reopened on its page too (it records what was done), never from the task list.
    if (task.sourceType === 'SURVEY_ALERT' && task.status === RoleTaskStatus.DONE) {
      throw new BadRequestException('Reopen a survey follow-up on its page (Open page).');
    }
    if (task.sourceType === 'SURVEY_ALERT' && dto.status === RoleTaskStatus.DONE) {
      throw new BadRequestException(
        'Close a survey follow-up on its page (Open page), saying what was done.',
      );
    }

    // Learning tasks close themselves when the work is done in Learning (18 Nov 2026), so they
    // are never marked done or reopened from the task list.
    if (task.sourceType?.startsWith('LEARNING_') && (dto.status === RoleTaskStatus.DONE || task.status === RoleTaskStatus.DONE)) {
      throw new BadRequestException('This Learning task closes itself when the work is done in Learning (Open page).');
    }

    const now = new Date();
    const data: Prisma.RoleTaskUpdateInput = { status: dto.status };
    if (dto.note !== undefined) data.note = dto.note?.trim() || null;
    if (dto.status === 'OPEN') {
      Object.assign(data, {
        startedAt: null,
        completedAt: null,
        completedById: null,
      });
    } else if (dto.status === 'IN_PROGRESS') {
      Object.assign(data, {
        startedAt: task.startedAt ?? now,
        completedAt: null,
        completedById: null,
      });
    } else {
      Object.assign(data, {
        startedAt: task.startedAt ?? now,
        completedAt: now,
        completedById: user.id,
      });
    }
    const saved = await this.prisma.roleTask.update({
      where: { id: taskId },
      data,
      include: TASK_INCLUDE,
    });
    // A survey action's progress (open / started) follows its task; closing is done on the action.
    if (task.sourceType === 'SURVEY_ACTION' && task.sourceId) {
      await this.prisma.surveyAction.updateMany({ where: { id: task.sourceId, status: { in: ['OPEN', 'IN_PROGRESS'] } }, data: { status: dto.status, updatedById: user.id } });
    }
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.ROLE_TASK,
      action: AuditAction.ROLE_TASK_STATUS_CHANGED,
      recordType: 'RoleTask',
      recordId: taskId,
      description: `Role task "${task.title}" marked ${dto.status}`,
      oldValues: { status: task.status },
      newValues: { status: dto.status },
    });
    const timeZone = await this.timeZone();
    const [row] = await this.serializeTasks(
      [saved],
      operationalTodayIso(now, timeZone),
    );
    return { message: 'Task updated', data: row };
  }

  // ── Templates (manager) ────────────────────────────────────────────────

  /** Roles and branches a manager can pick when creating a task. */
  async options(user: RequestUser) {
    const [roles, locations] = await Promise.all([
      this.prisma.role.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.location.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          ...(user.assignedLocationIds
            ? { id: { in: user.assignedLocationIds } }
            : {}),
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      message: 'Role task options',
      data: {
        roles,
        locations,
        branchRestricted: Boolean(user.assignedLocationIds),
      },
    };
  }

  private async validateTemplate(
    user: RequestUser,
    input: {
      roleId: string;
      locationId: string | null;
      recurrence: RoleTaskRecurrence;
      weekday: number | null;
      dayOfMonth: number | null;
    },
  ) {
    const role = await this.prisma.role.findFirst({
      where: { id: input.roleId, deletedAt: null },
      select: { id: true },
    });
    if (!role) throw new BadRequestException('Role not found');
    if (input.locationId) {
      const location = await this.prisma.location.findFirst({
        where: { id: input.locationId, deletedAt: null },
        select: { id: true },
      });
      if (!location) throw new BadRequestException('Branch not found');
    }
    if (user.assignedLocationIds && !input.locationId) {
      throw new BadRequestException(
        'Choose one of your branches for this task',
      );
    }
    if (!this.inBranchScope(user, input.locationId)) {
      throw new ForbiddenException('That branch is outside your access');
    }
    if (
      input.recurrence === RoleTaskRecurrence.WEEKLY &&
      input.weekday == null
    ) {
      throw new BadRequestException('Choose the day of the week');
    }
    if (
      input.recurrence === RoleTaskRecurrence.MONTHLY &&
      input.dayOfMonth == null
    ) {
      throw new BadRequestException('Choose the day of the month');
    }
  }

  private serializeTemplate(
    t: RoleTaskTemplate & {
      role: { id: string; name: string };
      location: { id: string; name: string } | null;
    },
    nextDue: string | null,
    openCount: number,
  ) {
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      link: t.link,
      role: t.role,
      location: t.location,
      recurrence: t.recurrence,
      startDate: toIso(t.startDate),
      weekday: t.weekday,
      dayOfMonth: t.dayOfMonth,
      isActive: t.isActive,
      nextDue,
      openCount,
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  async listTemplates(user: RequestUser) {
    await this.ensureOccurrences();
    const templates = await this.prisma.roleTaskTemplate.findMany({
      where: {
        deletedAt: null,
        ...(user.assignedLocationIds
          ? {
              OR: [
                { locationId: null },
                { locationId: { in: user.assignedLocationIds } },
              ],
            }
          : {}),
      },
      include: {
        role: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        tasks: {
          where: { status: { in: OPEN_STATUSES } },
          select: { dueDate: true },
          orderBy: { dueDate: 'asc' },
        },
      },
      orderBy: [{ role: { name: 'asc' } }, { title: 'asc' }],
    });
    return {
      message: 'Role task templates',
      data: templates.map((t) =>
        this.serializeTemplate(
          t,
          t.tasks[0] ? toIso(t.tasks[0].dueDate) : null,
          t.tasks.length,
        ),
      ),
    };
  }

  async createTemplate(user: RequestUser, dto: CreateRoleTaskTemplateDto) {
    const input = {
      roleId: dto.roleId,
      locationId: dto.locationId ?? null,
      recurrence: dto.recurrence,
      weekday:
        dto.recurrence === RoleTaskRecurrence.WEEKLY
          ? (dto.weekday ?? null)
          : null,
      dayOfMonth:
        dto.recurrence === RoleTaskRecurrence.MONTHLY
          ? (dto.dayOfMonth ?? null)
          : null,
    };
    await this.validateTemplate(user, input);
    const created = await this.prisma.roleTaskTemplate.create({
      data: {
        ...input,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        link: dto.link?.trim() || null,
        startDate: toDate(dto.startDate.slice(0, 10)),
        isActive: dto.isActive ?? true,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await this.ensureOccurrences([created.id]);
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.ROLE_TASK,
      action: AuditAction.ROLE_TASK_TEMPLATE_CREATED,
      recordType: 'RoleTaskTemplate',
      recordId: created.id,
      description: `Role task "${created.title}" created`,
      newValues: {
        ...input,
        title: created.title,
        startDate: dto.startDate.slice(0, 10),
      },
    });
    return { message: 'Task created', data: { id: created.id } };
  }

  private async requireTemplate(user: RequestUser, id: string) {
    const t = await this.prisma.roleTaskTemplate.findFirst({
      where: { id, deletedAt: null },
    });
    if (!t) throw new NotFoundException('Task not found');
    if (
      !this.inBranchScope(user, t.locationId) ||
      (user.assignedLocationIds && !t.locationId)
    ) {
      throw new ForbiddenException('That task is outside your access');
    }
    return t;
  }

  async updateTemplate(
    user: RequestUser,
    id: string,
    dto: UpdateRoleTaskTemplateDto,
  ) {
    const existing = await this.requireTemplate(user, id);
    const recurrence = dto.recurrence ?? existing.recurrence;
    const input = {
      roleId: dto.roleId ?? existing.roleId,
      locationId:
        dto.locationId !== undefined ? dto.locationId : existing.locationId,
      recurrence,
      weekday:
        recurrence === RoleTaskRecurrence.WEEKLY
          ? dto.weekday !== undefined
            ? dto.weekday
            : existing.weekday
          : null,
      dayOfMonth:
        recurrence === RoleTaskRecurrence.MONTHLY
          ? dto.dayOfMonth !== undefined
            ? dto.dayOfMonth
            : existing.dayOfMonth
          : null,
    };
    await this.validateTemplate(user, input);
    const startDate = dto.startDate
      ? dto.startDate.slice(0, 10)
      : toIso(existing.startDate);
    const scheduleChanged =
      input.recurrence !== existing.recurrence ||
      startDate !== toIso(existing.startDate) ||
      input.weekday !== existing.weekday ||
      input.dayOfMonth !== existing.dayOfMonth;

    const saved = await this.prisma.roleTaskTemplate.update({
      where: { id },
      data: {
        ...input,
        title: dto.title !== undefined ? dto.title.trim() : existing.title,
        description:
          dto.description !== undefined
            ? dto.description?.trim() || null
            : existing.description,
        link: dto.link !== undefined ? dto.link?.trim() || null : existing.link,
        startDate: toDate(startDate),
        isActive: dto.isActive ?? existing.isActive,
        updatedById: user.id,
      },
    });

    // Not-started occurrences follow the new details / schedule; started or done ones keep their history.
    const timeZone = await this.timeZone();
    const today = operationalTodayIso(new Date(), timeZone);
    if (scheduleChanged || !saved.isActive) {
      await this.prisma.roleTask.deleteMany({
        where: {
          templateId: id,
          status: RoleTaskStatus.OPEN,
          dueDate: { gte: toDate(today) },
        },
      });
    }
    await this.prisma.roleTask.updateMany({
      where: { templateId: id, status: { in: OPEN_STATUSES } },
      data: {
        title: saved.title,
        description: saved.description,
        link: saved.link,
        roleId: saved.roleId,
        locationId: saved.locationId,
      },
    });
    await this.ensureOccurrences([id]);
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.ROLE_TASK,
      action: AuditAction.ROLE_TASK_TEMPLATE_UPDATED,
      recordType: 'RoleTaskTemplate',
      recordId: id,
      description: `Role task "${saved.title}" updated`,
      oldValues: {
        title: existing.title,
        roleId: existing.roleId,
        locationId: existing.locationId,
        recurrence: existing.recurrence,
        isActive: existing.isActive,
      },
      newValues: {
        title: saved.title,
        roleId: saved.roleId,
        locationId: saved.locationId,
        recurrence: saved.recurrence,
        isActive: saved.isActive,
      },
    });
    return { message: 'Task updated', data: { id } };
  }

  async deleteTemplate(user: RequestUser, id: string) {
    const existing = await this.requireTemplate(user, id);
    await this.prisma.$transaction([
      this.prisma.roleTaskTemplate.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false, updatedById: user.id },
      }),
      this.prisma.roleTask.updateMany({
        where: { templateId: id, status: { in: OPEN_STATUSES } },
        data: { status: RoleTaskStatus.CANCELLED },
      }),
    ]);
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.ROLE_TASK,
      action: AuditAction.ROLE_TASK_TEMPLATE_DELETED,
      recordType: 'RoleTaskTemplate',
      recordId: id,
      description: `Role task "${existing.title}" deleted`,
      oldValues: { title: existing.title, roleId: existing.roleId },
    });
    return { message: 'Task deleted', data: { id } };
  }
}
