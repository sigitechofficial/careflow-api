import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IncidentCandour, IncidentCandourAttempt, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { dayKeyInTimeZone } from '../common/utils/operational-day.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  assertIncidentEditable,
  canViewIncidentPrivacy,
  hasIncidentPermission,
} from './incident-access.util';
import {
  CANDOUR_DECISION_LABELS,
  CANDOUR_UNABLE_REASON_LABELS,
  candourCloseCheck,
  candourDateProblem,
  candourDecisionProblems,
  candourHintReasons,
  candourMissing,
  candourOverdue,
  candourStatus,
  candourSubjectIds,
  type CandourDecision,
  type CandourState,
  type CandourStatus,
} from './incident-candour.util';
import {
  applyCandourToSharing,
  candourSharingRow,
  type CandourOutcomeLink,
  type OutcomeSharingEntry,
} from './incident-outcome.util';
import type {
  CandourAttemptDto,
  CandourDecisionDto,
  CandourResultsDto,
  CandourToldDto,
  CandourUnableDto,
  CandourWrittenDto,
} from './dto/incident-candour.dto';

const DAY = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const trimOrNull = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);

type CandourRow = IncidentCandour & { attempts: IncidentCandourAttempt[] };

/** What the rules need from the incident. */
const INCIDENT_SELECT = {
  id: true,
  referenceNumber: true,
  status: true,
  privacyLevel: true,
  severity: true,
  reportedAt: true,
  occurredAt: true,
  affectedPersonKinds: true,
  primaryServiceUserId: true,
  involvedServiceUserIds: true,
  admittedToHospital: true,
  takenToAe: true,
  category: { select: { key: true } },
  subtype: { select: { key: true } },
  investigation: { select: { id: true } },
} satisfies Prisma.IncidentSelect;

type CandourIncident = Prisma.IncidentGetPayload<{ select: typeof INCIDENT_SELECT }>;

/**
 * Duty of Candour (Regulation 20) — one record per affected service user. Rules live in
 * incident-candour.util.ts; this service loads, checks access and records each step.
 */
