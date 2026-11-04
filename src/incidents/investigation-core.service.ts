import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { dayKeyInTimeZone } from '../common/utils/operational-day.util';
import {
  dateOnlyKey,
  describeEvidenceChanges,
  describeSetupChanges,
  formatDayKey,
  missingSetupForCompletion,
} from './incident-investigation.util';
import {
  sanitizeContributingFactorDetails,
  sanitizeRecordsReviewedDetails,
} from './incident-factor-details.util';
import type {
  PauseIncidentInvestigationDto,
  UpsertIncidentInvestigationDto,
} from './dto/incident-review.dto';

/** Columns every investigation table has (incident and complaint investigations). */
export type InvestigationRow = Omit<
  Prisma.IncidentInvestigationGetPayload<object>,
  'id' | 'incidentId' | 'investigationScope' | 'externalType' | 'updatedAt' | 'createdById' | 'updatedById'
>;

/** Columns every investigation pause table has. */
export type InvestigationPauseRow = Omit<
  Prisma.IncidentInvestigationPauseGetPayload<object>,
  'incidentId'
>;

/**
 * The investigation rules shared by incidents and complaints: set-up and completion checks,
 * findings / evidence data to save, lead investigator candidates, pause checks and the detail view.
 * Callers own the table, access checks and audit / timeline entries.
 */
