import { Injectable } from '@nestjs/common';
import { PolicyStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
  formatHmInTimeZone,
  operationalDayBounds,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import type { HandoverReportQueryDto } from './dto/handover-report-query.dto';

export type HandoverReportEntry = {
  id: string;
  serviceUserId: string;
  serviceUserName: string;
  occurredAt: string;
  timeLabel: string;
  task: string;
  carerName: string;
  carerId: string | null;
  notes: string;
  source: 'handover' | 'visit_note' | 'visit';
};

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  async handoverReport(query: HandoverReportQueryDto) {
    const settings = await this.orgSettings.get();
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const windowHours = Math.max(1, Math.min(168, settings.data.handoverReportLastHours ?? 12));
    const sortBy = query.sortBy ?? 'latest';

    const now = new Date();
    let rangeStart: Date;
    let rangeEnd: Date;
    let fromDate: string;
    let toDate: string;

    if (query.from?.trim() && query.to?.trim()) {
      fromDate = query.from.trim();
      toDate = query.to.trim();
      rangeStart = operationalDayBounds(fromDate, timeZone).start;
      rangeEnd = operationalDayBounds(toDate, timeZone).end;
    } else {
      rangeEnd = now;
      rangeStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
      fromDate = dayKeyInTimeZone(rangeStart, timeZone);
      toDate = operationalTodayIso(now, timeZone);
    }

    const nameFilter = query.serviceUserName?.trim() ?? '';

    const timelineEvents = await this.prisma.visitTimelineEvent.findMany({
      where: {
        isDraft: false,
        eventType: { in: ['handover', 'visit_note'] },
        occurredAt: { gte: rangeStart, lte: rangeEnd },
        detail: { not: null },
        scheduledJob: {
          deletedAt: null,
          ...(nameFilter
            ? {
                serviceUser: {
                  deletedAt: null,
                  OR: [
                    { preferredName: { contains: nameFilter, mode: 'insensitive' } },
                    { firstName: { contains: nameFilter, mode: 'insensitive' } },
                    { lastName: { contains: nameFilter, mode: 'insensitive' } },
                  ],
                },
              }
            : { serviceUser: { deletedAt: null } }),
        },
      },
      orderBy: { occurredAt: 'desc' },
      take: 200,
      select: {
        id: true,
        eventType: true,
        occurredAt: true,
        timeLabel: true,
        detail: true,
        createdByEmployeeId: true,
        scheduledJob: {
          select: {
            id: true,
            jobName: true,
            serviceUserId: true,
            serviceUser: {
              select: {
                id: true,
                preferredName: true,
                firstName: true,
                lastName: true,
              },
            },
            visits: {
              where: { deletedAt: null },
              orderBy: { scheduledStartDateTime: 'asc' },
              take: 1,
              select: { visitName: true, notes: true },
            },
            allocations: {
              where: { deletedAt: null, isActive: true },
              take: 4,
              select: {
                employeeId: true,
                isLeadCarer: true,
                employee: {
                  select: {
                    personalDetail: { select: { firstName: true, lastName: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const employeeIds = [
      ...new Set(
        timelineEvents
          .map((e) => e.createdByEmployeeId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const employeeNameById = await this.loadEmployeeNames(employeeIds);

    const entries: HandoverReportEntry[] = [];
    const seenJobNoteKeys = new Set<string>();

    for (const evt of timelineEvents) {
      const notes = (evt.detail ?? '').trim();
      if (!notes) continue;
      const su = evt.scheduledJob.serviceUser;
      const serviceUserName = serviceUserDisplayName(su);
      const primaryVisit = evt.scheduledJob.visits[0];
      const task =
        primaryVisit?.visitName?.trim() ||
        evt.scheduledJob.jobName?.trim() ||
        (evt.eventType === 'handover' ? 'Handover' : 'Visit note');
      const carerId = evt.createdByEmployeeId;
      const carerName =
        (carerId ? employeeNameById.get(carerId) : null) ||
        leadCarerName(evt.scheduledJob.allocations) ||
        '—';
      const occurredAt = evt.occurredAt;
      const clock = evt.timeLabel?.trim() || formatHmInTimeZone(occurredAt, timeZone);
      const timeLabel = `${clock} (${formatDayLabel(occurredAt, timeZone)})`;

      const dedupeKey = `${evt.scheduledJob.id}:${evt.eventType}`;
      seenJobNoteKeys.add(dedupeKey);

      entries.push({
        id: evt.id,
        serviceUserId: su.id,
        serviceUserName,
        occurredAt: occurredAt.toISOString(),
        timeLabel,
        task,
        carerName,
        carerId,
        notes,
        source: evt.eventType === 'handover' ? 'handover' : 'visit_note',
      });
    }

    // Fallback: completed visits with notes that never got a timeline handover/note event.
    const visitsWithNotes = await this.prisma.scheduledVisit.findMany({
      where: {
        deletedAt: null,
        notes: { not: null },
        OR: [
          { actualEndDateTime: { gte: rangeStart, lte: rangeEnd } },
          {
            actualEndDateTime: null,
            scheduledStartDateTime: { gte: rangeStart, lte: rangeEnd },
          },
        ],
        ...(nameFilter
          ? {
              serviceUser: {
                deletedAt: null,
                OR: [
                  { preferredName: { contains: nameFilter, mode: 'insensitive' } },
                  { firstName: { contains: nameFilter, mode: 'insensitive' } },
                  { lastName: { contains: nameFilter, mode: 'insensitive' } },
                ],
              },
            }
          : { serviceUser: { deletedAt: null } }),
      },
      orderBy: { scheduledStartDateTime: 'desc' },
      take: 200,
      select: {
        id: true,
        visitName: true,
        notes: true,
        scheduledStartDateTime: true,
        actualEndDateTime: true,
        serviceUserId: true,
        serviceUser: {
          select: {
            id: true,
            preferredName: true,
            firstName: true,
            lastName: true,
          },
        },
        scheduledJob: {
          select: {
            id: true,
            allocations: {
              where: { deletedAt: null, isActive: true },
              take: 4,
              select: {
                employeeId: true,
                isLeadCarer: true,
                employee: {
                  select: {
                    personalDetail: { select: { firstName: true, lastName: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    for (const visit of visitsWithNotes) {
      const notes = (visit.notes ?? '').trim();
      if (!notes) continue;
      const dedupeKey = `${visit.scheduledJob.id}:handover`;
      const dedupeNoteKey = `${visit.scheduledJob.id}:visit_note`;
      if (seenJobNoteKeys.has(dedupeKey) || seenJobNoteKeys.has(dedupeNoteKey)) continue;

      const occurredAt = visit.actualEndDateTime ?? visit.scheduledStartDateTime;
      const carerName = leadCarerName(visit.scheduledJob.allocations) || '—';
      entries.push({
        id: visit.id,
        serviceUserId: visit.serviceUser.id,
        serviceUserName: serviceUserDisplayName(visit.serviceUser),
        occurredAt: occurredAt.toISOString(),
        timeLabel: `${formatHmInTimeZone(occurredAt, timeZone)} (${formatDayLabel(occurredAt, timeZone)})`,
        task: visit.visitName?.trim() || 'Visit',
        carerName,
        carerId: visit.scheduledJob.allocations.find((a) => a.isLeadCarer)?.employeeId
          ?? visit.scheduledJob.allocations[0]?.employeeId
          ?? null,
        notes,
        source: 'visit',
      });
    }

    entries.sort((a, b) => {
      if (sortBy === 'name') return a.serviceUserName.localeCompare(b.serviceUserName);
      if (sortBy === 'earliest') {
        return a.occurredAt.localeCompare(b.occurredAt);
      }
      return b.occurredAt.localeCompare(a.occurredAt);
    });

    return {
      data: {
        windowHours,
        from: fromDate,
        to: toDate,
        fromIso: rangeStart.toISOString(),
        toIso: rangeEnd.toISOString(),
        organisationTimezone: timeZone,
        entries,
      },
    };
  }

  private async loadEmployeeNames(ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!ids.length) return map;
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: {
        id: true,
        personalDetail: { select: { firstName: true, lastName: true } },
      },
    });
    for (const row of rows) {
      const name = [row.personalDetail?.firstName, row.personalDetail?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (name) map.set(row.id, name);
    }
    return map;
  }

  /**
   * Published policies due for review within `days` days (overdue included), by the review date on
   * each document's current version. Dates are compared as organisation-local calendar days.
   */
  async policyReviews(days: number) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = operationalTodayIso(new Date(), timeZone);
    const until = addDaysToOperationalIso(today, days);

    const [statusGroups, published] = await Promise.all([
      this.prisma.policyDocument.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.policyDocument.findMany({
        where: { deletedAt: null, status: PolicyStatus.PUBLISHED },
        select: { id: true, reference: true, title: true, currentVersionId: true },
      }),
    ]);

    const versionIds = published.map(p => p.currentVersionId).filter((v): v is string => !!v);
    const versions = versionIds.length
      ? await this.prisma.policyVersion.findMany({
          where: { id: { in: versionIds } },
          select: { id: true, reviewDate: true },
        })
      : [];
    const reviewByVersion = new Map(versions.map(v => [v.id, v.reviewDate]));

    let publishedNoReviewDate = 0;
    const items: Array<{ id: string; reference: string; title: string; reviewDate: string; overdue: boolean }> = [];
    for (const p of published) {
      const reviewDate = p.currentVersionId ? reviewByVersion.get(p.currentVersionId) ?? null : null;
      if (!reviewDate) {
        publishedNoReviewDate++;
        continue;
      }
      // @db.Date values come back as UTC midnight, so the ISO date part is the stored calendar day.
      const day = reviewDate.toISOString().slice(0, 10);
      if (day > until) continue;
      items.push({ id: p.id, reference: p.reference, title: p.title, reviewDate: day, overdue: day < today });
    }
    items.sort((a, b) => a.reviewDate.localeCompare(b.reviewDate));

    return {
      data: {
        days,
        byStatus: Object.fromEntries(statusGroups.map(g => [g.status, g._count._all])),
        publishedNoReviewDate,
        count: items.length,
        overdue: items.filter(i => i.overdue).length,
        items,
      },
    };
  }
}

function serviceUserDisplayName(su: {
  preferredName: string | null;
  firstName: string;
  lastName: string;
}): string {
  return (
    su.preferredName?.trim() ||
    [su.firstName, su.lastName].filter(Boolean).join(' ').trim() ||
    'Service user'
  );
}

function leadCarerName(
  allocations: Array<{
    isLeadCarer: boolean;
    employee?: { personalDetail?: { firstName: string | null; lastName: string | null } | null } | null;
  }>,
): string | null {
  const ordered = [...allocations].sort((a, b) => Number(b.isLeadCarer) - Number(a.isLeadCarer));
  for (const a of ordered) {
    const p = a.employee?.personalDetail;
    const name = [p?.firstName, p?.lastName].filter(Boolean).join(' ').trim();
    if (name) return name;
  }
  return null;
}

function formatDayLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(instant);
}