@Injectable()
export class IncidentCandourService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  // --- reading ---------------------------------------------------------------

  /** The incident's Duty of Candour panel (used in GET /incidents/:id). */
  async forIncident(incidentId: string) {
    const incident = await this.prisma.incident.findFirst({
      where: { id: incidentId },
      select: INCIDENT_SELECT,
    });
    if (!incident) return null;
    const [rows, tz, overdueDays, seriousInjury] = await Promise.all([
      this.prisma.incidentCandour.findMany({
        where: { incidentId, deletedAt: null },
        include: { attempts: { orderBy: { attemptedOn: 'asc' } } },
      }),
      this.orgSettings.getOperationalTimezone(),
      this.overdueDays(),
      this.prisma.incidentInjury.count({
        where: { incidentId, deletedAt: null, personKind: 'SERVICE_USER', injurySeverity: 'SERIOUS' },
      }),
    ]);
    const today = dayKeyInTimeZone(new Date(), tz);
    const subjects = candourSubjectIds(incident);
    const ids = [...new Set([...subjects, ...rows.map((r) => r.serviceUserId)])];
    const people = ids.length
      ? await this.prisma.serviceUser.findMany({
          where: { id: { in: ids } },
          select: { id: true, firstName: true, lastName: true, dateOfDeath: true },
        })
      : [];
    const personById = new Map(people.map((p) => [p.id, p]));
    const employeeIds = rows.flatMap((r) =>
      [r.toldByEmployeeId, r.writtenByEmployeeId, r.healthProfessionalEmployeeId, ...r.attempts.map((a) => a.byEmployeeId)].filter(
        (v): v is string => !!v,
      ),
    );
    const employeeNames = await this.employeeNames(employeeIds);
    const attachmentIds = rows.flatMap((r) =>
      [r.writtenAttachmentId, r.resultsAttachmentId].filter((v): v is string => !!v),
    );
    const attachments = attachmentIds.length
      ? await this.prisma.incidentAttachment.findMany({
          where: { id: { in: attachmentIds } },
          select: { id: true, originalName: true, deletedAt: true },
        })
      : [];
    const attachmentById = new Map(attachments.map((a) => [a.id, a]));

    const records = ids.map((serviceUserId) => {
      const row = rows.find((r) => r.serviceUserId === serviceUserId) ?? null;
      const person = personById.get(serviceUserId);
      const state = this.state(row);
      const status = row ? candourStatus(state) : ('NOT_DECIDED' as CandourStatus);
      return {
        serviceUserId,
        serviceUserName: person ? `${person.firstName} ${person.lastName}`.trim() : 'Service user',
        /** False when the person is no longer on the incident (kept as history). */
        onIncident: subjects.includes(serviceUserId),
        deceased: this.isDeceased(incident, serviceUserId, person?.dateOfDeath ?? null),
        status,
        missing: row ? candourMissing(state) : [],
        overdue: candourOverdue({
          decision: row?.decision ?? null,
          toldOn: DAY(row?.toldOn),
          unableToNotify: row?.unableToNotify ?? false,
          dutyStartedDay: row?.dutyStartedAt ? dayKeyInTimeZone(row.dutyStartedAt, tz) : null,
          today,
          overdueDays,
        }),
        record: row ? this.mapRow(row, employeeNames, attachmentById) : null,
      };
    });

    return {
      applies: subjects.length > 0,
      overdueDays,
      hintReasons: candourHintReasons({
        severity: incident.severity,
        categoryKey: incident.category?.key ?? null,
        subtypeKey: incident.subtype?.key ?? null,
        admittedToHospital: incident.admittedToHospital,
        takenToAe: incident.takenToAe,
        seriousServiceUserInjury: seriousInjury > 0,
      }),
      hasInvestigation: !!incident.investigation,
      records,
      /** "Outcome shared with" rows that come from results letters (read-only on the Outcome tab). */
      outcomeRows: (await this.outcomeLinks(incidentId)).map(candourSharingRow),
    };
  }

  /** Results letters (step 3) — each is the outcome being shared with that person. */
  async outcomeLinks(incidentId: string): Promise<CandourOutcomeLink[]> {
    const rows = await this.prisma.incidentCandour.findMany({
      where: {
        incidentId,
        deletedAt: null,
        decision: 'YES',
        resultsSharedOn: { not: null },
        resultsAttachmentId: { not: null },
      },
    });
    if (!rows.length) return [];
    const people = await this.prisma.serviceUser.findMany({
      where: { id: { in: rows.map((r) => r.serviceUserId) } },
      select: { id: true, firstName: true, lastName: true },
    });
    const nameOf = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));
    return rows.map((r) => {
      const toRepresentative = r.toldPersonKind === 'REPRESENTATIVE';
      return {
        serviceUserId: r.serviceUserId,
        toldPersonKind: toRepresentative ? 'REPRESENTATIVE' : 'SERVICE_USER',
        name: toRepresentative ? (r.toldPersonName ?? 'Representative') : (nameOf.get(r.serviceUserId) ?? 'Service user'),
        sharedOn: DAY(r.resultsSharedOn)!,
        candourMethod: r.resultsMethod ?? 'POST',
        attachmentId: r.resultsAttachmentId!,
      };
    });
  }

  /** Keep a saved outcome's "Outcome shared with" in step with the results letters. */
  private async syncOutcome(incidentId: string) {
    const outcome = await this.prisma.incidentOutcome.findUnique({
      where: { incidentId },
      select: { id: true, outcomeSharing: true },
    });
    if (!outcome) return;
    const current = (Array.isArray(outcome.outcomeSharing) ? outcome.outcomeSharing : []) as unknown as OutcomeSharingEntry[];
    const links = await this.outcomeLinks(incidentId);
    if (!links.length && !current.some((e) => e.source === 'CANDOUR')) return;
    const next = applyCandourToSharing(current, links);
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    await this.prisma.incidentOutcome.update({
      where: { id: outcome.id },
      data: { outcomeSharing: next as unknown as Prisma.InputJsonValue },
    });
  }

  /**
   * Close check (called when the incident is being closed). Only people still on the incident
   * count. Returns the names that block and those still in progress.
   */
  async closeCheck(incidentId: string) {
    const panel = await this.forIncident(incidentId);
    if (!panel) return { blocking: [], incomplete: [] };
    return candourCloseCheck(
      panel.records
        .filter((r) => r.onIncident)
        .map((r) => ({ name: r.serviceUserName, status: r.status })),
    );
  }

  /** Overdue incident ids (for the list filter and Dashboard count). */
  async overdueIncidentIds(): Promise<string[]> {
    const days = await this.overdueDays();
    if (days == null) return [];
    const tz = await this.orgSettings.getOperationalTimezone();
    const today = dayKeyInTimeZone(new Date(), tz);
    const rows = await this.prisma.incidentCandour.findMany({
      where: {
        deletedAt: null,
        decision: { in: ['YES', 'NOT_KNOWN'] },
        toldOn: null,
        unableToNotify: false,
        dutyStartedAt: { not: null },
        incident: { deletedAt: null, status: { not: 'CLOSED' } },
      },
      select: { incidentId: true, dutyStartedAt: true },
    });
    return [
      ...new Set(
        rows
          .filter((r) =>
            candourOverdue({
              decision: 'YES',
              toldOn: null,
              unableToNotify: false,
              dutyStartedDay: dayKeyInTimeZone(r.dutyStartedAt!, tz),
              today,
              overdueDays: days,
            }),
          )
          .map((r) => r.incidentId),
      ),
    ];
  }

  // --- writing ---------------------------------------------------------------

  async decide(
    user: RequestUser,
    incidentId: string,
    serviceUserId: string,
    dto: CandourDecisionDto,
    meta?: RequestAuditMeta,
  ) {
    this.requireAny(user, ['incidents.review'], 'decide Duty of Candour');
    const incident = await this.loadForEdit(user, incidentId);
    const existing = await this.findRow(incidentId, serviceUserId);
    if (!existing && !candourSubjectIds(incident).includes(serviceUserId)) {
      throw new BadRequestException('This service user is not an affected person on the incident');
    }
    const decision = dto.decision as CandourDecision;
    const problems = candourDecisionProblems({
      decision,
      decisionReason: dto.decisionReason,
      harmTypes: dto.harmTypes,
      healthProfessionalName: dto.healthProfessionalName,
      healthProfessionalRole: dto.healthProfessionalRole,
    });
    if (problems.length) throw new BadRequestException(`Add ${problems.join(', ')}`);
    const changing = !!existing;
    const changeReason = this.requireChangeReason(changing, dto.changeReason);

    // The duty counts from the report, or from the day it became Yes after a No.
    const dutyApplies = decision === 'YES' || decision === 'NOT_KNOWN';
    const wasNotRequired = existing && (existing.decision === 'NO' || existing.decision === 'NOT_APPLICABLE');
    const dutyStartedAt = !dutyApplies
      ? null
      : existing?.dutyStartedAt && !wasNotRequired
        ? existing.dutyStartedAt
        : wasNotRequired
          ? new Date()
          : incident.reportedAt;

    const data = {
      decision,
      // Yes is explained by the harms + health professional; a reason left over from Not known is dropped.
      decisionReason: decision === 'YES' ? null : trimOrNull(dto.decisionReason),
      harmTypes: decision === 'YES' ? [...new Set(dto.harmTypes ?? [])] : [],
      healthProfessionalName: trimOrNull(dto.healthProfessionalName),
      healthProfessionalRole: trimOrNull(dto.healthProfessionalRole),
      healthProfessionalEmployeeId: dto.healthProfessionalEmployeeId ?? null,
      decidedById: user.id,
      decidedAt: new Date(),
      dutyStartedAt,
      updatedById: user.id,
    };
    const row = existing
      ? await this.prisma.incidentCandour.update({
          where: { id: existing.id },
          data,
          include: { attempts: true },
        })
      : await this.prisma.incidentCandour.create({
          data: { ...data, incidentId, serviceUserId, createdById: user.id },
          include: { attempts: true },
        });
    const name = await this.serviceUserName(serviceUserId);
    const label = CANDOUR_DECISION_LABELS[decision];
    await this.log(
      user.id,
      incidentId,
      changing && existing.decision !== decision
        ? `Duty of Candour for ${name} changed: ${CANDOUR_DECISION_LABELS[existing.decision as CandourDecision] ?? existing.decision} → ${label} — ${changeReason}`
        : changing
          ? `Duty of Candour for ${name} updated (${label}) — ${changeReason}`
          : `Duty of Candour for ${name}: ${label}${data.decisionReason ? ` — ${data.decisionReason}` : ''}${data.healthProfessionalName ? ` (health professional: ${data.healthProfessionalName}, ${data.healthProfessionalRole})` : ''}`,
      meta,
    );
    return { message: 'Duty of Candour decision saved', data: { status: candourStatus(this.state(row)) } };
  }

  async recordTold(
    user: RequestUser,
    incidentId: string,
    serviceUserId: string,
    dto: CandourToldDto,
    meta?: RequestAuditMeta,
  ) {
    const { incident, row, today } = await this.loadStep(user, incidentId, serviceUserId);
    if (!dto.factsExplained || !dto.enquiriesExplained || !dto.apologyGiven) {
      throw new BadRequestException(
        'Telling them in person must cover what happened, the further enquiries and an apology (Regulation 20(3))',
      );
    }
    const person = await this.prisma.serviceUser.findUnique({
      where: { id: serviceUserId },
      select: { dateOfDeath: true },
    });
    if (dto.toldPersonKind === 'SERVICE_USER' && this.isDeceased(incident, serviceUserId, person?.dateOfDeath ?? null)) {
      throw new BadRequestException('The service user has died — record the family member or representative told');
    }
    if (dto.toldPersonKind === 'REPRESENTATIVE' && !trimOrNull(dto.toldPersonName)) {
      throw new BadRequestException('Add the name of the person told');
    }
    const dateProblem = candourDateProblem({
      label: 'Told on',
      date: dto.toldOn.slice(0, 10),
      today,
      incidentDay: await this.incidentDay(incident),
    });
    if (dateProblem) throw new BadRequestException(dateProblem);
    await this.assertEmployee(dto.toldByEmployeeId);
    const changeReason = this.requireChangeReason(!!row.toldOn, dto.changeReason);
    const updated = await this.prisma.incidentCandour.update({
      where: { id: row.id },
      data: {
        toldOn: this.day(dto.toldOn),
        toldByEmployeeId: dto.toldByEmployeeId,
        toldPersonKind: dto.toldPersonKind,
        toldPersonName: dto.toldPersonKind === 'REPRESENTATIVE' ? trimOrNull(dto.toldPersonName) : null,
        toldRelationship: dto.toldPersonKind === 'REPRESENTATIVE' ? trimOrNull(dto.toldRelationship) : null,
        factsExplained: true,
        enquiriesExplained: true,
        apologyGiven: true,
        supportOffered: dto.supportOffered.trim(),
        updatedById: user.id,
      },
      include: { attempts: true },
    });
    const who =
      dto.toldPersonKind === 'REPRESENTATIVE'
        ? `${trimOrNull(dto.toldPersonName)}${trimOrNull(dto.toldRelationship) ? ` (${trimOrNull(dto.toldRelationship)})` : ''}`
        : 'the service user';
    await this.log(
      user.id,
      incidentId,
      `Duty of Candour: ${who} told in person on ${dto.toldOn.slice(0, 10)}, with an apology${changeReason ? ` — changed: ${changeReason}` : ''}`,
      meta,
    );
    return { message: 'Recorded', data: { status: candourStatus(this.state(updated)) } };
  }

  async recordWritten(
    user: RequestUser,
    incidentId: string,
    serviceUserId: string,
    dto: CandourWrittenDto,
    meta?: RequestAuditMeta,
  ) {
    const { incident, row, today } = await this.loadStep(user, incidentId, serviceUserId);
    if (!row.toldOn) {
      throw new BadRequestException('Record telling them in person first — the letter follows it (Regulation 20(4))');
    }
    const dateProblem = candourDateProblem({
      label: 'Letter sent on',
      date: dto.writtenSentOn.slice(0, 10),
      today,
      incidentDay: await this.incidentDay(incident),
      notBefore: { date: DAY(row.toldOn), label: 'the day they were told' },
    });
    if (dateProblem) throw new BadRequestException(dateProblem);
    await this.assertEmployee(dto.writtenByEmployeeId);
    await this.assertAttachment(incidentId, dto.writtenAttachmentId);
    const changeReason = this.requireChangeReason(!!row.writtenSentOn, dto.changeReason);
    const updated = await this.prisma.incidentCandour.update({
      where: { id: row.id },
      data: {
        writtenSentOn: this.day(dto.writtenSentOn),
        writtenByEmployeeId: dto.writtenByEmployeeId,
        writtenMethod: dto.writtenMethod,
        writtenAttachmentId: dto.writtenAttachmentId,
        updatedById: user.id,
      },
      include: { attempts: true },
    });
    await this.log(
      user.id,
      incidentId,
      `Duty of Candour: written follow-up sent on ${dto.writtenSentOn.slice(0, 10)} (${dto.writtenMethod.toLowerCase()})${changeReason ? ` — changed: ${changeReason}` : ''}`,
      meta,
    );
    return { message: 'Recorded', data: { status: candourStatus(this.state(updated)) } };
  }

  async recordResults(
    user: RequestUser,
    incidentId: string,
    serviceUserId: string,
    dto: CandourResultsDto,
    meta?: RequestAuditMeta,
  ) {
    const { incident, row, today } = await this.loadStep(user, incidentId, serviceUserId);
    if (!row.writtenSentOn) {
      throw new BadRequestException('Record the written follow-up first');
    }
    const noFurther = trimOrNull(dto.noFurtherEnquiriesReason);
    if (noFurther) {
      if (incident.investigation) {
        throw new BadRequestException(
          'There is an investigation — share its results instead of "no further enquiries"',
        );
      }
    } else {
      if (!dto.resultsSharedOn || !dto.resultsMethod || !dto.resultsAttachmentId) {
        throw new BadRequestException('Add the date, how it was sent and a copy of the results letter');
      }
      const dateProblem = candourDateProblem({
        label: 'Results shared on',
        date: dto.resultsSharedOn.slice(0, 10),
        today,
        incidentDay: await this.incidentDay(incident),
        notBefore: { date: DAY(row.writtenSentOn), label: 'the written follow-up' },
      });
      if (dateProblem) throw new BadRequestException(dateProblem);
      await this.assertAttachment(incidentId, dto.resultsAttachmentId);
    }
    const changeReason = this.requireChangeReason(
      !!(row.resultsSharedOn || row.noFurtherEnquiriesReason),
      dto.changeReason,
    );
    const updated = await this.prisma.incidentCandour.update({
      where: { id: row.id },
      data: noFurther
        ? {
            noFurtherEnquiriesReason: noFurther,
            resultsSharedOn: null,
            resultsMethod: null,
            resultsAttachmentId: null,
            updatedById: user.id,
          }
        : {
            noFurtherEnquiriesReason: null,
            resultsSharedOn: this.day(dto.resultsSharedOn!),
            resultsMethod: dto.resultsMethod!,
            resultsAttachmentId: dto.resultsAttachmentId!,
            updatedById: user.id,
          },
      include: { attempts: true },
    });
    await this.log(
      user.id,
      incidentId,
      noFurther
        ? `Duty of Candour: no further enquiries — ${noFurther}${changeReason ? ` (changed: ${changeReason})` : ''}`
        : `Duty of Candour: results shared on ${dto.resultsSharedOn!.slice(0, 10)}${changeReason ? ` — changed: ${changeReason}` : ''}`,
      meta,
    );
    return { message: 'Recorded', data: { status: candourStatus(this.state(updated)) } };
  }

  /** Regulation 20(5): the person can't be contacted or declines to speak. */
  async recordUnable(
    user: RequestUser,
    incidentId: string,
    serviceUserId: string,
    dto: CandourUnableDto,
    meta?: RequestAuditMeta,
  ) {
    const { row } = await this.loadStep(user, incidentId, serviceUserId);
    if (dto.unableToNotify && row.toldOn) {
      throw new BadRequestException('They were already told in person — change that step instead');
    }
    if (dto.unableToNotify && !dto.unableReason) {
      throw new BadRequestException('Choose why they could not be told');
    }
    if (!dto.unableToNotify && !row.unableToNotify) {
      throw new BadRequestException('Nothing to change');
    }
    const changeReason = this.requireChangeReason(row.unableToNotify, dto.changeReason);
    const updated = await this.prisma.incidentCandour.update({
      where: { id: row.id },
      data: {
        unableToNotify: dto.unableToNotify,
        unableReason: dto.unableToNotify ? dto.unableReason! : null,
        unableNote: dto.unableToNotify ? trimOrNull(dto.unableNote) : null,
        updatedById: user.id,
      },
      include: { attempts: true },
    });
    await this.log(
      user.id,
      incidentId,
      dto.unableToNotify
        ? `Duty of Candour: could not tell them — ${CANDOUR_UNABLE_REASON_LABELS[dto.unableReason as keyof typeof CANDOUR_UNABLE_REASON_LABELS]}${changeReason ? ` (changed: ${changeReason})` : ''}`
        : `Duty of Candour: they can be told after all — ${changeReason}`,
      meta,
    );
    return { message: 'Recorded', data: { status: candourStatus(this.state(updated)) } };
  }

  async addAttempt(
    user: RequestUser,
    incidentId: string,
    serviceUserId: string,
    dto: CandourAttemptDto,
    meta?: RequestAuditMeta,
  ) {
    const { incident, row, today } = await this.loadStep(user, incidentId, serviceUserId);
    const dateProblem = candourDateProblem({
      label: 'Attempt date',
      date: dto.attemptedOn.slice(0, 10),
      today,
      incidentDay: await this.incidentDay(incident),
    });
    if (dateProblem) throw new BadRequestException(dateProblem);
    if (dto.byEmployeeId) await this.assertEmployee(dto.byEmployeeId);
    await this.prisma.incidentCandourAttempt.create({
      data: {
        candourId: row.id,
        attemptedOn: this.day(dto.attemptedOn),
        method: dto.method,
        byEmployeeId: dto.byEmployeeId ?? null,
        outcome: dto.outcome.trim(),
        createdById: user.id,
      },
    });
    await this.log(
      user.id,
      incidentId,
      `Duty of Candour: contact attempt on ${dto.attemptedOn.slice(0, 10)} (${dto.method.toLowerCase()}) — ${dto.outcome.trim()}`,
      meta,
    );
    return { message: 'Attempt recorded' };
  }

  // --- helpers ---------------------------------------------------------------

  private state(row: CandourRow | null): CandourState {
    return {
      decision: row?.decision ?? null,
      toldOn: DAY(row?.toldOn),
      toldByEmployeeId: row?.toldByEmployeeId ?? null,
      toldPersonKind: row?.toldPersonKind ?? null,
      factsExplained: row?.factsExplained ?? false,
      enquiriesExplained: row?.enquiriesExplained ?? false,
      apologyGiven: row?.apologyGiven ?? false,
      supportOffered: row?.supportOffered ?? null,
      writtenSentOn: DAY(row?.writtenSentOn),
      writtenMethod: row?.writtenMethod ?? null,
      writtenAttachmentId: row?.writtenAttachmentId ?? null,
      resultsSharedOn: DAY(row?.resultsSharedOn),
      resultsAttachmentId: row?.resultsAttachmentId ?? null,
      noFurtherEnquiriesReason: row?.noFurtherEnquiriesReason ?? null,
      unableToNotify: row?.unableToNotify ?? false,
      unableReason: row?.unableReason ?? null,
      attemptCount: row?.attempts.length ?? 0,
    };
  }

  private mapRow(
    row: CandourRow,
    employeeNames: Map<string, string>,
    attachments: Map<string, { id: string; originalName: string; deletedAt: Date | null }>,
  ) {
    const att = (id: string | null) =>
      id ? { id, name: attachments.get(id)?.originalName ?? 'Letter' } : null;
    const emp = (id: string | null) => (id ? { id, name: employeeNames.get(id) ?? 'Staff member' } : null);
    return {
      id: row.id,
      decision: row.decision,
      decisionReason: row.decisionReason,
      harmTypes: row.harmTypes,
      healthProfessionalName: row.healthProfessionalName,
      healthProfessionalRole: row.healthProfessionalRole,
      healthProfessional: emp(row.healthProfessionalEmployeeId),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      dutyStartedAt: row.dutyStartedAt?.toISOString() ?? null,
      toldOn: DAY(row.toldOn),
      toldBy: emp(row.toldByEmployeeId),
      toldPersonKind: row.toldPersonKind,
      toldPersonName: row.toldPersonName,
      toldRelationship: row.toldRelationship,
      factsExplained: row.factsExplained,
      enquiriesExplained: row.enquiriesExplained,
      apologyGiven: row.apologyGiven,
      supportOffered: row.supportOffered,
      writtenSentOn: DAY(row.writtenSentOn),
      writtenBy: emp(row.writtenByEmployeeId),
      writtenMethod: row.writtenMethod,
      writtenAttachment: att(row.writtenAttachmentId),
      resultsSharedOn: DAY(row.resultsSharedOn),
      resultsMethod: row.resultsMethod,
      resultsAttachment: att(row.resultsAttachmentId),
      noFurtherEnquiriesReason: row.noFurtherEnquiriesReason,
      unableToNotify: row.unableToNotify,
      unableReason: row.unableReason,
      unableNote: row.unableNote,
      attempts: row.attempts.map((a) => ({
        id: a.id,
        attemptedOn: DAY(a.attemptedOn),
        method: a.method,
        by: emp(a.byEmployeeId),
        outcome: a.outcome,
      })),
    };
  }

  /** Steps need a Yes / Not known decision first; the dates themselves may be earlier. */
  private async loadStep(user: RequestUser, incidentId: string, serviceUserId: string) {
    this.requireAny(user, ['incidents.review', 'incidents.close'], 'record Duty of Candour');
    const incident = await this.loadForEdit(user, incidentId);
    const row = await this.findRow(incidentId, serviceUserId);
    if (!row || (row.decision !== 'YES' && row.decision !== 'NOT_KNOWN')) {
      throw new BadRequestException('Decide that Duty of Candour applies (Yes or Not known yet) first');
    }
    const today = dayKeyInTimeZone(new Date(), await this.orgSettings.getOperationalTimezone());
    return { incident, row, today };
  }

  private async loadForEdit(user: RequestUser, incidentId: string): Promise<CandourIncident> {
    const incident = await this.prisma.incident.findFirst({
      where: { id: incidentId, deletedAt: null },
      select: INCIDENT_SELECT,
    });
    if (!incident || !canViewIncidentPrivacy(user, incident)) {
      throw new NotFoundException('Incident not found');
    }
    try {
      await this.orgScope.assertIncidentInScope(this.orgScope.fromRequestUser(user), incident.id);
    } catch (err) {
      if (err instanceof NotFoundException) throw new NotFoundException('Incident not found');
      throw err;
    }
    assertIncidentEditable(incident);
    return incident;
  }

  private findRow(incidentId: string, serviceUserId: string) {
    return this.prisma.incidentCandour.findFirst({
      where: { incidentId, serviceUserId, deletedAt: null },
      include: { attempts: true },
    });
  }

  private requireAny(user: RequestUser, permissions: string[], what: string) {
    if (!permissions.some((p) => hasIncidentPermission(user, p))) {
      throw new ForbiddenException(`You do not have permission to ${what}`);
    }
  }

  private requireChangeReason(changing: boolean, reason?: string): string | null {
    if (!changing) return null;
    const r = reason?.trim();
    if (!r || r.length < 3) throw new BadRequestException('Say why this is being changed');
    return r;
  }

  private isDeceased(incident: CandourIncident, serviceUserId: string, dateOfDeath: Date | null) {
    return (
      !!dateOfDeath ||
      (incident.category?.key === 'DEATH' && incident.primaryServiceUserId === serviceUserId)
    );
  }

  private async incidentDay(incident: CandourIncident) {
    return dayKeyInTimeZone(incident.occurredAt, await this.orgSettings.getOperationalTimezone());
  }

  private day(value: string) {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }

  private async overdueDays(): Promise<number | null> {
    const row = await this.prisma.organisationGeneralSettings.findFirst({
      select: { incidentCandourOverdueDays: true },
    });
    return row?.incidentCandourOverdueDays ?? null;
  }

  private async assertEmployee(id: string) {
    const emp = await this.prisma.employee.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!emp) throw new BadRequestException('That staff member was not found');
  }

  /** The letter copy must be a document on this incident (Supporting records). */
  private async assertAttachment(incidentId: string, attachmentId: string) {
    const att = await this.prisma.incidentAttachment.findFirst({
      where: { id: attachmentId, incidentId, deletedAt: null },
      select: { id: true },
    });
    if (!att) throw new BadRequestException('Upload the copy of the letter to this incident first');
  }

  private async serviceUserName(id: string) {
    const su = await this.prisma.serviceUser.findUnique({
      where: { id },
      select: { firstName: true, lastName: true },
    });
    return su ? `${su.firstName} ${su.lastName}`.trim() : 'service user';
  }

  private async employeeNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.employeePersonalDetail.findMany({
      where: { employeeId: { in: [...new Set(ids)] } },
      select: { employeeId: true, firstName: true, lastName: true },
    });
    return new Map(rows.map((r) => [r.employeeId, `${r.firstName} ${r.lastName}`.trim()]));
  }

  /** Every change is on the timeline, and the Outcome tab follows the results letters. */
  private async log(userId: string, incidentId: string, description: string, meta?: RequestAuditMeta) {
    await this.syncOutcome(incidentId);
    await this.audit.logAudit({
      userId,
      module: AuditModule.INCIDENT,
      action: AuditAction.INCIDENT_UPDATED,
      recordType: 'IncidentCandourChange',
      recordId: incidentId,
      description,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
  }
}