@Injectable()
export class InvestigationCoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  /**
   * Validated data to save from the upsert (everything except the incident-only scope fields),
   * plus timeline lines for the set-up / evidence changes that matter.
   */
  async prepareSave(existing: InvestigationRow | null, dto: UpsertIncidentInvestigationDto) {
    const setup = await this.resolveSetup(existing, dto);

    // Completing needs the set-up and the core findings (a draft can be saved without them).
    if (dto.markComplete) {
      if (existing?.investigationStatus === 'PAUSED') {
        throw new BadRequestException('Resume the investigation before completing it');
      }
      const missing = [
        ...missingSetupForCompletion({
          ...setup.data,
          targetDate: dateOnlyKey(setup.data.targetDate),
        }),
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
    // Evidence (part A): omitted = unchanged.
    const recordsReviewed = dto.recordsReviewed ?? existing?.recordsReviewed ?? [];
    const evidence = {
      recordsReviewed,
      recordsReviewedDetails: sanitizeRecordsReviewedDetails(
        dto.recordsReviewedDetails !== undefined
          ? dto.recordsReviewedDetails
          : existing?.recordsReviewedDetails,
        recordsReviewed,
      ),
      evidenceNotes:
        dto.evidenceNotes !== undefined
          ? dto.evidenceNotes?.trim() || null
          : (existing?.evidenceNotes ?? null),
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
    // Older clients send no details: keep the saved ones for factors that are still ticked.
    const factorDetails = sanitizeContributingFactorDetails(
      dto.contributingFactorDetails !== undefined
        ? dto.contributingFactorDetails
        : existing?.contributingFactorDetails,
      contributingFactors,
    );
    return {
      data: {
        whatHappened: dto.whatHappened?.trim() || null,
        whyHappened: dto.whyHappened?.trim() || null,
        contributingFactors,
        contributingFactorDetails: factorDetails ?? Prisma.JsonNull,
        rootCause: dto.rootCause?.trim() || null,
        preventable: dto.preventable ?? null,
        conclusion: dto.conclusion?.trim() || null,
        completedAt: dto.markComplete
          ? (existing?.completedAt ?? new Date())
          : (existing?.completedAt ?? null),
        ...evidence,
        recordsReviewedDetails: evidence.recordsReviewedDetails ?? Prisma.JsonNull,
        ...setup.data,
        investigationStatus: dto.markComplete
          ? 'COMPLETED'
          : (existing?.investigationStatus ?? 'IN_PROGRESS'),
      },
      changes: [...setup.changes, ...evidenceChanges],
    };
  }

  /**
   * Set-up answers after this save (omitted = unchanged, null = cleared), validated:
   * a new lead investigator must be an active carer or manager, the target date can't be before the start
   * and can't change once the investigation is completed.
   */
  private async resolveSetup(existing: InvestigationRow | null, dto: UpsertIncidentInvestigationDto) {
    const pick = <T>(sent: T | undefined, prev: T): T => (sent !== undefined ? sent : prev);
    const text = (v: string | null | undefined) => v?.trim() || null;

    const investigationLevel = pick(dto.investigationLevel, existing?.investigationLevel ?? null);
    const leadInvestigatorEmployeeId = pick(dto.leadInvestigatorEmployeeId, existing?.leadInvestigatorEmployeeId ?? null);
    const investigatorInvolved = pick(
      dto.investigatorInvolved,
      existing?.investigatorInvolved ?? null,
    );
    // The reason only belongs with a "Yes" answer (the old one stays in the audit log).
    const investigatorInvolvedReason =
      investigatorInvolved === 'YES'
        ? text(pick(dto.investigatorInvolvedReason, existing?.investigatorInvolvedReason ?? null))
        : null;
    const termsOfReference = text(pick(dto.termsOfReference, existing?.termsOfReference ?? null));
    const prevTarget = dateOnlyKey(existing?.targetDate);
    const targetDate = pick(dto.targetDate, prevTarget);

    if (targetDate !== prevTarget) {
      if (existing?.investigationStatus === 'COMPLETED') {
        throw new BadRequestException(
          'The target completion date can’t be changed after the investigation is completed',
        );
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
      if (!eligible.some((c) => c.id === leadInvestigatorEmployeeId)) {
        throw new BadRequestException(
          'The lead investigator must be an active carer or manager',
        );
      }
    }

    const after = { investigationLevel, leadInvestigatorEmployeeId, targetDate };
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
    const changes = describeSetupChanges(before, after, await this.employeeNames(nameIds));
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

  /**
   * Staff who can be named as lead investigator: active carers and managers (by job title),
   * plus active staff with no job title yet (shown as "No designation").
   */
  async investigatorCandidates() {
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
      .map((e) => ({
        id: e.id,
        name:
          [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' ').trim() ||
          'Staff member',
        designation: e.employment?.jobTitle?.name ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Checks a pause request against the saved investigation; returns the review date to store. */
  async validatePause(existing: InvestigationRow | null, dto: PauseIncidentInvestigationDto) {
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
    return { reason, nextReviewDate: parsed };
  }

  /** The investigation for a detail page: dates as day keys, names, overdue, pause history. */
  async mapInvestigation<T extends InvestigationRow>(inv: T, pauses: InvestigationPauseRow[]) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const names = await this.userNames(
      pauses.flatMap((p) => [p.pausedById, p.resumedById]).filter((x): x is string => Boolean(x)),
    );
    const leadNames = inv.leadInvestigatorEmployeeId
      ? await this.employeeNames([inv.leadInvestigatorEmployeeId])
      : {};
    const targetDate = dateOnlyKey(inv.targetDate);
    const current = pauses.find((p) => !p.resumedAt) ?? null;
    return {
      ...inv,
      targetDate,
      startedOn: dayKeyInTimeZone(inv.createdAt, timeZone),
      leadInvestigatorName: inv.leadInvestigatorEmployeeId
        ? (leadNames[inv.leadInvestigatorEmployeeId] ?? 'Unknown staff member')
        : null,
      overdue:
        inv.investigationStatus !== 'COMPLETED' &&
        !!targetDate &&
        targetDate < dayKeyInTimeZone(new Date(), timeZone),
      currentPause:
        inv.investigationStatus === 'PAUSED' && current
          ? {
              reason: current.reason,
              pausedAt: current.pausedAt,
              nextReviewDate: dateOnlyKey(current.nextReviewDate),
            }
          : null,
      pauses: pauses.map((p) => ({
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

  async employeeNames(ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return {};
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: unique } },
      select: { id: true, personalDetail: { select: { firstName: true, lastName: true } } },
    });
    return Object.fromEntries(
      employees.map((e) => [
        e.id,
        [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' ').trim() ||
          'Staff member',
      ]),
    );
  }

  async userNames(ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return {};
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return Object.fromEntries(
      users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]),
    );
  }
}
