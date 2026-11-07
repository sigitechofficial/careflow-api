import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SupervisionFormat } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import type { SupervisionSettings } from '../organisation-general-settings/supervision-settings.util';
import {
  deriveReviewStatus,
  REVIEW_SCHEDULE_SELECT,
  scheduledNextDue,
  type ReviewSchedule,
} from '../employee-reviews/employee-review-schedule.util';
import { collectReviewDues, currentStaffWhere } from '../employee-reviews/review-dues';
import { isSessionEditable, richTextHasContent, statusAfterSignature } from './supervision-session.util';
import {
  formProgress,
  mergeAnswers,
  missingRequiredFields,
  parseAnswers,
  parseSnapshot,
  snapshotFromForm,
} from './supervision-form.util';

/** Rich-text notes come from the editor as HTML; an empty editor is stored as no note. */
function richTextOrNull(html: string | null | undefined): string | null {
  return richTextHasContent(html) ? html!.trim() : null;
}
import type {
  AttendeeSignDto,
  CancelSupervisionSessionDto,
  CreateSupervisionAddendumDto,
  CreateSupervisionSessionDto,
  ListSupervisionSessionsQueryDto,
  SupervisorSignDto,
  UpdateSupervisionSessionDto,
} from './dto/supervision-session.dto';
import type { CreateSupervisionActionDto, UpdateSupervisionActionDto } from './dto/supervision-action.dto';
import type { SetEmployeeSupervisorDto, SetReviewScheduleDto, SetSupervisionFormDto } from './dto/supervision-form.dto';

type Tx = Prisma.TransactionClient;

const PERSON = { select: { id: true, firstName: true, lastName: true, email: true } } as const;
/** Name plus the identifiers that tell two carers with the same name apart. */
const EMPLOYEE_NAME = {
  select: {
    id: true,
    personalDetail: { select: { firstName: true, lastName: true, username: true } },
    employment: { select: { employeeNumber: true } },
  },
} as const;

