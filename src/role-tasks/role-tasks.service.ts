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
import { PrismaService } from '../prisma/prisma.service';
import { surveysWithoutResultsAccess } from '../surveys/survey-access';
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
    return rows.map((r) => {
      const due = toIso(r.dueDate);
      const open = OPEN_STATUSES.includes(r.status);
      return {
        id: r.id,
        templateId: r.templateId,
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
        location: r.location,
        startedAt: r.startedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
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
    if (!alertIds.length) return rows;
    const alerts = await this.prisma.surveyAlert.findMany({ where: { id: { in: alertIds } }, select: { id: true, surveyId: true } });
    const hiddenSurveys = await surveysWithoutResultsAccess(this.prisma, user, alerts.map((a) => a.surveyId));
    const hidden = new Set(alerts.filter((a) => hiddenSurveys.has(a.surveyId)).map((a) => a.id));
    return rows.filter((r) => !(r.sourceType === 'SURVEY_ALERT' && r.sourceId && hidden.has(r.sourceId)));
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
      data: { today, tasks: await this.serializeTasks(await this.withoutHiddenSurveyTasks(user, rows), today) },
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
    if (task.sourceType === 'SURVEY_ALERT' && dto.status === RoleTaskStatus.DONE) {
      throw new BadRequestException(
        'Close a survey follow-up on its page (Open page), saying what was done.',
      );
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
