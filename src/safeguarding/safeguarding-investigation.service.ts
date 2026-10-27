import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditEventType, Prisma, SafeguardingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService, andWhereFragment } from '../common/org-scope/org-scope.service';
import { dayKeyInTimeZone } from '../common/utils/operational-day.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  dateOnlyKey,
  describeEvidenceChanges,
  describeSetupChanges,
  formatDayKey,
  missingSetupForCompletion,
} from '../incidents/incident-investigation.util';
import {
  sanitizeContributingFactorDetails,
  sanitizeRecordsReviewedDetails,
} from '../incidents/incident-factor-details.util';
import {
  PauseSafeguardingInvestigationDto,
  UpsertSafeguardingInvestigationDto,
} from './dto/safeguarding-investigation.dto';

type InvestigationRow = Prisma.SafeguardingInvestigationGetPayload<object>;
type PauseRow = Prisma.SafeguardingInvestigationPauseGetPayload<object>;

/**
 * Investigation of a safeguarding case: the same set-up, findings, evidence, pause/resume and
 * completion rules as the incident investigation. Changes go on the case timeline and the audit log.
 */
@Injectable()
export class SafeguardingInvestigationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  /** The case, if the actor can see it (same branch rule as SafeguardingService). */
  private async loadCase(actor: RequestUser, id: string) {
    const scope = this.orgScope.fromRequestUser(actor);
    const ids = this.orgScope.resolveListLocationIds(scope, undefined);
    const where: Prisma.SafeguardingCaseWhereInput = { deletedAt: null, id };
    if (ids) {
      andWhereFragment(
        where,
        scope.locationIds === null
          ? { locationId: { in: ids } }
          : { OR: [...(ids.length ? [{ locationId: { in: ids } }] : []), { recordedById: actor.id }] },
      );
    }
    const row = await this.prisma.safeguardingCase.findFirst({ where });
    if (!row) throw new NotFoundException('Safeguarding case not found');
    return row;
  }

  private async loadForEdit(actor: RequestUser, id: string) {
    const row = await this.loadCase(actor, id);
    if (row.status === SafeguardingStatus.CLOSED) {
      throw new BadRequestException('Reopen the case to change the investigation');
    }
    return row;
  }

  async get(actor: RequestUser, id: string) {
    await this.loadCase(actor, id);
    const [inv, pauses] = await Promise.all([
      this.prisma.safeguardingInvestigation.findUnique({ where: { caseId: id } }),
      this.prisma.safeguardingInvestigationPause.findMany({ where: { caseId: id }, orderBy: { pausedAt: 'asc' } }),
    ]);
    return { data: inv ? await this.mapInvestigation(inv, pauses) : null };
  }

  /** Staff who can lead the investigation: active carers and managers (as for incidents). */
  async investigators() {
    return { data: await this.investigatorCandidates() };
  }

  async upsert(actor: RequestUser, id: string, dto: UpsertSafeguardingInvestigationDto, meta?: RequestAuditMeta) {
    const sgCase = await this.loadForEdit(actor, id);
    const existing = await this.prisma.safeguardingInvestigation.findUnique({ where: { caseId: id } });
    const setup = await this.resolveSetup(existing, dto);

    if (dto.markComplete) {
      if (existing?.investigationStatus === 'PAUSED') {
        throw new BadRequestException('Resume the investigation before completing it');
      }
      const missing = [
        ...missingSetupForCompletion({ ...setup.data, targetDate: dateOnlyKey(setup.data.targetDate) }),
        !dto.whatHappened?.trim() && 'what happened',
        !dto.whyHappened?.trim() && 'why it happened',
        !dto.rootCause?.trim() && 'root cause',
        !dto.preventable && 'whether it could have been prevented',
        !dto.conclusion?.trim() && 'conclusion',
      ].filter(Boolean);
      if (missing.length) {
        throw new BadRequestException(`To complete the investigation, add: ${missing.join(', ')}`);
      }
    }

    // Evidence: omitted = unchanged.
    const recordsReviewed = dto.recordsReviewed ?? existing?.recordsReviewed ?? [];
    const evidence = {
      recordsReviewed,
      recordsReviewedDetails: sanitizeRecordsReviewedDetails(
        dto.recordsReviewedDetails !== undefined ? dto.recordsReviewedDetails : existing?.recordsReviewedDetails,
        recordsReviewed,
      ),
      evidenceNotes:
        dto.evidenceNotes !== undefined ? dto.evidenceNotes?.trim() || null : (existing?.evidenceNotes ?? null),
      outstandingEvidence:
        dto.outstandingEvidence !== undefined
          ? dto.outstandingEvidence?.trim() || null
          : (existing?.outstandingEvidence ?? null),
    };
    const evidenceChanges = describeEvidenceChanges(
      existing
        ? {
            recordsReviewed: existing.recordsReviewed ?? [],
            recordsReviewedDetails: sanitizeRecordsReviewedDetails(
              existing.recordsReviewedDetails,
              existing.recordsReviewed ?? [],
            ),
            evidenceNotes: existing.evidenceNotes,
            outstandingEvidence: existing.outstandingEvidence,
          }
        : null,
      evidence,
    );
    const contributingFactors = dto.contributingFactors ?? [];
    const factorDetails = sanitizeContributingFactorDetails(
      dto.contributingFactorDetails !== undefined ? dto.contributingFactorDetails : existing?.contributingFactorDetails,
      contributingFactors,
    );
    const completing = !!dto.markComplete && existing?.investigationStatus !== 'COMPLETED';
    const data = {
      whatHappened: dto.whatHappened?.trim() || null,
      whyHappened: dto.whyHappened?.trim() || null,
      contributingFactors,
      contributingFactorDetails: factorDetails ?? Prisma.JsonNull,
      rootCause: dto.rootCause?.trim() || null,
      preventable: dto.preventable ?? null,
      conclusion: dto.conclusion?.trim() || null,
      completedAt: dto.markComplete ? (existing?.completedAt ?? new Date()) : (existing?.completedAt ?? null),
      ...evidence,
      recordsReviewedDetails: evidence.recordsReviewedDetails ?? Prisma.JsonNull,
      ...setup.data,
      investigationStatus: dto.markComplete ? 'COMPLETED' : (existing?.investigationStatus ?? 'IN_PROGRESS'),
    };

    const investigation = await this.prisma.$transaction(async tx => {
      const saved = await tx.safeguardingInvestigation.upsert({
        where: { caseId: id },
        create: { caseId: id, ...data, createdById: actor.id, updatedById: actor.id },
        update: { ...data, updatedById: actor.id },
      });
      const events: Prisma.SafeguardingEventCreateManyInput[] = [];
      if (!existing) events.push({ caseId: id, action: 'Investigation started', userId: actor.id });
      for (const line of [...setup.changes, ...evidenceChanges]) {
        events.push({ caseId: id, action: 'Investigation updated', note: line, userId: actor.id });
      }
      if (completing) events.push({ caseId: id, action: 'Investigation completed', userId: actor.id });
      if (events.length) await tx.safeguardingEvent.createMany({ data: events });
      await this.audit.logAudit({
        tx,
        userId: actor.id,
        module: AuditModule.SAFEGUARDING,
        action: AuditAction.SAFEGUARDING_UPDATED,
        eventType: existing ? AuditEventType.UPDATE : AuditEventType.CREATE,
        recordType: 'SafeguardingInvestigation',
        recordId: id,
        description: `Safeguarding concern ${sgCase.referenceNumber}: investigation ${completing ? 'completed' : 'saved'}`,
        oldValues: existing ? auditSnapshot(existing) : undefined,
        newValues: auditSnapshot(saved),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return saved;
    });
    const pauses = await this.prisma.safeguardingInvestigationPause.findMany({
      where: { caseId: id },
      orderBy: { pausedAt: 'asc' },
    });
    return {
      message: completing ? 'Investigation completed' : 'Investigation saved',
      data: await this.mapInvestigation(investigation, pauses),
    };
  }

  async pause(actor: RequestUser, id: string, dto: PauseSafeguardingInvestigationDto, meta?: RequestAuditMeta) {
    const sgCase = await this.loadForEdit(actor, id);
    const existing = await this.prisma.safeguardingInvestigation.findUnique({ where: { caseId: id } });
    if (!existing) throw new BadRequestException('Save the investigation before pausing it');
    if (existing.investigationStatus !== 'IN_PROGRESS') {
      throw new BadRequestException(
        existing.investigationStatus === 'PAUSED'
          ? 'The investigation is already paused'
          : 'A completed investigation can’t be paused',
      );
    }
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Give a reason for pausing the investigation');
    const parsed = new Date(`${dto.nextReviewDate}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dto.nextReviewDate) {
      throw new BadRequestException('Enter a valid next review date');
    }
    const timeZone = await this.orgSettings.getOperationalTimezone();
    if (dto.nextReviewDate < dayKeyInTimeZone(new Date(), timeZone)) {
      throw new BadRequestException('The next review date must be today or later');
    }
    await this.prisma.$transaction(async tx => {
      await tx.safeguardingInvestigationPause.create({
        data: { caseId: id, reason, pausedById: actor.id, nextReviewDate: parsed },
      });
      await tx.safeguardingInvestigation.update({
        where: { caseId: id },
        data: { investigationStatus: 'PAUSED', updatedById: actor.id },
      });
      await tx.safeguardingEvent.create({
        data: {
          caseId: id,
          action: 'Investigation paused',
          note: `${reason} (next review ${formatDayKey(dto.nextReviewDate)})`,
          userId: actor.id,
        },
      });
      await this.audit.logAudit({
        tx,
        userId: actor.id,
        module: AuditModule.SAFEGUARDING,
        action: AuditAction.SAFEGUARDING_UPDATED,
        eventType: AuditEventType.UPDATE,
        recordType: 'SafeguardingInvestigation',
        recordId: id,
        description: `Safeguarding concern ${sgCase.referenceNumber}: investigation paused`,
        oldValues: { investigationStatus: existing.investigationStatus },
        newValues: { investigationStatus: 'PAUSED', reason, nextReviewDate: dto.nextReviewDate },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return { message: 'Investigation paused', data: (await this.get(actor, id)).data };
  }

  async resume(actor: RequestUser, id: string, meta?: RequestAuditMeta) {
    const sgCase = await this.loadForEdit(actor, id);
    const existing = await this.prisma.safeguardingInvestigation.findUnique({ where: { caseId: id } });
    if (existing?.investigationStatus !== 'PAUSED') {
      throw new BadRequestException('The investigation is not paused');
    }
    await this.prisma.$transaction(async tx => {
      await tx.safeguardingInvestigationPause.updateMany({
        where: { caseId: id, resumedAt: null },
        data: { resumedAt: new Date(), resumedById: actor.id },
      });
      await tx.safeguardingInvestigation.update({
        where: { caseId: id },
        data: { investigationStatus: 'IN_PROGRESS', updatedById: actor.id },
      });
      await tx.safeguardingEvent.create({ data: { caseId: id, action: 'Investigation resumed', userId: actor.id } });
      await this.audit.logAudit({
        tx,
        userId: actor.id,
        module: AuditModule.SAFEGUARDING,
        action: AuditAction.SAFEGUARDING_UPDATED,
        eventType: AuditEventType.UPDATE,
        recordType: 'SafeguardingInvestigation',
        recordId: id,
        description: `Safeguarding concern ${sgCase.referenceNumber}: investigation resumed`,
        oldValues: { investigationStatus: 'PAUSED' },
        newValues: { investigationStatus: 'IN_PROGRESS' },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return { message: 'Investigation resumed', data: (await this.get(actor, id)).data };
  }

  /**
   * Set-up answers after this save (omitted = unchanged, null = cleared), validated: a new lead must be
   * an active carer or manager; the target date can't be before the start or change once completed.
   */
  private async resolveSetup(existing: InvestigationRow | null, dto: UpsertSafeguardingInvestigationDto) {
    const pick = <T>(sent: T | undefined, prev: T): T => (sent !== undefined ? sent : prev);
    const text = (v: string | null | undefined) => v?.trim() || null;

    const investigationLevel = pick(dto.investigationLevel, existing?.investigationLevel ?? null);
    const leadInvestigatorEmployeeId = pick(
      dto.leadInvestigatorEmployeeId,
      existing?.leadInvestigatorEmployeeId ?? null,
    );
    const investigatorInvolved = pick(dto.investigatorInvolved, existing?.investigatorInvolved ?? null);
    const investigatorInvolvedReason =
      investigatorInvolved === 'YES'
        ? text(pick(dto.investigatorInvolvedReason, existing?.investigatorInvolvedReason ?? null))
        : null;
    const termsOfReference = text(pick(dto.termsOfReference, existing?.termsOfReference ?? null));
    const prevTarget = dateOnlyKey(existing?.targetDate);
    const targetDate = pick(dto.targetDate, prevTarget);

    if (targetDate !== prevTarget) {
      if (existing?.investigationStatus === 'COMPLETED') {
        throw new BadRequestException('The target completion date can’t be changed after the investigation is completed');
      }
      if (targetDate) {
        const parsed = new Date(`${targetDate}T00:00:00.000Z`);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== targetDate) {
          throw new BadRequestException('Enter a valid target completion date');
        }
        const timeZone = await this.orgSettings.getOperationalTimezone();
        const startDay = dayKeyInTimeZone(existing?.createdAt ?? new Date(), timeZone);
        if (targetDate < startDay) {
          throw new BadRequestException(
            `The target completion date can’t be before the investigation started (${formatDayKey(startDay)})`,
          );
        }
      }
    }
    if (leadInvestigatorEmployeeId && leadInvestigatorEmployeeId !== (existing?.leadInvestigatorEmployeeId ?? null)) {
      const eligible = await this.investigatorCandidates();
      if (!eligible.some(c => c.id === leadInvestigatorEmployeeId)) {
        throw new BadRequestException('The lead investigator must be an active carer or manager');
      }
    }

    const before = existing
      ? {
          investigationLevel: existing.investigationLevel,
          leadInvestigatorEmployeeId: existing.leadInvestigatorEmployeeId,
          targetDate: prevTarget,
        }
      : null;
    const nameIds = [leadInvestigatorEmployeeId, existing?.leadInvestigatorEmployeeId].filter(
      (x): x is string => Boolean(x),
    );
    const changes = describeSetupChanges(
      before,
      { investigationLevel, leadInvestigatorEmployeeId, targetDate },
      await this.employeeNames(nameIds),
    );
    return {
      data: {
        investigationLevel,
        leadInvestigatorEmployeeId,
        investigatorInvolved,
        investigatorInvolvedReason,
        targetDate: targetDate ? new Date(`${targetDate}T00:00:00.000Z`) : null,
        termsOfReference,
      },
      changes,
    };
  }

  private async investigatorCandidates() {
    const employees = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [
          { employment: { is: null } },
          { employment: { is: { jobTitleId: null } } },
          { employment: { is: { jobTitle: { is: { name: { equals: 'Carer', mode: 'insensitive' } } } } } },
          { employment: { is: { jobTitle: { is: { name: { contains: 'manager', mode: 'insensitive' } } } } } },
        ],
      },
      select: {
        id: true,
        personalDetail: { select: { firstName: true, lastName: true } },
        employment: { select: { jobTitle: { select: { name: true } } } },
      },
    });
    return employees
      .map(e => ({
        id: e.id,
        name:
          [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' ').trim() ||
          'Staff member',
        designation: e.employment?.jobTitle?.name ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The investigation for the case page: dates as day keys, names, overdue, pause history. */
  private async mapInvestigation(inv: InvestigationRow, pauses: PauseRow[]) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const [names, leadNames] = await Promise.all([
      this.userNames(pauses.flatMap(p => [p.pausedById, p.resumedById]).filter((x): x is string => Boolean(x))),
      this.employeeNames(inv.leadInvestigatorEmployeeId ? [inv.leadInvestigatorEmployeeId] : []),
    ]);
    const targetDate = dateOnlyKey(inv.targetDate);
    const current = pauses.find(p => !p.resumedAt) ?? null;
    return {
      ...inv,
      targetDate,
      startedOn: dayKeyInTimeZone(inv.createdAt, timeZone),
      leadInvestigatorName: inv.leadInvestigatorEmployeeId
        ? (leadNames[inv.leadInvestigatorEmployeeId] ?? 'Unknown staff member')
        : null,
      overdue:
        inv.investigationStatus !== 'COMPLETED' && !!targetDate && targetDate < dayKeyInTimeZone(new Date(), timeZone),
      currentPause:
        inv.investigationStatus === 'PAUSED' && current
          ? { reason: current.reason, pausedAt: current.pausedAt, nextReviewDate: dateOnlyKey(current.nextReviewDate) }
          : null,
      pauses: pauses.map(p => ({
        id: p.id,
        reason: p.reason,
        pausedAt: p.pausedAt,
        pausedByName: p.pausedById ? (names[p.pausedById] ?? null) : null,
        nextReviewDate: dateOnlyKey(p.nextReviewDate),
        resumedAt: p.resumedAt,
        resumedByName: p.resumedById ? (names[p.resumedById] ?? null) : null,
      })),
    };
  }

  private async employeeNames(ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return {};
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: unique } },
      select: { id: true, personalDetail: { select: { firstName: true, lastName: true } } },
    });
    return Object.fromEntries(
      employees.map(e => [
        e.id,
        [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' ').trim() || 'Staff member',
      ]),
    );
  }

  private async userNames(ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return {};
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return Object.fromEntries(
      users.map(u => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]),
    );
  }
}
