import { Injectable } from '@nestjs/common';
import {
  IncidentActionStatus,
  IncidentSeverity,
  IncidentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { andWhereFragment, OrgScopeService } from '../common/org-scope/org-scope.service';
import { allowedPrivacyLevels } from './incident-access.util';
import { incidentOccurredAtRange, OPEN_INCIDENT_STATUSES } from './incident-workflow.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { IncidentAnalyticsQueryDto } from './dto/incident-analytics-query.dto';

const ROW_CAP = 10_000;
const DAY_MS = 86_400_000;
const TIME_BUCKETS = [
  { key: 'NIGHT', label: 'Night (00–06)', from: 0, to: 5 },
  { key: 'MORNING', label: 'Morning (06–12)', from: 6, to: 11 },
  { key: 'AFTERNOON', label: 'Afternoon (12–18)', from: 12, to: 17 },
  { key: 'EVENING', label: 'Evening (18–24)', from: 18, to: 23 },
];
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type LeanRow = Prisma.IncidentGetPayload<{
  select: {
    severity: true;
    status: true;
    occurredAt: true;
    reportedAt: true;
    closedAt: true;
    locationId: true;
    primaryServiceUserId: true;
    primaryEmployeeId: true;
    category: { select: { key: true; label: true } };
    subtype: { select: { key: true; label: true } };
  };
}>;

@Injectable()
export class IncidentAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  private async baseWhere(
    user: RequestUser,
    q: IncidentAnalyticsQueryDto,
  ): Promise<Prisma.IncidentWhereInput> {
    const scope = this.orgScope.fromRequestUser(user);
    const locationIds = this.orgScope.resolveListLocationIds(
      scope,
      q.locationId,
      undefined,
    );
    const where: Prisma.IncidentWhereInput = {
      deletedAt: null,
      isArchived: false,
      privacyLevel: { in: allowedPrivacyLevels(user) },
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.serviceUserId ? { primaryServiceUserId: q.serviceUserId } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    if (locationIds?.length) {
      const serviceUsers = await this.prisma.serviceUser.findMany({
        where: { deletedAt: null, locationId: { in: locationIds } },
        select: { id: true },
      });
      const suIds = serviceUsers.map((s) => s.id);
      andWhereFragment(where, {
        OR: [
          { locationId: { in: locationIds } },
          ...(suIds.length ? [{ primaryServiceUserId: { in: suIds } }] : []),
        ],
      });
    } else if (locationIds && locationIds.length === 0) {
      andWhereFragment(where, { id: { in: [] } });
    } else {
      andWhereFragment(where, await this.orgScope.incidentScopeWhere(scope));
    }
    const occurredAt = incidentOccurredAtRange(
      q.dateFrom,
      q.dateTo,
      await this.orgSettings.getOperationalTimezone(),
    );
    if (occurredAt) where.occurredAt = occurredAt;
    return where;
  }

  async getAnalytics(user: RequestUser, q: IncidentAnalyticsQueryDto) {
    const where = await this.baseWhere(user, q);

    const rows: LeanRow[] = await this.prisma.incident.findMany({
      where,
      select: {
        severity: true,
        status: true,
        occurredAt: true,
        reportedAt: true,
        closedAt: true,
        locationId: true,
        primaryServiceUserId: true,
        primaryEmployeeId: true,
        category: { select: { key: true, label: true } },
        subtype: { select: { key: true, label: true } },
      },
      take: ROW_CAP,
    });

    const total = rows.length;
    const bySeverity = this.zeroSeverity();
    const byStatus: Record<string, number> = {};
    const byCategory = new Map<string, { label: string; count: number }>();
    const bySubtype = new Map<string, { label: string; count: number }>();
    const byLocation = new Map<string, number>();
    const byServiceUser = new Map<string, number>();
    const byTimeOfDay = TIME_BUCKETS.map((b) => ({
      key: b.key,
      label: b.label,
      count: 0,
    }));
    const byDayOfWeek = DOW_LABELS.map((d) => ({ day: d, count: 0 }));
    const monthly = new Map<string, number>();

    let open = 0;
    let closed = 0;
    let falls = 0;
    let medication = 0;
    let nearMiss = 0;
    let involvingEmployees = 0;
    let closureMsSum = 0;
    let closureCount = 0;

    for (const r of rows) {
      bySeverity[r.severity] += 1;
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (OPEN_INCIDENT_STATUSES.includes(r.status)) open += 1;
      if (r.status === IncidentStatus.CLOSED) closed += 1;

      const cat = byCategory.get(r.category.key) ?? {
        label: r.category.label,
        count: 0,
      };
      cat.count += 1;
      byCategory.set(r.category.key, cat);
      if (r.category.key === 'MEDICATION') medication += 1;
      if (r.category.key === 'NEAR_MISS') nearMiss += 1;

      if (r.subtype) {
        const sub = bySubtype.get(r.subtype.key) ?? {
          label: r.subtype.label,
          count: 0,
        };
        sub.count += 1;
        bySubtype.set(r.subtype.key, sub);
        if (r.subtype.key === 'FALL') falls += 1;
      }

      if (r.locationId)
        byLocation.set(r.locationId, (byLocation.get(r.locationId) ?? 0) + 1);
      if (r.primaryServiceUserId)
        byServiceUser.set(
          r.primaryServiceUserId,
          (byServiceUser.get(r.primaryServiceUserId) ?? 0) + 1,
        );
      if (r.primaryEmployeeId) involvingEmployees += 1;

      const hour = r.occurredAt.getUTCHours();
      const bucket = byTimeOfDay.find(
        (_, i) => hour >= TIME_BUCKETS[i].from && hour <= TIME_BUCKETS[i].to,
      );
      if (bucket) bucket.count += 1;
      byDayOfWeek[r.occurredAt.getUTCDay()].count += 1;

      const monthKey = `${r.occurredAt.getUTCFullYear()}-${String(r.occurredAt.getUTCMonth() + 1).padStart(2, '0')}`;
      monthly.set(monthKey, (monthly.get(monthKey) ?? 0) + 1);

      if (r.status === IncidentStatus.CLOSED && r.closedAt) {
        closureMsSum += r.closedAt.getTime() - r.reportedAt.getTime();
        closureCount += 1;
      }
    }

    // Repeat service users (>= 2 incidents in the filtered set) — a repeat-incident signal.
    const repeatServiceUsers = [...byServiceUser.values()].filter(
      (c) => c >= 2,
    ).length;

    // Injuries grouped by type (respect the same incident filter).
    const injuryGroups = await this.prisma.incidentInjury.groupBy({
      by: ['injuryType'],
      where: { deletedAt: null, incident: { is: where } },
      _count: true,
      orderBy: { _count: { injuryType: 'desc' } },
      take: 15,
    });

    // Overdue actions within the filtered incidents.
    const overdueActions = await this.prisma.incidentAction.count({
      where: {
        deletedAt: null,
        dueDate: { lt: new Date() },
        status: {
          notIn: [
            IncidentActionStatus.COMPLETED,
            IncidentActionStatus.CANCELLED,
          ],
        },
        incident: { is: where },
      },
    });

    const [locationNames, serviceUserNames] = await Promise.all([
      this.resolveLocationNames([...byLocation.keys()]),
      this.resolveServiceUserNames(this.topKeys(byServiceUser, 10)),
    ]);

    const warnings = await this.getWarnings(user);

    return {
      data: {
        totals: {
          total,
          open,
          closed,
          awaitingReview: byStatus[IncidentStatus.AWAITING_REVIEW] ?? 0,
          underInvestigation: byStatus[IncidentStatus.UNDER_INVESTIGATION] ?? 0,
          highCritical:
            (bySeverity[IncidentSeverity.HIGH] ?? 0) +
            (bySeverity[IncidentSeverity.CRITICAL] ?? 0),
          falls,
          medication,
          nearMiss,
          involvingEmployees,
          overdueActions,
          repeatServiceUsers,
          averageClosureHours: closureCount
            ? Math.round((closureMsSum / closureCount / 3_600_000) * 10) / 10
            : null,
        },
        bySeverity,
        byStatus,
        byCategory: this.sortedEntries(byCategory).map(([key, v]) => ({
          key,
          label: v.label,
          count: v.count,
        })),
        bySubtype: this.sortedEntries(bySubtype)
          .slice(0, 12)
          .map(([key, v]) => ({ key, label: v.label, count: v.count })),
        byLocation: this.topKeys(byLocation, 10).map((id) => ({
          id,
          name: locationNames.get(id) ?? 'Unknown',
          count: byLocation.get(id) ?? 0,
        })),
        byServiceUser: this.topKeys(byServiceUser, 10).map((id) => ({
          id,
          name: serviceUserNames.get(id) ?? 'Unknown',
          count: byServiceUser.get(id) ?? 0,
        })),
        byTimeOfDay,
        byDayOfWeek,
        injuryTypes: injuryGroups.map((g) => ({
          type: g.injuryType,
          count: g._count,
        })),
        monthlyTrend: this.lastMonths(monthly, 12),
        warnings,
      },
    };
  }

  /** Objective, explainable operational warnings (privacy-filtered). */
  private async getWarnings(user: RequestUser) {
    const privacy = { in: allowedPrivacyLevels(user) };
    const now = Date.now();
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const warnings: { level: 'info' | 'warning'; label: string }[] = [];

    // Repeat falls per service user in the last 90 days.
    const fallGroups = await this.prisma.incident.groupBy({
      by: ['primaryServiceUserId'],
      where: {
        deletedAt: null,
        isArchived: false,
        privacyLevel: privacy,
        primaryServiceUserId: { not: null },
        occurredAt: { gte: new Date(now - 90 * DAY_MS) },
        subtype: { is: { key: 'FALL' } },
      },
      _count: true,
      having: { primaryServiceUserId: { _count: { gte: 3 } } },
    });
    if (fallGroups.length) {
      const names = await this.resolveServiceUserNames(
        fallGroups.map((g) => g.primaryServiceUserId!).filter(Boolean),
      );
      for (const g of fallGroups.slice(0, 5)) {
        warnings.push({
          level: 'warning',
          label: `${g._count} falls recorded for ${names.get(g.primaryServiceUserId!) ?? 'a service user'} in the last 90 days`,
        });
      }
    }

    // Medication incidents per location this month.
    const medGroups = await this.prisma.incident.groupBy({
      by: ['locationId'],
      where: {
        deletedAt: null,
        isArchived: false,
        privacyLevel: privacy,
        locationId: { not: null },
        occurredAt: { gte: monthStart },
        category: { is: { key: 'MEDICATION' } },
      },
      _count: true,
      having: { locationId: { _count: { gte: 5 } } },
    });
    if (medGroups.length) {
      const names = await this.resolveLocationNames(
        medGroups.map((g) => g.locationId!).filter(Boolean),
      );
      for (const g of medGroups.slice(0, 5)) {
        warnings.push({
          level: 'warning',
          label: `${g._count} medication incidents at ${names.get(g.locationId!) ?? 'a location'} this month`,
        });
      }
    }

    return warnings;
  }

  private zeroSeverity(): Record<IncidentSeverity, number> {
    return {
      [IncidentSeverity.LOW]: 0,
      [IncidentSeverity.MEDIUM]: 0,
      [IncidentSeverity.HIGH]: 0,
      [IncidentSeverity.CRITICAL]: 0,
    };
  }

  private sortedEntries<T extends { count: number }>(
    map: Map<string, T>,
  ): [string, T][] {
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  }

  private topKeys(map: Map<string, number>, n: number): string[] {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k]) => k);
  }

  private lastMonths(
    map: Map<string, number>,
    n: number,
  ): { month: string; count: number }[] {
    const out: { month: string; count: number }[] = [];
    const d = new Date();
    d.setUTCDate(1);
    for (let i = n - 1; i >= 0; i--) {
      const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
      const key = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`;
      out.push({ month: key, count: map.get(key) ?? 0 });
    }
    return out;
  }

  private async resolveLocationNames(
    ids: string[],
  ): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.location.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async resolveServiceUserNames(
    ids: string[],
  ): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.serviceUser.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        [r.firstName, r.lastName].filter(Boolean).join(' ') || 'Unnamed',
      ]),
    );
  }
}
