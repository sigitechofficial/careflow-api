import { Injectable } from '@nestjs/common';
import {
  MedicationAdministrationStatus,
  MedicationKind,
  MedicationPackCondition,
  MedicationPackDeliveryStatus,
  MedicationPackStatus,
  MedicationRecordStatus,
  MedicationStockMovementType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { operationalDayBounds, operationalTodayIso } from '../common/utils/operational-day.util';
import type { MedicationOverviewQueryDto } from './dto/home-signals-query.dto';

const DAY_MS = 86_400_000;
/** Upper bound on given doses read to work out on-time %, so a huge range cannot stall the dashboard. */
const ON_TIME_SAMPLE = 20_000;

const RECORDED_STATUSES = [
  MedicationAdministrationStatus.GIVEN,
  MedicationAdministrationStatus.MISSED,
  MedicationAdministrationStatus.REFUSED,
  MedicationAdministrationStatus.NOT_GIVEN,
  MedicationAdministrationStatus.HELD,
] as const;
type RecordedStatus = (typeof RECORDED_STATUSES)[number];

const EXCEPTION_STATUSES: RecordedStatus[] = [
  MedicationAdministrationStatus.MISSED,
  MedicationAdministrationStatus.REFUSED,
  MedicationAdministrationStatus.NOT_GIVEN,
  MedicationAdministrationStatus.HELD,
];

/** Service user statuses that mean care has ended. */
const LEFT_SERVICE_STATUS_CODES = ['DISCHARGED', 'DECEASED', 'INACTIVE'] as const;

/** One support level per service user on medication (NICE NG67 / IA §9.2 levels). */
type SupportBucket = 'selfAdministers' | 'prompt' | 'assist' | 'carerAdministers' | 'othersProvide';

/** IA §9.2 "Recommended medication support level" option → dashboard bucket. */
const IA_SUPPORT_LEVEL: Record<string, SupportBucket> = {
  level_0: 'selfAdministers',
  level_1a: 'prompt',
  level_1b: 'assist',
  level_2a: 'assist',
  level_2b: 'carerAdministers',
  provided_by_others: 'othersProvide',
};

/** First value of an IA answer (text or the first selected option). */
function iaAnswerValue(a: { textValue: string | null; selectedOptions: Prisma.JsonValue }): string | null {
  if (a.textValue?.trim()) return a.textValue.trim();
  const opts = a.selectedOptions;
  const list = Array.isArray(opts) ? opts : opts !== null && opts !== undefined ? [opts] : [];
  for (const o of list) {
    if (typeof o === 'string' && o.trim()) return o.trim();
    if (o && typeof o === 'object' && !Array.isArray(o) && typeof (o as { value?: unknown }).value === 'string') {
      return String((o as { value: string }).value);
    }
  }
  return null;
}

function addDaysIso(dayIso: string, days: number): string {
  const d = new Date(`${dayIso}T00:00:00.000Z`);
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function countOf(g: { _count?: unknown }): number {
  const c = g._count;
  return typeof c === 'object' && c !== null ? Number((c as { _all?: number })._all ?? 0) : 0;
}

/**
 * Medication (eMAR) module dashboard: dose outcomes, medicines on record, support levels,
 * reviews, packs and stock — in one call, scoped to the caller's branches.
 */
@Injectable()
export class MedicationOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  private serviceUserWhere(user: RequestUser, locationId?: string): Prisma.ServiceUserWhereInput | null {
    const scope = this.orgScope.fromRequestUser(user);
    const ids = this.orgScope.resolveListLocationIds(scope, locationId);
    if (ids && ids.length === 0) return null;
    const base: Prisma.ServiceUserWhereInput = {
      deletedAt: null,
      isActive: true,
      // People who have left the service no longer have medicines to manage.
      NOT: { status: { code: { in: [...LEFT_SERVICE_STATUS_CODES] } } },
    };
    if (!ids) return base;
    return {
      ...base,
      OR: [{ locationId: { in: ids } }, { assignments: { some: { deletedAt: null, locationId: { in: ids } } } }],
    };
  }

  async overview(user: RequestUser, q: MedicationOverviewQueryDto) {
    const days = q.days ?? 30;
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = operationalTodayIso(new Date(), timeZone);
    const from = addDaysIso(today, -(days - 1));
    const periodStart = operationalDayBounds(from, timeZone).start;
    const todayBounds = operationalDayBounds(today, timeZone);
    const periodEnd = todayBounds.end;
    const now = new Date();
    const in14 = new Date(now.getTime() + 14 * DAY_MS);
    const in30 = new Date(now.getTime() + 30 * DAY_MS);

    const result = this.blank(from, today, days);
    const su = this.serviceUserWhere(user, q.locationId);
    if (!su) return { data: result };

    const doseWindow = (start: Date, end: Date): Prisma.MedicationAdministrationEventWhereInput => ({
      deletedAt: null,
      isActive: true,
      serviceUser: su,
      OR: [
        { scheduledDateTime: { gte: start, lte: end } },
        { scheduledDateTime: null, actualDateTime: { gte: start, lte: end } },
      ],
    });
    const periodWhere = doseWindow(periodStart, periodEnd);
    const todayWhere = doseWindow(todayBounds.start, todayBounds.end);
    const activeMed: Prisma.ServiceUserMedicationWhereInput = {
      deletedAt: null,
      isActive: true,
      status: MedicationRecordStatus.ACTIVE,
      serviceUser: su,
    };

    const [
      periodGroups,
      todayGroups,
      awaitingReview,
      prnGiven,
      controlledGiven,
      controlledNoWitness,
      givenTimed,
      medsByKind,
      onMedication,
      controlledMeds,
      timeCriticalMeds,
      endingSoon,
      expired,
      profiles,
      medicationAllergyUsers,
      profileAllergyUsers,
      iaSupportAnswers,
      reviews,
      packGroups,
      packReviewDue,
      prescriptionNotChecked,
      deliveriesUnsigned,
      deliveriesFlagged,
      deliveriesDamaged,
      stockGroups,
    ] = await this.prisma.$transaction([
      this.prisma.medicationAdministrationEvent.groupBy({
        by: ['status'],
        where: periodWhere,
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.medicationAdministrationEvent.groupBy({
        by: ['status'],
        where: todayWhere,
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.medicationAdministrationEvent.count({
        where: { ...periodWhere, status: { in: EXCEPTION_STATUSES }, managerReviewedAt: null },
      }),
      this.prisma.medicationAdministrationEvent.count({
        where: { ...periodWhere, status: MedicationAdministrationStatus.GIVEN, isPrn: true },
      }),
      this.prisma.medicationAdministrationEvent.count({
        where: { ...periodWhere, status: MedicationAdministrationStatus.GIVEN, medication: { isControlledMedication: true } },
      }),
      this.prisma.medicationAdministrationEvent.count({
        where: {
          ...periodWhere,
          status: MedicationAdministrationStatus.GIVEN,
          medication: { isControlledMedication: true },
          NOT: { witnessPresent: true },
        },
      }),
      this.prisma.medicationAdministrationEvent.findMany({
        where: {
          ...periodWhere,
          status: MedicationAdministrationStatus.GIVEN,
          isPrn: false,
          scheduledDateTime: { not: null },
          actualDateTime: { not: null },
        },
        select: {
          scheduledDateTime: true,
          actualDateTime: true,
          medication: { select: { timeToleranceMinutes: true, timeCritical: true } },
        },
        take: ON_TIME_SAMPLE,
      }),
      this.prisma.serviceUserMedication.groupBy({
        by: ['medicationKind'],
        where: activeMed,
        orderBy: { medicationKind: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.serviceUserMedication.groupBy({
        by: ['serviceUserId'],
        where: activeMed,
        orderBy: { serviceUserId: 'asc' },
      }),
      this.prisma.serviceUserMedication.count({ where: { ...activeMed, isControlledMedication: true } }),
      this.prisma.serviceUserMedication.count({ where: { ...activeMed, timeCritical: true } }),
      this.prisma.serviceUserMedication.count({ where: { ...activeMed, endDate: { gte: now, lte: in14 } } }),
      this.prisma.serviceUserMedication.count({ where: { ...activeMed, expiryDate: { lt: now } } }),
      this.prisma.medicationSupportProfile.findMany({
        where: { deletedAt: null, isActive: true, serviceUser: su },
        select: {
          serviceUserId: true,
          selfAdministersMedication: true,
          requiresPrompting: true,
          requiresSupervision: true,
          requiresCarerAdministration: true,
          familyMemberOrCarerSupportsMedication: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.medicationAllergy.groupBy({
        by: ['serviceUserId'],
        where: { deletedAt: null, isActive: true, serviceUser: su },
        orderBy: { serviceUserId: 'asc' },
      }),
      // General allergies on the profile (what carers see on visits) — counted alongside medication allergies.
      this.prisma.serviceUserAllergy.groupBy({
        by: ['serviceUserId'],
        where: { deletedAt: null, isActive: true, serviceUser: su },
        orderBy: { serviceUserId: 'asc' },
      }),
      // IA §9.2 medication support level (the source the Medication care plan uses).
      this.prisma.initialAssessmentAnswer.findMany({
        where: {
          submission: { deletedAt: null, isActive: true, serviceUser: su },
          question: {
            OR: [
              { metadata: { path: ['fieldKey'], equals: 'medicationSupportLevel' } },
              { questionText: { contains: 'medication support level', mode: 'insensitive' } },
            ],
          },
        },
        select: {
          textValue: true,
          selectedOptions: true,
          submission: { select: { serviceUserId: true, updatedAt: true } },
        },
        orderBy: { submission: { updatedAt: 'desc' } },
      }),
      this.prisma.medicationReview.findMany({
        where: { deletedAt: null, isActive: true, serviceUser: su },
        select: { serviceUserId: true, reviewDate: true, nextReviewDate: true },
        orderBy: { reviewDate: 'desc' },
      }),
      this.prisma.medicationPack.groupBy({
        by: ['status'],
        where: { deletedAt: null, isActive: true, serviceUser: su },
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.medicationPack.count({
        where: { deletedAt: null, isActive: true, serviceUser: su, status: MedicationPackStatus.ACTIVE, reviewDate: { lte: in14 } },
      }),
      this.prisma.medicationPack.count({
        where: { deletedAt: null, isActive: true, serviceUser: su, status: MedicationPackStatus.ACTIVE, prescriptionChecked: false },
      }),
      this.prisma.medicationPackDelivery.count({
        where: { deletedAt: null, isActive: true, countersignedAt: null, medicationPack: { serviceUser: su, deletedAt: null } },
      }),
      this.prisma.medicationPackDelivery.count({
        where: {
          deletedAt: null,
          isActive: true,
          status: MedicationPackDeliveryStatus.FLAGGED,
          medicationPack: { serviceUser: su, deletedAt: null },
        },
      }),
      this.prisma.medicationPackDelivery.count({
        where: {
          deletedAt: null,
          isActive: true,
          condition: MedicationPackCondition.DAMAGED,
          receivedAt: { gte: periodStart, lte: periodEnd },
          medicationPack: { serviceUser: su, deletedAt: null },
        },
      }),
      this.prisma.medicationStockRecord.groupBy({
        by: ['movementType'],
        where: {
          deletedAt: null,
          isActive: true,
          movementDate: { gte: periodStart, lte: periodEnd },
          medication: { serviceUser: su },
        },
        orderBy: { movementType: 'asc' },
        _count: { _all: true },
      }),
    ]);

    /* Doses */
    for (const g of periodGroups) {
      if ((RECORDED_STATUSES as readonly string[]).includes(g.status)) {
        result.doses.byStatus[g.status as RecordedStatus] = countOf(g);
      }
    }
    for (const g of todayGroups) {
      if ((RECORDED_STATUSES as readonly string[]).includes(g.status)) {
        result.today.byStatus[g.status as RecordedStatus] = countOf(g);
      }
    }
    const sum = (b: Record<RecordedStatus, number>) => RECORDED_STATUSES.reduce((n, s) => n + b[s], 0);
    result.doses.recorded = sum(result.doses.byStatus);
    result.today.recorded = sum(result.today.byStatus);
    result.doses.exceptions = result.doses.recorded - result.doses.byStatus.GIVEN;
    result.today.exceptions = result.today.recorded - result.today.byStatus.GIVEN;
    result.doses.awaitingReview = awaitingReview;
    result.doses.prnGiven = prnGiven;
    result.doses.controlledGiven = controlledGiven;
    result.doses.controlledWithoutWitness = controlledNoWitness;

    let onTime = 0;
    let late = 0;
    let early = 0;
    let timeCriticalLate = 0;
    for (const e of givenTimed) {
      const diffMin = (e.actualDateTime!.getTime() - e.scheduledDateTime!.getTime()) / 60_000;
      const tol = e.medication?.timeToleranceMinutes ?? 30;
      if (diffMin > tol) {
        late += 1;
        if (e.medication?.timeCritical) timeCriticalLate += 1;
      } else if (diffMin < -tol) early += 1;
      else onTime += 1;
    }
    result.doses.timed = givenTimed.length;
    result.doses.onTime = onTime;
    result.doses.late = late;
    result.doses.early = early;
    result.doses.timeCriticalLate = timeCriticalLate;
    result.doses.onTimePct = givenTimed.length ? Math.round((onTime / givenTimed.length) * 100) : null;
    result.doses.givenPct = result.doses.recorded
      ? Math.round((result.doses.byStatus.GIVEN / result.doses.recorded) * 100)
      : null;

    /* Medicines on record */
    for (const g of medsByKind) {
      if (g.medicationKind === MedicationKind.PRN) result.medicines.prn = countOf(g);
      else result.medicines.regular = countOf(g);
    }
    result.medicines.active = result.medicines.prn + result.medicines.regular;
    result.medicines.serviceUsersOnMedication = onMedication.length;
    result.medicines.controlled = controlledMeds;
    result.medicines.timeCritical = timeCriticalMeds;
    result.medicines.endingSoon = endingSoon;
    result.medicines.expired = expired;

    /* Support level per service user on medication: support profile first, else the latest IA §9.2 answer */
    const onMedIds = new Set(onMedication.map((g) => g.serviceUserId));
    const level = new Map<string, SupportBucket>();
    for (const p of profiles) {
      if (!onMedIds.has(p.serviceUserId) || level.has(p.serviceUserId)) continue;
      const bucket: SupportBucket | null = p.requiresCarerAdministration
        ? 'carerAdministers'
        : p.requiresSupervision
          ? 'assist'
          : p.requiresPrompting
            ? 'prompt'
            : p.familyMemberOrCarerSupportsMedication
              ? 'othersProvide'
              : p.selfAdministersMedication
                ? 'selfAdministers'
                : null;
      if (bucket) {
        level.set(p.serviceUserId, bucket);
        result.support.fromProfile += 1;
      }
    }
    for (const a of iaSupportAnswers) {
      const id = a.submission.serviceUserId;
      if (!onMedIds.has(id) || level.has(id)) continue;
      const raw = iaAnswerValue(a);
      const bucket = raw ? IA_SUPPORT_LEVEL[raw] : undefined;
      if (bucket) {
        level.set(id, bucket);
        result.support.fromAssessment += 1;
      }
    }
    for (const b of level.values()) result.support[b] += 1;
    result.support.recorded = level.size;
    result.support.notRecorded = onMedIds.size - level.size;

    const allergyIds = new Set([
      ...medicationAllergyUsers.map((g) => g.serviceUserId),
      ...profileAllergyUsers.map((g) => g.serviceUserId),
    ]);
    result.allergies.serviceUsersWithAllergies = allergyIds.size;
    result.allergies.onMedicationWithAllergies = [...onMedIds].filter((id) => allergyIds.has(id)).length;

    /* Medication reviews: latest review per service user decides */
    const latest = new Map<string, Date | null>();
    for (const r of reviews) if (!latest.has(r.serviceUserId)) latest.set(r.serviceUserId, r.nextReviewDate);
    for (const next of latest.values()) {
      if (!next) continue;
      if (next < todayBounds.start) result.reviews.overdue += 1;
      else if (next <= in30) result.reviews.dueSoon += 1;
    }
    result.reviews.neverReviewed = [...onMedIds].filter((id) => !latest.has(id)).length;

    /* Packs & deliveries */
    for (const g of packGroups) {
      if (g.status === MedicationPackStatus.ACTIVE) result.packs.active = countOf(g);
      if (g.status === MedicationPackStatus.DRAFT) result.packs.draft = countOf(g);
    }
    result.packs.reviewDue = packReviewDue;
    result.packs.prescriptionNotChecked = prescriptionNotChecked;
    result.packs.deliveriesAwaitingCountersign = deliveriesUnsigned;
    result.packs.deliveriesFlagged = deliveriesFlagged;
    result.packs.deliveriesDamaged = deliveriesDamaged;

    /* Stock movements */
    for (const g of stockGroups) {
      result.stock[g.movementType as MedicationStockMovementType] = countOf(g);
    }

    return { data: result };
  }

  private blank(from: string, to: string, days: number) {
    const statuses = (): Record<RecordedStatus, number> => ({ GIVEN: 0, MISSED: 0, REFUSED: 0, NOT_GIVEN: 0, HELD: 0 });
    return {
      period: { from, to, days },
      today: { recorded: 0, exceptions: 0, byStatus: statuses() },
      doses: {
        recorded: 0,
        exceptions: 0,
        byStatus: statuses(),
        givenPct: null as number | null,
        timed: 0,
        onTime: 0,
        late: 0,
        early: 0,
        onTimePct: null as number | null,
        timeCriticalLate: 0,
        prnGiven: 0,
        controlledGiven: 0,
        controlledWithoutWitness: 0,
        awaitingReview: 0,
      },
      medicines: {
        active: 0,
        regular: 0,
        prn: 0,
        serviceUsersOnMedication: 0,
        controlled: 0,
        timeCritical: 0,
        endingSoon: 0,
        expired: 0,
      },
      support: {
        recorded: 0,
        notRecorded: 0,
        fromProfile: 0,
        fromAssessment: 0,
        selfAdministers: 0,
        prompt: 0,
        assist: 0,
        carerAdministers: 0,
        othersProvide: 0,
      },
      allergies: { serviceUsersWithAllergies: 0, onMedicationWithAllergies: 0 },
      reviews: { overdue: 0, dueSoon: 0, neverReviewed: 0 },
      packs: {
        active: 0,
        draft: 0,
        reviewDue: 0,
        prescriptionNotChecked: 0,
        deliveriesAwaitingCountersign: 0,
        deliveriesFlagged: 0,
        deliveriesDamaged: 0,
      },
      stock: { ADDED: 0, USED: 0, ADJUSTED: 0, WASTED: 0 } as Record<MedicationStockMovementType, number>,
    };
  }
}