/** Everything a session page shows (signature images included). */
const SESSION_DETAIL = {
  reviewType: { select: { id: true, name: true, code: true, defaultIntervalDays: true } },
  supervisor: PERSON,
  attendees: { include: { employee: EMPLOYEE_NAME }, orderBy: { id: 'asc' } },
  actions: { include: { employee: EMPLOYEE_NAME }, orderBy: { createdAt: 'asc' } },
  addenda: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SupervisionSessionInclude;

type SessionDetail = Prisma.SupervisionSessionGetPayload<{ include: typeof SESSION_DETAIL }>;

/** A Care Pathway form with the sections and fields of its current version (as the renderer shows it). */
const FORM_WITH_FIELDS = {
  currentVersion: {
    include: {
      sections: {
        where: { deletedAt: null, isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: { fields: { where: { deletedAt: null, isActive: true }, orderBy: { sortOrder: 'asc' } } },
      },
    },
  },
} satisfies Prisma.CarePathwayFormInclude;

type FormWithFields = Prisma.CarePathwayFormGetPayload<{ include: typeof FORM_WITH_FIELDS }>;

/** Review types that count as supervision for "supervised in the last 3 months". */
const SUPERVISION_CODES = ['SUPERVISION', 'CLINICAL_SUPERVISION', 'SPOT_CHECK', 'PROBATION_REVIEW'] as const;

/**
 * How many of a repeating review should have come due in [since, now]: due dates run from the
 * start date (first after `firstDue` days, else the interval), so a carer who started a month ago
 * is not expected to have had four supervisions. Without a start date: a full year's worth.
 */
export function expectedInWindow(
  intervalDays: number,
  firstDueAfterStartDays: number | null,
  startDate: Date | null,
  since: Date,
  now: Date,
): number {
  if (!startDate) return Math.floor((now.getTime() - since.getTime()) / 86_400_000 / intervalDays);
  const DAY = 86_400_000;
  let due = startDate.getTime() + (firstDueAfterStartDays ?? intervalDays) * DAY;
  let count = 0;
  while (due <= now.getTime()) {
    if (due >= since.getTime()) count += 1;
    due += intervalDays * DAY;
  }
  return count;
}

/** Session forms are Care Pathway staff forms. */
const SUPERVISION_FORM_TYPE = 'STAFF_FORM' as const;

@Injectable()
export class SupervisionService {
  private readonly logger = new Logger(SupervisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  // ─── Forms (Settings → Supervision) ─────────────────────────────────────────────────────────

  /**
   * Every active review type with the Care Pathway form its sessions are recorded on, plus the
   * staff forms that can be chosen. Forms are built and published in Care Pathway → Form builder.
   */
  async listForms() {
    const [types, forms] = await Promise.all([
      this.prisma.reviewType.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          code: true,
          description: true,
          ...REVIEW_SCHEDULE_SELECT,
          supervisionForm: { select: { id: true, name: true, status: true, lastPublishedAt: true, deletedAt: true } },
        },
      }),
      this.prisma.carePathwayForm.findMany({
        where: { formType: SUPERVISION_FORM_TYPE, deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, status: true, lastPublishedAt: true },
      }),
    ]);
    return {
      data: {
        reviewTypes: types.map(({ supervisionForm: form, ...t }) => ({
          ...t,
          form:
            form && !form.deletedAt
              ? { id: form.id, name: form.name, status: form.status, lastPublishedAt: form.lastPublishedAt }
              : null,
        })),
        forms,
      },
    };
  }

  async setForm(user: RequestUser, reviewTypeId: string, dto: SetSupervisionFormDto, meta?: RequestAuditMeta) {
    const type = await this.prisma.reviewType.findFirst({
      where: { id: reviewTypeId, deletedAt: null },
      select: { id: true, name: true, supervisionFormId: true },
    });
    if (!type) throw new NotFoundException('Review type not found');
    const formId = dto.formId ?? null;
    if (formId) {
      const form = await this.prisma.carePathwayForm.findFirst({
        where: { id: formId, deletedAt: null, isActive: true },
        select: { formType: true },
      });
      if (!form) throw new NotFoundException('Form not found');
      if (form.formType !== SUPERVISION_FORM_TYPE) {
        throw new BadRequestException('Choose a staff form (Care Pathway → Form builder → Staff form)');
      }
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.reviewType.update({ where: { id: type.id }, data: { supervisionFormId: formId } });
      await this.log(tx, user, AuditAction.SUPERVISION_FORM_ASSIGNED, 'ReviewType', type.id, meta, {
        reviewType: type.name,
        from: type.supervisionFormId,
        to: formId,
      });
      return { message: formId ? 'Form set' : 'Form removed', data: { reviewTypeId: type.id, formId } };
    });
  }

  /**
   * When a review type is due and who for (Settings → Supervision → Review types). Changing it
   * applies from now on: milestones are worked out from each carer's start date when read, and
   * other types' next due moves on the next time one is recorded.
   */
  async setSchedule(user: RequestUser, reviewTypeId: string, dto: SetReviewScheduleDto, meta?: RequestAuditMeta) {
    const type = await this.prisma.reviewType.findFirst({
      where: { id: reviewTypeId, deletedAt: null },
      select: { id: true, name: true, ...REVIEW_SCHEDULE_SELECT },
    });
    if (!type) throw new NotFoundException('Review type not found');
    const milestoneDays = [...new Set(dto.milestoneDays)].sort((a, b) => a - b);
    if (dto.scheduleKind === 'REPEATING' && !dto.defaultIntervalDays) {
      throw new BadRequestException('A repeating review needs the number of days between reviews');
    }
    if (dto.scheduleKind === 'MILESTONES' && !milestoneDays.length) {
      throw new BadRequestException('Add at least one milestone (days after the start date)');
    }
    const data = {
      scheduleKind: dto.scheduleKind,
      defaultIntervalDays: dto.scheduleKind === 'MILESTONES' ? null : dto.defaultIntervalDays,
      firstDueAfterStartDays: dto.scheduleKind === 'REPEATING' ? dto.firstDueAfterStartDays : null,
      milestoneDays: dto.scheduleKind === 'MILESTONES' ? milestoneDays : [],
      audience: dto.audience,
    };
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.reviewType.update({
        where: { id: type.id },
        data,
        select: { id: true, name: true, ...REVIEW_SCHEDULE_SELECT },
      });
      const { id: _id, name: _name, ...before } = type;
      await this.log(tx, user, AuditAction.SUPERVISION_SCHEDULE_UPDATED, 'ReviewType', type.id, meta, {
        reviewType: type.name,
        before,
        after: data,
      });
      return { message: 'Schedule saved', data: updated };
    });
  }

  // ─── Overview (dashboard) ──────────────────────────────────────────────────────────────────

  /**
   * Workforce tiles: supervision overdue / due soon / never recorded, share of current staff
   * supervised in the last 3 months (NICE QS123, CQC Regulation 18), other reviews overdue and
   * sessions waiting for carer sign-off. Optionally for one branch.
   */
  async overview(locationId?: string) {
    const settings = await this.orgSettings.getSupervisionSettings();
    const now = new Date();
    const staffWhere = currentStaffWhere(now, locationId);
    const [{ staff, dues, latest }, codes, awaitingSignOff] = await Promise.all([
      collectReviewDues(this.prisma, staffWhere),
      this.prisma.reviewType.findMany({ where: { deletedAt: null }, select: { id: true, code: true } }),
      this.prisma.supervisionSession.count({
        where: { deletedAt: null, status: 'AWAITING_SIGN_OFF', attendees: { some: { employee: staffWhere } } },
      }),
    ]);
    const codeOf = new Map(codes.map((t) => [t.id, t.code]));
    // Due from the schedules, so new starters and probation / induction milestones count too.
    const supervision = { overdue: 0, dueSoon: 0, noRecord: 0 };
    const other = { overdue: 0, dueSoon: 0 };
    for (const due of dues) {
      const status = deriveReviewStatus({ nextDue: due.nextDue }, now, settings.dueSoonDays);
      const bucket = due.typeCode === 'SUPERVISION' ? supervision : other;
      if (status === 'OVERDUE') bucket.overdue += 1;
      else if (status === 'DUE_SOON') bucket.dueSoon += 1;
    }
    // From the review records, so supervisions recorded on the staff record (e.g. a signed paper
    // form) count as well as sessions held here (which move those records on when completed).
    const since = new Date(now.getTime() - 91 * 86_400_000);
    const everSupervised = new Set<string>();
    const supervised = new Set<string>();
    for (const t of latest.values()) {
      const code = codeOf.get(t.reviewTypeId);
      if (code === 'SUPERVISION' && t.lastDone) everSupervised.add(t.employeeId);
      if (SUPERVISION_CODES.includes(code as (typeof SUPERVISION_CODES)[number]) && t.lastDone && t.lastDone >= since) {
        supervised.add(t.employeeId);
      }
    }
    supervision.noRecord = staff.filter((p) => !everSupervised.has(p.id)).length;
    return {
      data: {
        activeStaff: staff.length,
        dueSoonDays: settings.dueSoonDays,
        supervision,
        otherReviews: other,
        supervisedLast3Months: supervised.size,
        awaitingSignOff,
      },
    };
  }

  /**
   * For one carer, each repeating review that applies to them (see expectedInWindow for how the
   * expected count is pro-rated for new starters): how many were held in the last 12
   * months against how many the schedule expects (e.g. supervision every 90 days = at least 4),
   * plus last done and next due. Held = distinct days with a CareFlow session completed or a review
   * recorded on the staff record (a session moves the record on, so the same day is counted once).
   */
  async employeeSummary(employeeId: string) {
    const now = new Date();
    const since = new Date(now.getTime() - 365 * 86_400_000);
    const [settings, collected, types, records, sessions] = await Promise.all([
      this.orgSettings.getSupervisionSettings(),
      collectReviewDues(this.prisma, { id: employeeId, deletedAt: null }),
      this.prisma.reviewType.findMany({
        where: { deletedAt: null, isActive: true, scheduleKind: 'REPEATING', defaultIntervalDays: { gt: 0 } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, code: true, defaultIntervalDays: true, firstDueAfterStartDays: true, audience: true },
      }),
      this.prisma.employeeReview.findMany({
        where: { employeeId, deletedAt: null, lastDone: { gte: since } },
        select: { reviewTypeId: true, lastDone: true },
      }),
      this.prisma.supervisionSession.findMany({
        where: { deletedAt: null, status: 'COMPLETED', heldAt: { gte: since }, attendees: { some: { employeeId } } },
        select: { reviewTypeId: true, heldAt: true },
      }),
    ]);
    const person = collected.staff[0];
    if (!person) throw new NotFoundException('Employee not found');
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const rows = types
      .filter((t) => t.audience === 'ALL_STAFF' || Boolean(person.nmcPinNumber?.trim()))
      .map((t) => {
        const days = new Set<string>();
        for (const r of records) if (r.reviewTypeId === t.id && r.lastDone) days.add(day(r.lastDone));
        for (const s of sessions) if (s.reviewTypeId === t.id && s.heldAt) days.add(day(s.heldAt));
        const due = collected.dues.find((d) => d.reviewTypeId === t.id) ?? null;
        const tracker = collected.latest.get(`${employeeId}:${t.id}`) ?? null;
        return {
          reviewTypeId: t.id,
          name: t.name,
          code: t.code,
          intervalDays: t.defaultIntervalDays!,
          expectedPerYear: Math.floor(365 / t.defaultIntervalDays!),
          expectedLast12Months: expectedInWindow(
            t.defaultIntervalDays!,
            t.firstDueAfterStartDays,
            person.startDate,
            since,
            now,
          ),
          heldLast12Months: days.size,
          lastDone: tracker?.lastDone ?? null,
          nextDue: due?.nextDue ?? null,
          status: due ? deriveReviewStatus({ nextDue: due.nextDue }, now, settings.dueSoonDays) : null,
        };
      });
    return { data: { startDate: person.startDate, types: rows } };
  }

  // ─── Named supervisor ───────────────────────────────────────────────────────────────────────

  /** Active users who can run supervisions (hold supervision.manage), for the supervisor picker. */
  async listSupervisors() {
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        userRoles: {
          some: {
            role: {
              deletedAt: null,
              isActive: true,
              rolePermissions: { some: { permission: { key: 'supervision.manage', deletedAt: null } } },
            },
          },
        },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: PERSON.select,
    });
    return { data: users };
  }

  async getEmployeeSupervisor(employeeId: string) {
    const employment = await this.prisma.employeeEmployment.findFirst({
      where: { employeeId, employee: { deletedAt: null } },
      select: { supervisor: PERSON },
    });
    return { data: { supervisor: employment?.supervisor ?? null } };
  }

  async setEmployeeSupervisor(
    user: RequestUser,
    employeeId: string,
    dto: SetEmployeeSupervisorDto,
    meta?: RequestAuditMeta,
  ) {
    const employment = await this.prisma.employeeEmployment.findFirst({
      where: { employeeId, employee: { deletedAt: null } },
      select: { id: true, supervisorUserId: true },
    });
    if (!employment) throw new NotFoundException('Employment record not found for this carer');
    const supervisorUserId = dto.supervisorUserId ?? null;
    if (supervisorUserId) {
      const { data: eligible } = await this.listSupervisors();
      if (!eligible.some((u) => u.id === supervisorUserId)) {
        throw new BadRequestException('The supervisor must be an active user with the supervision.manage permission');
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.employeeEmployment.update({
        where: { id: employment.id },
        data: { supervisorUserId },
        select: { supervisor: PERSON },
      });
      await this.log(tx, user, AuditAction.SUPERVISION_SUPERVISOR_ASSIGNED, 'Employee', employeeId, meta, {
        from: employment.supervisorUserId,
        to: supervisorUserId,
      });
      return {
        message: supervisorUserId ? 'Supervisor set' : 'Supervisor removed',
        data: { supervisor: updated.supervisor },
      };
    });
  }

  // ─── Sessions ───────────────────────────────────────────────────────────────────────────────

  async listSessions(query: ListSupervisionSessionsQueryDto) {
    const rows = await this.prisma.supervisionSession.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.employeeId ? { attendees: { some: { employeeId: query.employeeId } } } : {}),
      },
      orderBy: [{ scheduledAt: 'desc' }],
      take: query.limit ?? 50,
      select: {
        id: true,
        format: true,
        status: true,
        scheduledAt: true,
        heldAt: true,
        completedAt: true,
        supervisorSignedAt: true,
        reviewType: { select: { id: true, name: true, code: true } },
        supervisor: PERSON,
        attendees: { select: { employeeId: true, signedAt: true, agrees: true, employee: EMPLOYEE_NAME } },
        _count: { select: { actions: { where: { status: 'OPEN' } } } },
      },
    });
    return {
      data: rows.map(({ _count, ...r }) => ({ ...r, openActions: _count.actions })),
    };
  }

  async getSession(user: RequestUser, id: string) {
    const settings = await this.orgSettings.getSupervisionSettings();
    const session = await this.findSessionOrThrow(this.prisma, id);
    return { data: this.present(session, user, settings) };
  }

  async createSession(user: RequestUser, dto: CreateSupervisionSessionDto, meta?: RequestAuditMeta) {
    const employeeIds = [...new Set(dto.employeeIds)];
    const format = dto.format ?? (employeeIds.length > 1 ? SupervisionFormat.GROUP : SupervisionFormat.ONE_TO_ONE);
    if (employeeIds.length > 1 && format !== SupervisionFormat.GROUP) {
      throw new BadRequestException('Choose the Group format for more than one carer');
    }
    const [type, employees, supervisor] = await Promise.all([
      this.prisma.reviewType.findFirst({
        where: { id: dto.reviewTypeId, deletedAt: null },
        select: { id: true, name: true, supervisionForm: { include: FORM_WITH_FIELDS } },
      }),
      this.prisma.employee.findMany({ where: { id: { in: employeeIds }, deletedAt: null }, select: { id: true } }),
      this.prisma.user.findFirst({ where: { id: dto.supervisorUserId ?? user.id, deletedAt: null }, select: { id: true } }),
    ]);
    if (!type) throw new NotFoundException('Review type not found');
    if (employees.length !== employeeIds.length) throw new NotFoundException('One or more carers not found');
    if (!supervisor) throw new NotFoundException('Supervisor not found');

    const form = this.usableForm(type.name, type.supervisionForm);
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.supervisionSession.create({
        data: {
          reviewTypeId: type.id,
          format,
          scheduledAt: dto.scheduledAt,
          supervisorUserId: supervisor.id,
          location: dto.location?.trim() || null,
          scheduledJobId: dto.scheduledJobId ?? null,
          createdById: user.id,
          ...this.formData(form),
          attendees: { create: employeeIds.map((employeeId) => ({ employeeId })) },
        },
      });
      await this.log(tx, user, AuditAction.SUPERVISION_SESSION_CREATED, 'SupervisionSession', session.id, meta, {
        reviewType: type.name,
        employeeIds,
        format,
        form: form.name,
      });
      const settings = await this.orgSettings.getSupervisionSettings();
      return { message: 'Supervision scheduled', data: this.present(await this.findSessionOrThrow(tx, session.id), user, settings) };
    });
  }

  async updateSession(user: RequestUser, id: string, dto: UpdateSupervisionSessionDto, meta?: RequestAuditMeta) {
    const settings = await this.orgSettings.getSupervisionSettings();
    if (dto.confidentialNotes !== undefined) this.assertConfidentialAccess(user, settings);
    return this.prisma.$transaction(async (tx) => {
      const found = await this.findSessionOrThrow(tx, id);
      this.assertEditable(found);
      const session = await this.refreshUnstartedForm(tx, found);
      let answers: Prisma.InputJsonValue | undefined;
      const answerPatch = dto.answers && Object.keys(dto.answers).length ? dto.answers : null;
      if (answerPatch) {
        const snapshot = parseSnapshot(session.formSnapshot);
        if (!snapshot) throw new BadRequestException('This session has no form to answer');
        const merged = mergeAnswers(snapshot, parseAnswers(session.answers), answerPatch);
        if (merged.unknownKeys.length) {
          throw new BadRequestException("Some answers are not questions on this session's form");
        }
        if (merged.invalidKeys.length) throw new BadRequestException('Some answers are not valid');
        answers = merged.answers;
      }
      const writingNotes = Boolean(answerPatch || dto.summary || dto.confidentialNotes);
      await tx.supervisionSession.update({
        where: { id },
        data: {
          ...(dto.format !== undefined ? { format: dto.format } : {}),
          ...(dto.scheduledAt !== undefined ? { scheduledAt: dto.scheduledAt } : {}),
          ...(dto.heldAt !== undefined ? { heldAt: dto.heldAt } : {}),
          ...(dto.durationMinutes !== undefined ? { durationMinutes: dto.durationMinutes } : {}),
          ...(dto.location !== undefined ? { location: dto.location?.trim() || null } : {}),
          ...(dto.scheduledJobId !== undefined ? { scheduledJobId: dto.scheduledJobId } : {}),
          ...(dto.summary !== undefined ? { summary: richTextOrNull(dto.summary) } : {}),
          ...(dto.confidentialNotes !== undefined ? { confidentialNotes: richTextOrNull(dto.confidentialNotes) } : {}),
          ...(answers !== undefined ? { answers } : {}),
          // Writing notes means the meeting is happening: move it on and stamp when it was held.
          ...(writingNotes && session.status === 'SCHEDULED'
            ? { status: 'IN_PROGRESS', heldAt: dto.heldAt ?? session.heldAt ?? new Date() }
            : {}),
          updatedById: user.id,
        },
      });
      await this.log(tx, user, AuditAction.SUPERVISION_SESSION_UPDATED, 'SupervisionSession', id, meta, {
        fields: Object.keys(dto).filter((k) => k !== 'confidentialNotes' && k !== 'answers'),
        answersChanged: answerPatch ? Object.keys(answerPatch) : [],
        confidentialNotesChanged: dto.confidentialNotes !== undefined,
      });
      return { message: 'Saved', data: this.present(await this.findSessionOrThrow(tx, id), user, settings) };
    });
  }

  async startSession(user: RequestUser, id: string, meta?: RequestAuditMeta) {
    return this.prisma.$transaction(async (tx) => {
      const session = await this.refreshUnstartedForm(tx, await this.findSessionOrThrow(tx, id));
      if (session.status !== 'SCHEDULED') throw new ConflictException('This session has already started');
      await tx.supervisionSession.update({
        where: { id },
        data: { status: 'IN_PROGRESS', heldAt: session.heldAt ?? new Date(), updatedById: user.id },
      });
      await this.log(tx, user, AuditAction.SUPERVISION_SESSION_UPDATED, 'SupervisionSession', id, meta, { started: true });
      const settings = await this.orgSettings.getSupervisionSettings();
      return { message: 'Session started', data: this.present(await this.findSessionOrThrow(tx, id), user, settings) };
    });
  }

  async supervisorSign(user: RequestUser, id: string, dto: SupervisorSignDto, meta?: RequestAuditMeta) {
    const settings = await this.orgSettings.getSupervisionSettings();
    return this.prisma.$transaction(async (tx) => {
      const session = await this.findSessionOrThrow(tx, id);
      this.assertEditable(session);
      if (session.supervisorUserId !== user.id) {
        throw new ForbiddenException('Only the supervisor named on this session can sign it');
      }
      if (settings.requireFormAnswers) {
        const missing = missingRequiredFields(parseSnapshot(session.formSnapshot), parseAnswers(session.answers));
        if (missing.length) {
          throw new BadRequestException(
            `Answer the required questions first: ${missing.map((m) => m.label).join(', ')}`,
          );
        }
      }
      const signedAt = new Date();
      await tx.supervisionSession.update({
        where: { id },
        data: {
          supervisorSignature: dto.signature,
          supervisorSignedAt: signedAt,
          heldAt: session.heldAt ?? signedAt,
          updatedById: user.id,
        },
      });
      await this.log(tx, user, AuditAction.SUPERVISION_SESSION_SIGNED, 'SupervisionSession', id, meta, { by: 'supervisor' });
      await this.settleStatus(tx, user, id, settings, meta);
      return { message: 'Signed', data: this.present(await this.findSessionOrThrow(tx, id), user, settings) };
    });
  }

  /** The carer signs on the supervisor's device (in person) or agrees / disagrees with a comment. */
  async attendeeSign(
    user: RequestUser,
    id: string,
    employeeId: string,
    dto: AttendeeSignDto,
    meta?: RequestAuditMeta,
  ) {
    const settings = await this.orgSettings.getSupervisionSettings();
    if (!dto.agrees && !settings.allowCarerDisagree) {
      throw new BadRequestException('Recording disagreement is turned off in Settings → Supervision');
    }
    if (dto.agrees && !dto.signature?.trim()) throw new BadRequestException('Signature is required');
    if (!dto.agrees && !dto.comment?.trim()) throw new BadRequestException('Say what the carer does not agree with');
    return this.prisma.$transaction(async (tx) => {
      const session = await this.findSessionOrThrow(tx, id);
      if (session.status !== 'AWAITING_SIGN_OFF') {
        throw new ConflictException('The supervisor signs first; then each carer signs');
      }
      const attendee = session.attendees.find((a) => a.employeeId === employeeId);
      if (!attendee) throw new NotFoundException('This carer is not part of the session');
      if (attendee.signedAt) throw new ConflictException('This carer has already signed');
      await tx.supervisionAttendee.update({
        where: { id: attendee.id },
        data: {
          signature: dto.signature?.trim() || null,
          signedAt: new Date(),
          agrees: dto.agrees,
          comment: dto.comment?.trim() || null,
        },
      });
      await this.log(tx, user, AuditAction.SUPERVISION_SESSION_SIGNED, 'SupervisionSession', id, meta, {
        by: 'carer',
        employeeId,
        agrees: dto.agrees,
      });
      await this.settleStatus(tx, user, id, settings, meta);
      return { message: 'Signed', data: this.present(await this.findSessionOrThrow(tx, id), user, settings) };
    });
  }

  async cancelSession(user: RequestUser, id: string, dto: CancelSupervisionSessionDto, meta?: RequestAuditMeta) {
    return this.prisma.$transaction(async (tx) => {
      const session = await this.findSessionOrThrow(tx, id);
      if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
        throw new ConflictException('A completed or cancelled session cannot be cancelled');
      }
      await tx.supervisionSession.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: dto.reason.trim(), updatedById: user.id },
      });
      await this.log(tx, user, AuditAction.SUPERVISION_SESSION_CANCELLED, 'SupervisionSession', id, meta, { reason: dto.reason });
      const settings = await this.orgSettings.getSupervisionSettings();
      return { message: 'Cancelled', data: this.present(await this.findSessionOrThrow(tx, id), user, settings) };
    });
  }

  /** Signed sessions are never edited; a dated addendum records any correction. */
  async addAddendum(user: RequestUser, id: string, dto: CreateSupervisionAddendumDto, meta?: RequestAuditMeta) {
    return this.prisma.$transaction(async (tx) => {
      const session = await this.findSessionOrThrow(tx, id);
      if (isSessionEditable(session.status)) {
        throw new BadRequestException('Edit the session directly until it is signed');
      }
      const addendum = await tx.supervisionAddendum.create({
        data: { sessionId: id, text: dto.text.trim(), createdById: user.id },
      });
      await this.log(tx, user, AuditAction.SUPERVISION_ADDENDUM_ADDED, 'SupervisionSession', id, meta, { addendumId: addendum.id });
      const settings = await this.orgSettings.getSupervisionSettings();
      return { message: 'Addendum added', data: this.present(await this.findSessionOrThrow(tx, id), user, settings) };
    });
  }

  // ─── Actions ────────────────────────────────────────────────────────────────────────────────

  async addAction(user: RequestUser, sessionId: string, dto: CreateSupervisionActionDto, meta?: RequestAuditMeta) {
    return this.prisma.$transaction(async (tx) => {
      const session = await this.findSessionOrThrow(tx, sessionId);
      if (session.status === 'CANCELLED') throw new ConflictException('This session was cancelled');
      if (!session.attendees.some((a) => a.employeeId === dto.employeeId)) {
        throw new BadRequestException('The action must be for a carer in this session');
      }
      const action = await tx.supervisionAction.create({
        data: {
          sessionId,
          employeeId: dto.employeeId,
          description: dto.description.trim(),
          owner: dto.owner ?? 'CARER',
          ownerName: dto.ownerName?.trim() || null,
          dueDate: dto.dueDate ?? null,
          createdById: user.id,
        },
        include: { employee: EMPLOYEE_NAME },
      });
      await this.log(tx, user, AuditAction.SUPERVISION_ACTION_ADDED, 'SupervisionAction', action.id, meta, { sessionId });
      return { message: 'Action added', data: action };
    });
  }

  async updateAction(user: RequestUser, actionId: string, dto: UpdateSupervisionActionDto, meta?: RequestAuditMeta) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.supervisionAction.findUnique({
        where: { id: actionId },
        include: { session: { select: { status: true, deletedAt: true } } },
      });
      if (!existing || existing.session.deletedAt) throw new NotFoundException('Action not found');
      // The wording of an action agreed in a signed session stays as signed; only follow-up changes.
      const wordingChange = dto.description !== undefined || dto.owner !== undefined || dto.ownerName !== undefined;
      if (wordingChange && !isSessionEditable(existing.session.status)) {
        throw new BadRequestException('This action was agreed in a signed session; add an addendum instead');
      }
      const closing = dto.status && dto.status !== 'OPEN' && existing.status === 'OPEN';
      const action = await tx.supervisionAction.update({
        where: { id: actionId },
        data: {
          ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
          ...(dto.owner !== undefined ? { owner: dto.owner } : {}),
          ...(dto.ownerName !== undefined ? { ownerName: dto.ownerName?.trim() || null } : {}),
          ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.completedNote !== undefined ? { completedNote: dto.completedNote?.trim() || null } : {}),
          ...(closing ? { completedAt: new Date() } : {}),
          ...(dto.status === 'OPEN' ? { completedAt: null } : {}),
          updatedById: user.id,
        },
        include: { employee: EMPLOYEE_NAME },
      });
      await this.log(tx, user, AuditAction.SUPERVISION_ACTION_UPDATED, 'SupervisionAction', actionId, meta, {
        fields: Object.keys(dto),
        status: dto.status,
      });
      return { message: 'Action updated', data: action };
    });
  }

  /** Open actions for one carer from earlier sessions (carried into the next supervision). */
  async openActions(employeeId: string) {
    const rows = await this.prisma.supervisionAction.findMany({
      where: { employeeId, status: 'OPEN', session: { deletedAt: null, status: { not: 'CANCELLED' } } },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      include: { session: { select: { id: true, heldAt: true, scheduledAt: true, reviewType: { select: { name: true } } } } },
    });
    return { data: rows };
  }

  // ─── Internals ──────────────────────────────────────────────────────────────────────────────

  /**
   * After a signature: move to AWAITING_SIGN_OFF or COMPLETED. On completion each carer's review
   * tracker for this type moves on: last done = held date, next due from the type's schedule and
   * that carer's start date (the next interval, the next probation milestone, or none after the last).
   */
  private async settleStatus(tx: Tx, user: RequestUser, id: string, settings: SupervisionSettings, meta?: RequestAuditMeta) {
    const session = await this.findSessionOrThrow(tx, id);
    const status = statusAfterSignature(session, settings);
    if (status === session.status) return;
    const completing = status === 'COMPLETED';
    await tx.supervisionSession.update({
      where: { id },
      data: { status, ...(completing ? { completedAt: new Date() } : {}) },
    });
    if (!completing) return;
    const heldAt = session.heldAt ?? session.supervisorSignedAt ?? new Date();
    const [schedule, employments] = await Promise.all([
      tx.reviewType.findUniqueOrThrow({ where: { id: session.reviewTypeId }, select: REVIEW_SCHEDULE_SELECT }),
      tx.employeeEmployment.findMany({
        where: { employeeId: { in: session.attendees.map((a) => a.employeeId) } },
        select: { employeeId: true, startDate: true },
      }),
    ]);
    const startOf = new Map(employments.map((e) => [e.employeeId, e.startDate]));
    const nextDueFor = new Map<string, Date | null>();
    for (const attendee of session.attendees) {
      const nextDue = scheduledNextDue(schedule as ReviewSchedule, {
        lastDone: heldAt,
        startDate: startOf.get(attendee.employeeId) ?? null,
      });
      nextDueFor.set(attendee.employeeId, nextDue);
      const tracker = await tx.employeeReview.findFirst({
        where: { employeeId: attendee.employeeId, reviewTypeId: session.reviewTypeId, deletedAt: null },
        orderBy: [{ lastDone: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      });
      // An older session finished late must not move a newer "last done" backwards.
      if (tracker?.lastDone && tracker.lastDone > heldAt) continue;
      const data = {
        lastDone: heldAt,
        nextDue,
        status: deriveReviewStatus({ lastDone: heldAt, nextDue }, new Date(), settings.dueSoonDays),
        notes: `${session.reviewType.name} recorded in CareFlow (held ${heldAt.toISOString().slice(0, 10)}, signed by ${[session.supervisor.firstName, session.supervisor.lastName].filter(Boolean).join(' ') || session.supervisor.email})`,
        reviewedById: session.supervisorUserId,
      };
      if (tracker) {
        await tx.employeeReview.update({ where: { id: tracker.id }, data: { ...data, updatedById: user.id } });
      } else {
        await tx.employeeReview.create({
          data: { ...data, employeeId: attendee.employeeId, reviewTypeId: session.reviewTypeId, createdById: user.id },
        });
      }
    }
    await this.log(tx, user, AuditAction.SUPERVISION_SESSION_COMPLETED, 'SupervisionSession', id, meta, {
      employeeIds: session.attendees.map((a) => a.employeeId),
      nextDue: Object.fromEntries(nextDueFor),
    });
    if (settings.autoScheduleNext && session.format !== 'GROUP') {
      await this.scheduleNext(tx, user, session, nextDueFor, meta);
    }
  }

  /**
   * Settings → Supervision → "Book the next session": each carer gets the next one-to-one of the
   * same type on their own due date (same time of day), with their named supervisor when they have
   * one. Skipped when nothing more is due (one-off, last milestone), when one is already booked,
   * or when the type's form cannot be used right now.
   */
  private async scheduleNext(
    tx: Tx,
    user: RequestUser,
    done: SessionDetail,
    nextDueFor: Map<string, Date | null>,
    meta?: RequestAuditMeta,
  ) {
    if (![...nextDueFor.values()].some(Boolean)) return;
    const type = await tx.reviewType.findFirst({
      where: { id: done.reviewTypeId },
      select: { name: true, supervisionForm: { include: FORM_WITH_FIELDS } },
    });
    let form: FormWithFields;
    try {
      form = this.usableForm(type?.name ?? done.reviewType.name, type?.supervisionForm ?? null);
    } catch (err) {
      this.logger.warn(`Next ${done.reviewType.name} not booked after ${done.id}: ${(err as Error).message}`);
      return;
    }
    const from = done.scheduledAt;
    for (const attendee of done.attendees) {
      const nextDue = nextDueFor.get(attendee.employeeId);
      if (!nextDue) continue;
      const scheduledAt = new Date(nextDue);
      scheduledAt.setUTCHours(from.getUTCHours(), from.getUTCMinutes(), 0, 0);
      const booked = await tx.supervisionSession.findFirst({
        where: {
          reviewTypeId: done.reviewTypeId,
          deletedAt: null,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          attendees: { some: { employeeId: attendee.employeeId } },
        },
        select: { id: true },
      });
      if (booked) continue;
      const employment = await tx.employeeEmployment.findFirst({
        where: { employeeId: attendee.employeeId },
        select: { supervisorUserId: true, supervisor: { select: { isActive: true, deletedAt: true } } },
      });
      const named = employment?.supervisor?.isActive && !employment.supervisor.deletedAt ? employment.supervisorUserId : null;
      const next = await tx.supervisionSession.create({
        data: {
          reviewTypeId: done.reviewTypeId,
          format: done.format,
          scheduledAt,
          supervisorUserId: named ?? done.supervisorUserId,
          location: done.location,
          createdById: user.id,
          ...this.formData(form),
          attendees: { create: [{ employeeId: attendee.employeeId }] },
        },
      });
      await this.log(tx, user, AuditAction.SUPERVISION_SESSION_CREATED, 'SupervisionSession', next.id, meta, {
        reviewType: done.reviewType.name,
        employeeIds: [attendee.employeeId],
        format: done.format,
        form: form.name,
        autoScheduledFrom: done.id,
      });
    }
  }

  /** The review type's form, or a clear reason it cannot be used yet. */
  private usableForm(typeName: string, form: FormWithFields | null): FormWithFields {
    if (!form || form.deletedAt || !form.isActive) {
      throw new BadRequestException(
        `No form is set for ${typeName}. Choose one in Settings → Supervision (forms are built in Care Pathway → Form builder).`,
      );
    }
    if (form.status !== 'PUBLISHED') {
      throw new BadRequestException(
        `The ${form.name} form has unpublished changes. Publish it in Care Pathway → Form builder first.`,
      );
    }
    if (!form.currentVersion?.sections.some((s) => s.fields.length)) {
      throw new BadRequestException(`The ${form.name} form has no questions yet.`);
    }
    return form;
  }

  private formData(form: FormWithFields) {
    return {
      formId: form.id,
      formVersionId: form.currentVersionId,
      formSnapshot: snapshotFromForm(form) as unknown as Prisma.InputJsonValue,
    };
  }

  /**
   * A session booked weeks ahead picks up a form republished since, as long as nobody has
   * answered anything yet. Once answering starts the snapshot is fixed.
   */
  private async refreshUnstartedForm(tx: Tx, session: SessionDetail): Promise<SessionDetail> {
    if (session.status !== 'SCHEDULED' || Object.keys(parseAnswers(session.answers)).length) return session;
    const type = await tx.reviewType.findFirst({
      where: { id: session.reviewTypeId },
      select: { supervisionForm: { include: FORM_WITH_FIELDS } },
    });
    const form = type?.supervisionForm;
    if (!form || form.deletedAt || form.status !== 'PUBLISHED') return session;
    const current = parseSnapshot(session.formSnapshot);
    const publishedAt = form.lastPublishedAt?.toISOString() ?? null;
    if (current && current.formId === form.id && current.publishedAt === publishedAt) return session;
    await tx.supervisionSession.update({ where: { id: session.id }, data: this.formData(form) });
    return this.findSessionOrThrow(tx, session.id);
  }

  private async findSessionOrThrow(db: Tx | PrismaService, id: string): Promise<SessionDetail> {
    const session = await db.supervisionSession.findFirst({ where: { id, deletedAt: null }, include: SESSION_DETAIL });
    if (!session) throw new NotFoundException('Supervision session not found');
    return session;
  }

  private assertEditable(session: { status: SessionDetail['status'] }) {
    if (!isSessionEditable(session.status)) {
      throw new ConflictException(
        session.status === 'CANCELLED'
          ? 'This session was cancelled'
          : 'This session has been signed; add an addendum to record a correction',
      );
    }
  }

  private canReadConfidential(user: RequestUser, settings: SupervisionSettings) {
    return settings.confidentialNotesEnabled && (user.permissions ?? []).includes('supervision.read_confidential');
  }

  private assertConfidentialAccess(user: RequestUser, settings: SupervisionSettings) {
    if (!settings.confidentialNotesEnabled) {
      throw new BadRequestException('Confidential notes are turned off in Settings → Supervision');
    }
    if (!this.canReadConfidential(user, settings)) {
      throw new ForbiddenException('You need supervision.read_confidential to write confidential notes');
    }
  }

  /** Strips confidential notes for users without access and adds what the page needs to know. */
  private present(session: SessionDetail, user: RequestUser, settings: SupervisionSettings) {
    const confidential = this.canReadConfidential(user, settings);
    const snapshot = parseSnapshot(session.formSnapshot);
    const answers = parseAnswers(session.answers);
    return {
      ...session,
      formSnapshot: snapshot,
      answers,
      confidentialNotes: confidential ? session.confidentialNotes : null,
      permissions: {
        canReadConfidential: confidential,
        canEdit: isSessionEditable(session.status),
        isSupervisor: session.supervisorUserId === user.id,
      },
      missingRequired: missingRequiredFields(snapshot, answers),
      formProgress: formProgress(snapshot, answers),
      settings,
    };
  }

  private log(
    tx: Tx,
    user: RequestUser,
    action: AuditAction,
    recordType: string,
    recordId: string,
    meta: RequestAuditMeta | undefined,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.logAudit({
      tx,
      userId: user.id,
      module: AuditModule.SUPERVISION,
      action,
      recordType,
      recordId,
      metadata,
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
  }
}
