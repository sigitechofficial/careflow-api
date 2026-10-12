import { BadRequestException, Injectable } from '@nestjs/common';
import {
  MedicationAdministrationStatus,
  MedicationKind,
  MedicationRecordStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { DataAccessType } from '@prisma/client';
import { assertServiceUserExists } from '../medications/medication.asserts';
import {
  buildStatusCodeMap,
  displayForCode,
  eventPendingManagerReview,
  legendFromStatusCodes,
  resolveEventMarStatusCode,
  type MarCellState,
} from './medication-chart-display.util';
import {
  createMarMonthStatsAccumulator,
  dateInMarCompletionWindow,
  finalizeMarMonthStats,
  recordScheduledMarCompletion,
} from './medication-mar-completion.util';
import type { MarMonthStats } from './medication-mar-completion.util';
import { buildMarExportHtml } from './medication-mar-export.util';
import { buildMarExportPdf } from './medication-mar-export-pdf.util';
import { buildMarExportCsv } from './medication-mar-export-csv.util';
import { buildMarExportExcel, buildMarExportExcelWorkbook } from './medication-mar-export-excel.util';
import { loadMarExportContext } from './medication-mar-export-context.util';
import { parsePackExportDetail, type MarExportRenderOptions } from './medication-mar-export-shared.util';
import {
  parseMedicationIdList,
  parseMonthList,
  resolveChartRange,
} from './medication-chart-range.util';
import type { MedicationRegularChartExportQueryDto } from './dto/medication-chart-query.dto';
import {
  chartEventDueHm,
  findRoundForDueTime,
  formatHm,
  indexRoundsByTime,
  resolveChartSlotEvent,
  resolveScheduleSlot,
  type AdministrationRoundRow,
} from './medication-chart-rounds.util';
import { groupMedicationsByName } from '../medications/medication-name-dedupe.util';
import { scheduleAppliesOnDay } from '../medications/medication-schedule-applies.util';
import { MedicationSupplyService } from '../medication-supply/medication-supply.service';
import type { MedicationSupplySummary } from '../medication-supply/medication-supply-summary.util';
import {
  auditAutoEndedMedications,
  syncMedicationsPastEndDate,
} from '../service-user-medications/medication-status-end.util';

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function inferScheduleType(
  kind: MedicationKind,
  daysOfWeek: string[],
  schedulePattern?: string | null,
  frequencyIntervalDays?: number,
): 'daily' | 'weekly' | 'specific' | 'prn' | 'monthly' | 'interval' {
  if (kind === MedicationKind.PRN) return 'prn';
  if (schedulePattern === 'MONTHLY') return 'monthly';
  if (schedulePattern === 'WEEKLY') return 'weekly';
  if (
    schedulePattern === 'DAILY' &&
    frequencyIntervalDays != null &&
    frequencyIntervalDays > 1
  ) {
    return 'interval';
  }
  if (!daysOfWeek?.length || daysOfWeek.length >= 7) return 'daily';
  if (daysOfWeek.length <= 2) return 'weekly';
  return 'specific';
}

type ChartEvent = {
  id: string;
  serviceUserMedicationId: string;
  medicationScheduleId: string | null;
  status: MedicationAdministrationStatus;
  statusCode: string | null;
  scheduledDateTime: Date | null;
  actualDateTime: Date | null;
  createdAt: Date;
  prnOverLimit: boolean;
  managerReviewedAt: Date | null;
  visitId: string | null;
};

export type MarChartCell = {
  day: number;
  date: string;
  cellState: MarCellState;
  recordId: string | null;
  statusCode: string | null;
  statusLabel: string | null;
  color: string | null;
  textColor: string | null;
  requiresReview: boolean;
  /** PRN dose given inside the minimum gap or over the 24-hour maximum. */
  prnOverLimit?: boolean;
};

export type RegularChartQuery = {
  month?: string;
  dateFrom?: string;
  dateTo?: string;
  medicationIds?: string;
  /**
   * When set (visit workspace), PRN "recorded" cells are scoped to this visit
   * only — a PRN given in another same-day visit won't show as given here.
   * Omitted by the full MAR chart, which stays day-scoped (unchanged).
   */
  prnVisitId?: string;
};

@Injectable()
export class MedicationChartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly medicationSupply: MedicationSupplyService,
  ) {}

  private marExportRenderOptions(
    q: MedicationRegularChartExportQueryDto,
  ): MarExportRenderOptions {
    return { packExportDetail: parsePackExportDetail(q.packExportDetail) };
  }

  private async logChartAccess(
    userId: string,
    serviceUserId: string,
    meta: RequestAuditMeta,
    chart: 'regular' | 'prn',
    extra: unknown,
  ) {
    const chartMeta = { serviceUserId, chart, ...((extra as object) ?? {}) };
    await this.audit.logDataAccess({
      userId,
      module: AuditModule.MEDICATION,
      recordType: 'MedicationChart',
      recordId: serviceUserId,
      accessType: DataAccessType.VIEW,
      ...meta,
      metadata: chartMeta,
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_CHART_VIEWED,
      recordType: 'MedicationChart',
      recordId: serviceUserId,
      metadata: chartMeta,
      ...meta,
    });
  }

  async regularChart(
    userId: string,
    serviceUserId: string,
    query: RegularChartQuery | string,
    meta: RequestAuditMeta,
  ) {
    const q: RegularChartQuery =
      typeof query === 'string' ? { month: query } : query;
    const prnVisitScopeId = q.prnVisitId?.trim() || null;
    const range = resolveChartRange({
      month: q.month,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
    });
    const { month, lastDay, daySpecs, periodStart, periodEnd, periodLabel } = range;
    const medicationIdFilter = parseMedicationIdList(q.medicationIds);

    await assertServiceUserExists(this.prisma, serviceUserId);
    const autoEnded = await syncMedicationsPastEndDate(this.prisma, serviceUserId);
    if (autoEnded.length) {
      await auditAutoEndedMedications(this.audit, serviceUserId, autoEnded, meta);
    }
    await this.logChartAccess(userId, serviceUserId, meta, 'regular', {
      month,
      periodStart,
      periodEnd,
      medicationIds: medicationIdFilter,
    });

    const monthStart = daySpecs[0]!.dateObj;
    const lastSpec = daySpecs[daySpecs.length - 1]!;
    const monthEnd = new Date(
      Date.UTC(
        lastSpec.dateObj.getUTCFullYear(),
        lastSpec.dateObj.getUTCMonth(),
        lastSpec.dateObj.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );

    const statusCodeRows = await this.prisma.medicationStatusCode.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    const statusByCode = buildStatusCodeMap(statusCodeRows);
    const legend = legendFromStatusCodes(statusCodeRows);

    const administrationRounds = await this.prisma.medicationAdministrationRound.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const roundsByTime = indexRoundsByTime(administrationRounds as AdministrationRoundRow[]);
    const administrationRoundRows = administrationRounds as AdministrationRoundRow[];

    const medications = await this.prisma.serviceUserMedication.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        isActive: true,
        medicationKind: { in: [MedicationKind.REGULAR, MedicationKind.PRN] },
        ...(medicationIdFilter?.length ? { id: { in: medicationIdFilter } } : {}),
        OR: [
          { status: { in: [MedicationRecordStatus.ACTIVE, MedicationRecordStatus.PAUSED] } },
          { status: MedicationRecordStatus.ENDED },
        ],
        AND: [
          { OR: [{ startDate: null }, { startDate: { lte: monthEnd } }] },
          { OR: [{ endDate: null }, { endDate: { gte: monthStart } }] },
        ],
      },
      include: {
        medicationType: true,
        frequency: true,
        route: true,
        medicationPack: true,
        schedules: {
          where: { deletedAt: null, isActive: true },
          include: { round: true },
          orderBy: [{ dueTime: 'asc' }, { createdAt: 'asc' }],
        },
        _count: {
          select: {
            events: { where: { deletedAt: null } },
          },
        },
      },
      orderBy: { medicationName: 'asc' },
    });

    const medGroups = groupMedicationsByName(medications);
    const canonicalIdByMedicationId = new Map<string, string>();
    const scheduleIdAlias = new Map<string, string>();

    for (const group of medGroups) {
      for (const member of group.members) {
        canonicalIdByMedicationId.set(member.id, group.canonical.id);
      }
      const canonical = group.canonical;
      for (const member of group.members) {
        if (member.id === canonical.id) continue;
        for (const sch of member.schedules) {
          if (sch.id === 'none') continue;
          const match = canonical.schedules.find(
            (cs) =>
              cs.id !== 'none' &&
              cs.roundId === sch.roundId &&
              (cs.dueTime?.toString() ?? '') === (sch.dueTime?.toString() ?? ''),
          );
          if (match) scheduleIdAlias.set(sch.id, match.id);
        }
      }
    }

    const chartMedications = medGroups.map((g) => g.canonical);
    const packIds = [
      ...new Set(
        chartMedications
          .map((m) => m.medicationPackId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const packCompartmentsByPackId = new Map<
      string,
      Array<{ id: string; label: string; dueTime: string }>
    >();
    if (packIds.length > 0) {
      const packCompartments = await this.prisma.medicationPackCompartment.findMany({
        where: { medicationPackId: { in: packIds }, deletedAt: null, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { dueTime: 'asc' }],
        select: { id: true, medicationPackId: true, label: true, dueTime: true },
      });
      for (const comp of packCompartments) {
        const list = packCompartmentsByPackId.get(comp.medicationPackId) ?? [];
        list.push(comp);
        packCompartmentsByPackId.set(comp.medicationPackId, list);
      }
    }
    const allMedicationIds = medications.map((x) => x.id);
    const events: ChartEvent[] =
      allMedicationIds.length === 0
        ? []
        : await this.prisma.medicationAdministrationEvent.findMany({
            where: {
              serviceUserId,
              deletedAt: null,
              serviceUserMedicationId: { in: allMedicationIds },
              OR: [
                { scheduledDateTime: { gte: monthStart, lte: monthEnd } },
                { actualDateTime: { gte: monthStart, lte: monthEnd } },
                { createdAt: { gte: monthStart, lte: monthEnd } },
              ],
            },
            select: {
              id: true,
              serviceUserMedicationId: true,
              medicationScheduleId: true,
              status: true,
              statusCode: true,
              scheduledDateTime: true,
              actualDateTime: true,
              createdAt: true,
              managerReviewedAt: true,
              visitId: true,
              prnOverLimit: true,
            },
            orderBy: { createdAt: 'desc' },
          });

    const eventsBySlotDay = new Map<string, ChartEvent>();
    const eventsByMedDueDay = new Map<string, ChartEvent>();
    const eventsByPrnDay = new Map<string, ChartEvent>();
    const eventIndexes = { eventsBySlotDay, eventsByMedDueDay };
    for (const e of events) {
      const anchor = e.scheduledDateTime ?? e.actualDateTime ?? e.createdAt;
      const date = utcDayKey(new Date(anchor));
      const canonicalMedId =
        canonicalIdByMedicationId.get(e.serviceUserMedicationId) ?? e.serviceUserMedicationId;
      const med = chartMedications.find((m) => m.id === canonicalMedId);
      if (med?.medicationKind === MedicationKind.PRN) {
        // Visit workspace scope: only THIS visit's PRN administrations count,
        // so a PRN given in another same-day visit doesn't show as given here.
        if (prnVisitScopeId && e.visitId !== prnVisitScopeId) continue;
        const prnKey = `${canonicalMedId}:${date}`;
        if (!eventsByPrnDay.has(prnKey)) eventsByPrnDay.set(prnKey, e);
      } else {
        const scheduleId = e.medicationScheduleId
          ? scheduleIdAlias.get(e.medicationScheduleId) ?? e.medicationScheduleId
          : 'none';
        const slotKey = `${canonicalMedId}:${scheduleId}:${date}`;
        if (!eventsBySlotDay.has(slotKey)) eventsBySlotDay.set(slotKey, e);
        const dueHm = chartEventDueHm(e);
        if (dueHm) {
          const medDueKey = `${canonicalMedId}:${dueHm}:${date}`;
          if (!eventsByMedDueDay.has(medDueKey)) eventsByMedDueDay.set(medDueKey, e);
        }
      }
    }

    const todayKey = utcDayKey(new Date());
    const todaySpec = daySpecs.find(s => s.date === todayKey);
    const todayDay = todaySpec?.columnDay ?? null;

    let summaryDue = 0;
    let summaryRecorded = 0;
    let summaryMissed = 0;
    let summaryReview = 0;

    const rows: {
      medicationId: string;
      scheduleId: string | null;
      medicationName: string;
      packName: string | null;
      dose: string | null;
      strength: string | null;
      routeName: string | null;
      type: string | null;
      frequency: string | null;
      scheduleType: 'daily' | 'weekly' | 'specific' | 'prn' | 'monthly' | 'interval';
      timeSlot: string;
      dueTime: string | null;
      roundWindowStart: string | null;
      roundWindowEnd: string | null;
      roundSortOrder: number;
      startDate: Date | null;
      endDate: Date | null;
      days: MarChartCell[];
    }[] = [];

    const monthStatsAcc = createMarMonthStatsAccumulator();

    for (const med of chartMedications) {
      if (med.medicationKind === MedicationKind.PRN) {
        const days: MarChartCell[] = [];
        for (const spec of daySpecs) {
          const { columnDay: d, date, dateObj: dayDate } = spec;
          const activeOnDay =
            (!med.startDate || med.startDate <= dayDate) && (!med.endDate || med.endDate >= dayDate);
          const prnKey = `${med.id}:${date}`;
          const event = eventsByPrnDay.get(prnKey);
          let cell: MarChartCell;
          if (!activeOnDay && !event) {
            const na = displayForCode('N/A', statusByCode);
            cell = {
              day: d,
              date,
              cellState: 'na',
              recordId: null,
              statusCode: null,
              statusLabel: na.label,
              color: na.color,
              textColor: na.textColor,
              requiresReview: false,
            };
          } else if (event) {
            const code = resolveEventMarStatusCode(event);
            const display = displayForCode(code, statusByCode);
            cell = {
              day: d,
              date,
              cellState: 'recorded',
              recordId: event.id,
              statusCode: display.code,
              statusLabel: display.label,
              color: display.color,
              textColor: display.textColor,
              requiresReview: eventPendingManagerReview(display, event),
              prnOverLimit: event.prnOverLimit,
            };
          } else {
            cell = {
              day: d,
              date,
              cellState: 'prn',
              recordId: null,
              statusCode: null,
              statusLabel: 'PRN',
              color: '#E0F2FE',
              textColor: '#0369A1',
              requiresReview: false,
            };
          }
          days.push(cell);
          if (
            dateInMarCompletionWindow(date, periodStart, periodEnd, todayKey) &&
            cell.cellState === 'recorded'
          ) {
            monthStatsAcc.prnAdministered += 1;
          }
          if (todayDay === d && cell.cellState === 'due') summaryDue += 1;
          if (todayDay === d && cell.cellState === 'recorded') {
            summaryRecorded += 1;
            if (cell.statusCode === 'N' || cell.statusCode === 'R') summaryMissed += 1;
            if (cell.requiresReview) summaryReview += 1;
          }
        }
        rows.push({
          medicationId: med.id,
          scheduleId: null,
          medicationName: med.medicationName,
          packName: med.medicationPack?.name ?? null,
          dose: med.dose,
          strength: med.strength,
          routeName: med.route?.name ?? null,
          type: med.medicationType?.name ?? null,
          frequency: med.frequency?.name ?? med.frequencyText ?? 'PRN',
          scheduleType: 'prn',
          timeSlot: 'PRN',
          dueTime: null,
          roundWindowStart: null,
          roundWindowEnd: null,
          roundSortOrder: 0,
          startDate: med.startDate,
          endDate: med.endDate,
          days,
        });
        continue;
      }

      const scheduleRows =
        med.schedules.length > 0
          ? med.schedules
          : (() => {
              const packId = med.medicationPackId;
              const compartments = packId ? packCompartmentsByPackId.get(packId) : undefined;
              if (compartments?.length) {
                return compartments.map((comp) => ({
                  id: `pack-compartment-${comp.id}`,
                  dueTime: comp.dueTime,
                  dose: null as string | null,
                  dueVisitName: comp.label,
                  round: findRoundForDueTime(
                    comp.dueTime,
                    administrationRoundRows,
                    roundsByTime,
                  ),
                  daysOfWeek: [] as string[],
                }));
              }
              return [
                {
                  id: 'none',
                  dueTime: null as string | null,
                  dose: null as string | null,
                  dueVisitName: null as string | null,
                  round: null,
                  daysOfWeek: [] as string[],
                },
              ];
            })();

      for (const sch of scheduleRows) {
        const scheduleId = sch.id === 'none' ? null : sch.id;
        const rowDose = sch.dose ?? med.dose;
        const scheduleType = inferScheduleType(
          med.medicationKind,
          sch.daysOfWeek ?? [],
          med.schedulePattern,
          med.frequencyIntervalDays ?? 1,
        );
        const slot = resolveScheduleSlot(sch, roundsByTime, administrationRoundRows);
        const days: MarChartCell[] = [];

        for (const spec of daySpecs) {
          const { columnDay: d, date, dateObj: dayDate } = spec;
          const activeOnDay =
            (!med.startDate || med.startDate <= dayDate) && (!med.endDate || med.endDate >= dayDate);

          const scheduleApplies = scheduleAppliesOnDay({
            dayDate: dayDate,
            medicationStartDate: med.startDate,
            schedulePattern: med.schedulePattern,
            frequencyIntervalDays: med.frequencyIntervalDays ?? 1,
            daysOfWeek: sch.daysOfWeek ?? [],
            monthlyDayOfMonth: med.monthlyDayOfMonth,
            monthlyAnchorToStartDate: med.monthlyAnchorToStartDate ?? true,
          });

          const event = resolveChartSlotEvent(
            eventIndexes,
            med.id,
            scheduleId,
            slot.dueTime,
            date,
          );

          let cell: MarChartCell;
          if (event) {
            const code = resolveEventMarStatusCode(event);
            const display = displayForCode(code, statusByCode);
            cell = {
              day: d,
              date,
              cellState: 'recorded',
              recordId: event.id,
              statusCode: display.code,
              statusLabel: display.label,
              color: display.color,
              textColor: display.textColor,
              requiresReview: eventPendingManagerReview(display, event),
            };
          } else if (!activeOnDay || !scheduleApplies) {
            const na = displayForCode('N/A', statusByCode);
            cell = {
              day: d,
              date,
              cellState: 'na',
              recordId: null,
              statusCode: null,
              statusLabel: na.label,
              color: na.color,
              textColor: na.textColor,
              requiresReview: false,
            };
          } else {
            const due = displayForCode('Due', statusByCode);
            cell = {
              day: d,
              date,
              cellState: 'due',
              recordId: null,
              statusCode: 'Due',
              statusLabel: due.label,
              color: due.color,
              textColor: due.textColor,
              requiresReview: false,
            };
          }

          days.push(cell);

          if (
            activeOnDay &&
            scheduleApplies &&
            dateInMarCompletionWindow(date, periodStart, periodEnd, todayKey)
          ) {
            recordScheduledMarCompletion(monthStatsAcc, cell);
          }

          if (todayDay === d) {
            if (cell.cellState === 'due') summaryDue += 1;
            if (cell.cellState === 'recorded') {
              summaryRecorded += 1;
              if (cell.statusCode === 'N' || cell.statusCode === 'R') summaryMissed += 1;
              if (cell.requiresReview) summaryReview += 1;
            }
          }
        }

        rows.push({
          medicationId: med.id,
          scheduleId,
          medicationName: med.medicationName,
          packName: med.medicationPack?.name ?? null,
          dose: rowDose,
          strength: med.strength,
          routeName: med.route?.name ?? null,
          type: med.medicationType?.name ?? null,
          frequency: med.frequency?.name ?? med.frequencyText ?? null,
          scheduleType,
          timeSlot: slot.timeSlot,
          dueTime: slot.dueTime,
          roundWindowStart: slot.roundWindowStart,
          roundWindowEnd: slot.roundWindowEnd,
          roundSortOrder: slot.sortOrder,
          startDate: med.startDate,
          endDate: med.endDate,
          days,
        });
      }
    }

    rows.sort((a, b) => {
      const byMed = a.medicationName.localeCompare(b.medicationName);
      if (byMed !== 0) return byMed;
      const byRound = a.roundSortOrder - b.roundSortOrder;
      if (byRound !== 0) return byRound;
      return (a.dueTime ?? '').localeCompare(b.dueTime ?? '');
    });

    const monthStats: MarMonthStats = finalizeMarMonthStats(
      monthStatsAcc,
      periodStart,
      periodEnd,
      todayKey,
    );

    const medicationCount = new Set(rows.map((r) => r.medicationId)).size;
    const scheduleRowCount = rows.length;

    const regularGroups = medGroups.filter(
      (g) => g.canonical.medicationKind === MedicationKind.REGULAR,
    );
    const regularMedIds = regularGroups.map((g) => g.canonical.id);
    const relatedIdsByCanonicalId = Object.fromEntries(
      regularGroups.map((g) => [g.canonical.id, g.relatedIds]),
    );
    const supplyByMedicationId: Record<string, MedicationSupplySummary> =
      await this.medicationSupply.buildSupplySummariesByMedicationId(
        serviceUserId,
        regularMedIds,
        relatedIdsByCanonicalId,
      );

    return {
      month,
      lastDay,
      periodStart,
      periodEnd,
      periodLabel,
      dayDates: daySpecs.map(s => s.date),
      medicationCount,
      scheduleRowCount,
      supplyByMedicationId,
      legend,
      summary: {
        date: todayKey,
        due: summaryDue,
        recorded: summaryRecorded,
        missed: summaryMissed,
        reviewToday: summaryReview,
      },
      monthStats,
      medications: rows.map(({ roundSortOrder: _sort, ...row }) => row),
    };
  }

  async prnChart(userId: string, serviceUserId: string, dateFrom: string, dateTo: string, meta: RequestAuditMeta) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new BadRequestException('dateFrom and dateTo must be valid and dateTo must be after dateFrom');
    }
    await this.logChartAccess(userId, serviceUserId, meta, 'prn', { dateFrom, dateTo });

    const events = await this.prisma.medicationAdministrationEvent.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        isActive: true,
        AND: [
          {
            OR: [{ isPrn: true }, { medication: { medicationKind: MedicationKind.PRN } }],
          },
          {
            OR: [
              { actualDateTime: { gte: from, lte: to } },
              { scheduledDateTime: { gte: from, lte: to } },
              { createdAt: { gte: from, lte: to } },
            ],
          },
        ],
      },
      include: {
        medication: true,
        administeredBy: { include: { personalDetail: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const byMed = new Map<string, typeof events>();
    for (const e of events) {
      const name = e.medication.medicationName;
      if (!byMed.has(name)) byMed.set(name, []);
      byMed.get(name)!.push(e);
    }

    const groups = [...byMed.entries()].map(([medicationName, evs]) => ({
      medicationName,
      events: evs.map((e) => ({
        id: e.id,
        status: e.status,
        doseGiven: e.doseGiven,
        dose: e.medication.dose,
        scheduledDateTime: e.scheduledDateTime,
        actualDateTime: e.actualDateTime,
        carer: e.administeredBy?.personalDetail
          ? `${e.administeredBy.personalDetail.firstName} ${e.administeredBy.personalDetail.lastName}`.trim()
          : null,
        prnReason: e.prnReason,
        prnOutcome: e.prnOutcome,
        notes: e.notes,
        createdAt: e.createdAt,
      })),
    }));

    return { dateFrom, dateTo, groups };
  }

  private chartQueryFromDto(q: MedicationRegularChartExportQueryDto): RegularChartQuery {
    return {
      month: q.month,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      medicationIds: q.medicationIds,
    };
  }

  private async loadChartsForExport(
    userId: string,
    serviceUserId: string,
    q: MedicationRegularChartExportQueryDto,
    meta: RequestAuditMeta,
  ) {
    const baseQuery = this.chartQueryFromDto(q);
    const monthList = parseMonthList(q.months);
    if (monthList?.length) {
      const charts = await Promise.all(
        monthList.map(month =>
          this.regularChart(
            userId,
            serviceUserId,
            { ...baseQuery, month, dateFrom: undefined, dateTo: undefined },
            meta,
          ),
        ),
      );
      return { charts, exportLabel: monthList.join('_') };
    }
    const chart = await this.regularChart(userId, serviceUserId, baseQuery, meta);
    const exportLabel =
      chart.periodStart && chart.periodEnd && chart.periodStart !== chart.periodEnd
        ? `${chart.periodStart}_${chart.periodEnd}`
        : chart.month;
    return { charts: [chart], exportLabel };
  }

  async exportRegularMarHtml(
    userId: string,
    serviceUserId: string,
    q: MedicationRegularChartExportQueryDto,
    meta: RequestAuditMeta,
  ): Promise<string> {
    const { charts, exportLabel } = await this.loadChartsForExport(
      userId,
      serviceUserId,
      q,
      meta,
    );
    if (charts.length > 1) {
      throw new BadRequestException(
        'HTML export supports one month or date range only. Use Excel for multiple months.',
      );
    }
    const chart = charts[0]!;
    const ctx = await loadMarExportContext(
      this.prisma,
      userId,
      serviceUserId,
      chart.month,
      chart,
    );

    const isPreview = q.preview === 'true' || q.preview === '1';
    if (!isPreview) {
      await this.audit.logAudit({
        userId,
        module: AuditModule.MEDICATION,
        action: AuditAction.MEDICATION_REPORT_EXPORTED,
        recordType: 'MedicationChart',
        recordId: serviceUserId,
        metadata: {
          exportLabel,
          format: 'html',
          month: q.month,
          months: q.months,
          dateFrom: q.dateFrom,
          dateTo: q.dateTo,
          medicationIds: q.medicationIds,
        },
        ...meta,
      });
    }

    return buildMarExportHtml(ctx, chart, this.marExportRenderOptions(q));
  }

  async exportRegularMarPdf(
    userId: string,
    serviceUserId: string,
    q: MedicationRegularChartExportQueryDto,
    meta: RequestAuditMeta,
  ): Promise<Buffer> {
    const { charts, exportLabel } = await this.loadChartsForExport(
      userId,
      serviceUserId,
      q,
      meta,
    );
    if (charts.length > 1) {
      throw new BadRequestException(
        'PDF export supports one month or date range only. Use Excel for multiple months.',
      );
    }
    const chart = charts[0]!;
    const ctx = await loadMarExportContext(
      this.prisma,
      userId,
      serviceUserId,
      chart.month,
      chart,
    );

    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_REPORT_EXPORTED,
      recordType: 'MedicationChart',
      recordId: serviceUserId,
      metadata: { exportLabel, format: 'pdf' },
      ...meta,
    });

    try {
      return await buildMarExportPdf(ctx, chart, this.marExportRenderOptions(q));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new BadRequestException(`Failed to generate MAR PDF: ${message}`);
    }
  }

  async exportRegularMarCsv(
    userId: string,
    serviceUserId: string,
    q: MedicationRegularChartExportQueryDto,
    meta: RequestAuditMeta,
  ): Promise<string> {
    const { charts, exportLabel } = await this.loadChartsForExport(
      userId,
      serviceUserId,
      q,
      meta,
    );
    if (charts.length > 1) {
      throw new BadRequestException(
        'CSV export supports one month or date range only. Use Excel for multiple months.',
      );
    }
    const chart = charts[0]!;
    const ctx = await loadMarExportContext(
      this.prisma,
      userId,
      serviceUserId,
      chart.month,
      chart,
    );

    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_REPORT_EXPORTED,
      recordType: 'MedicationChart',
      recordId: serviceUserId,
      metadata: { exportLabel, format: 'csv' },
      ...meta,
    });

    return buildMarExportCsv(ctx, chart, this.marExportRenderOptions(q));
  }

  async exportRegularMarExcel(
    userId: string,
    serviceUserId: string,
    q: MedicationRegularChartExportQueryDto,
    meta: RequestAuditMeta,
  ): Promise<Buffer> {
    const { charts, exportLabel } = await this.loadChartsForExport(
      userId,
      serviceUserId,
      q,
      meta,
    );

    const sheets = await Promise.all(
      charts.map(async chart => ({
        chart,
        ctx: await loadMarExportContext(
          this.prisma,
          userId,
          serviceUserId,
          chart.month,
          chart,
        ),
      })),
    );

    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_REPORT_EXPORTED,
      recordType: 'MedicationChart',
      recordId: serviceUserId,
      metadata: {
        exportLabel,
        format: 'xlsx',
        sheetCount: charts.length,
      },
      ...meta,
    });

    const exportOptions = this.marExportRenderOptions(q);
    if (sheets.length === 1) {
      return buildMarExportExcel(sheets[0]!.ctx, sheets[0]!.chart, exportOptions);
    }
    return buildMarExportExcelWorkbook(sheets, exportOptions);
  }

  exportFilenameSuffix(q: MedicationRegularChartExportQueryDto): string {
    const months = parseMonthList(q.months);
    if (months?.length) return months.join('_');
    if (q.dateFrom && q.dateTo) return `${q.dateFrom}_${q.dateTo}`;
    if (q.month) return q.month;
    return 'export';
  }
}
