import { BadRequestException, Injectable } from '@nestjs/common';
import { MedicationAdministrationStatus, MedicationKind, MedicationRecordStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { DataAccessType } from '@prisma/client';
import { assertServiceUserExists } from '../medications/medication.asserts';

const DOW = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class MedicationChartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async logChartAccess(
    userId: string,
    serviceUserId: string,
    meta: RequestAuditMeta,
    chart: 'regular' | 'prn',
    extra: unknown,
  ) {
    await this.audit.logDataAccess({
      userId,
      module: AuditModule.MEDICATION,
      recordType: 'MedicationChart',
      recordId: serviceUserId,
      accessType: DataAccessType.VIEW,
      ...meta,
      metadata: { chart, ...((extra as object) ?? {}) },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_CHART_VIEWED,
      recordType: 'MedicationChart',
      recordId: serviceUserId,
      metadata: { chart, ...((extra as object) ?? {}) },
      ...meta,
    });
  }

  async regularChart(userId: string, serviceUserId: string, month: string, meta: RequestAuditMeta) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    await this.logChartAccess(userId, serviceUserId, meta, 'regular', { month });

    const [yStr, mStr] = month.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    if (!y || !m || m < 1 || m > 12) throw new BadRequestException('Invalid month');
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEnd = new Date(Date.UTC(y, m - 1, lastDay, 23, 59, 59, 999));

    const medications = await this.prisma.serviceUserMedication.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        isActive: true,
        medicationKind: MedicationKind.REGULAR,
        OR: [
          { status: { in: [MedicationRecordStatus.ACTIVE, MedicationRecordStatus.PAUSED] } },
          { status: MedicationRecordStatus.ENDED },
        ],
        AND: [
          {
            OR: [{ startDate: null }, { startDate: { lte: monthEnd } }],
          },
          {
            OR: [{ endDate: null }, { endDate: { gte: monthStart } }],
          },
        ],
      },
      include: {
        medicationType: true,
        frequency: true,
        medicationPack: true,
        schedules: { where: { deletedAt: null, isActive: true }, include: { round: true } },
      },
      orderBy: { medicationName: 'asc' },
    });

    const medIds = medications.map((x) => x.id);
    const events =
      medIds.length === 0
        ? []
        : await this.prisma.medicationAdministrationEvent.findMany({
            where: {
              serviceUserId,
              deletedAt: null,
              serviceUserMedicationId: { in: medIds },
              OR: [
                { scheduledDateTime: { gte: monthStart, lte: monthEnd } },
                { actualDateTime: { gte: monthStart, lte: monthEnd } },
                { createdAt: { gte: monthStart, lte: monthEnd } },
              ],
            },
            orderBy: { createdAt: 'desc' },
          });

    const eventsByMedAndDay = new Map<string, Map<string, (typeof events)[number][]>>();
    for (const e of events) {
      const anchor = e.scheduledDateTime ?? e.actualDateTime ?? e.createdAt;
      const keyDay = utcDayKey(new Date(anchor));
      if (!eventsByMedAndDay.has(e.serviceUserMedicationId)) {
        eventsByMedAndDay.set(e.serviceUserMedicationId, new Map());
      }
      const inner = eventsByMedAndDay.get(e.serviceUserMedicationId)!;
      if (!inner.has(keyDay)) inner.set(keyDay, []);
      inner.get(keyDay)!.push(e);
    }

    const todayKey = utcDayKey(new Date());

    const rows = medications.map((med) => {
      const days: { day: number; date: string; status: string }[] = [];
      for (let d = 1; d <= lastDay; d++) {
        const dayDate = new Date(Date.UTC(y, m - 1, d));
        const date = utcDayKey(dayDate);
        const dow = DOW[dayDate.getUTCDay()];
        const activeOnDay =
          (!med.startDate || med.startDate <= dayDate) && (!med.endDate || med.endDate >= dayDate);

        const schedulesApply =
          !med.schedules?.length ||
          med.schedules.some((s) => !s.daysOfWeek?.length || s.daysOfWeek.includes(dow));

        const list = eventsByMedAndDay.get(med.id)?.get(date) ?? [];
        const primary = list[0];
        let status = 'BLANK';
        if (primary) {
          status = primary.status;
        } else if (activeOnDay && schedulesApply) {
          status = date <= todayKey ? 'PENDING' : 'BLANK';
        }
        days.push({ day: d, date, status });
      }

      const firstSch = med.schedules?.[0];
      return {
        medicationId: med.id,
        medicationName: med.medicationName,
        packName: med.medicationPack?.name ?? null,
        type: med.medicationType?.name ?? null,
        frequency: med.frequency?.name ?? med.frequencyText ?? null,
        startDate: med.startDate,
        endDate: med.endDate,
        dueVisit: firstSch?.dueVisitName ?? null,
        dueTime: firstSch?.dueTime ?? firstSch?.round?.time ?? null,
        days,
      };
    });

    return {
      month,
      lastDay,
      medications: rows,
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
}
