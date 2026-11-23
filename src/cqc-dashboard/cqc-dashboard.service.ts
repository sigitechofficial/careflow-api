import { Injectable } from '@nestjs/common';
import {
  CqcEvidenceStatus,
  CqcMockActionStatus,
  CqcMockInspectionStatus,
  CqcNotificationStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { OrgScope } from '../common/org-scope/org-scope.types';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { CqcEvidenceService } from '../cqc-evidence/cqc-evidence.service';
import type { InspectionResult } from '../cqc-mock-inspection/cqc-mock-inspection-scoring.util';

const SUPER_ADMIN = 'Super Admin';
const OPEN_NOTIFICATION: CqcNotificationStatus[] = [
  CqcNotificationStatus.DRAFT,
  CqcNotificationStatus.READY,
];
/** No completed mock inspection for this long is worth flagging. */
const MOCK_STALE_DAYS = 183;
const DAY = 86_400_000;

export type AttentionItem = {
  kind:
    | 'EVIDENCE_GAPS'
    | 'EVIDENCE_REVIEW_OVERDUE'
    | 'ACTIONS_OVERDUE'
    | 'NOTIFICATIONS_OVERDUE'
    | 'NO_RECENT_MOCK';
  count: number;
  message: string;
};

/** "2026-11" for each month from `first` for `count` months. */
export function monthsFrom(first: string, count: number): string[] {
  const [y, m] = first.split('-').map(Number);
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7),
  );
}
const monthOf = (d: Date) => d.toISOString().slice(0, 7);
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** The rating of each key question in a stored mock inspection result. */
export function keyQuestionRatings(result: unknown) {
  const r = result as Partial<InspectionResult> | null;
  return (r?.keyQuestions ?? []).map((k) => ({
    code: k.keyQuestionCode,
    rating: k.rating ?? null,
    percent: k.percent ?? null,
  }));
}

/**
 * Governance → CQC dashboard and reports: one view of how ready the service is for CQC, from the
 * CQC evidence (coverage and gaps), mock inspections (the latest ratings and their improvement
 * actions) and statutory CQC notifications. Each part is shown only to people who may see it
 * (cqc_evidence.read, cqc_mock_inspection.read, cqc_notifications.read), within their branches; a
 * branch filter shows that branch plus whole-organisation records.
 */
@Injectable()
export class CqcDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly evidence: CqcEvidenceService,
  ) {}

  private can(user: RequestUser, permission: string) {
    return (
      Boolean(user.roles?.includes(SUPER_ADMIN)) ||
      Boolean(user.permissions?.includes(permission))
    );
  }

  /** Mock inspections the user may see, for the chosen branch (and whole-organisation ones). */
  private mockWhere(
    scope: OrgScope,
    locationId?: string,
  ): Prisma.CqcMockInspectionWhereInput {
    const and: Prisma.CqcMockInspectionWhereInput[] = [];
    if (scope.locationIds !== null)
      and.push({
        OR: [{ locationId: { in: scope.locationIds } }, { locationId: null }],
      });
    if (locationId) and.push({ OR: [{ locationId }, { locationId: null }] });
    return { AND: and };
  }

  private notificationWhere(
    scope: OrgScope,
    locationId?: string,
  ): Prisma.CqcNotificationWhereInput {
    const and: Prisma.CqcNotificationWhereInput[] = [];
    if (scope.locationIds !== null)
      and.push({ locationId: { in: scope.locationIds } });
    if (locationId) and.push({ locationId });
    return { AND: and };
  }

  private async evidenceWhere(
    user: RequestUser,
    scope: OrgScope,
    locationId?: string,
  ): Promise<Prisma.CqcEvidenceWhereInput> {
    return {
      AND: [
        await this.evidence.visibleWhere(scope, user),
        this.evidence.branchWhere(scope, locationId),
      ],
    };
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────

  async dashboard(
    user: RequestUser,
    query: { locationId?: string },
    now: Date = new Date(),
  ) {
    const scope = this.orgScope.fromRequestUser(user);
    if (query.locationId)
      this.orgScope.assertLocationAccess(scope, query.locationId);
    const canEvidence = this.can(user, 'cqc_evidence.read');
    const canMock = this.can(user, 'cqc_mock_inspection.read');
    const canNotifications = this.can(user, 'cqc_notifications.read');

    const [evidence, mock, notifications] = await Promise.all([
      canEvidence
        ? this.evidenceSection(user, scope, query.locationId, now)
        : null,
      canMock ? this.mockSection(scope, query.locationId, now) : null,
      canNotifications
        ? this.notificationSection(scope, query.locationId, now)
        : null,
    ]);

    const attention: AttentionItem[] = [];
    if (evidence?.totals.gaps)
      attention.push({
        kind: 'EVIDENCE_GAPS',
        count: evidence.totals.gaps,
        message: `${plural(evidence.totals.gaps, 'quality statement')} ${evidence.totals.gaps === 1 ? 'has' : 'have'} no current evidence.`,
      });
    if (evidence?.totals.reviewOverdue)
      attention.push({
        kind: 'EVIDENCE_REVIEW_OVERDUE',
        count: evidence.totals.reviewOverdue,
        message: `${plural(evidence.totals.reviewOverdue, 'piece')} of evidence ${evidence.totals.reviewOverdue === 1 ? 'is' : 'are'} past its review date.`,
      });
    if (mock?.actions.overdue)
      attention.push({
        kind: 'ACTIONS_OVERDUE',
        count: mock.actions.overdue,
        message: `${plural(mock.actions.overdue, 'improvement action')} ${mock.actions.overdue === 1 ? 'is' : 'are'} overdue.`,
      });
    if (notifications?.overdue)
      attention.push({
        kind: 'NOTIFICATIONS_OVERDUE',
        count: notifications.overdue,
        message: `${plural(notifications.overdue, 'CQC notification')} ${notifications.overdue === 1 ? 'is' : 'are'} past the target date and not yet sent.`,
      });
    if (
      mock &&
      (!mock.latest ||
        now.getTime() - new Date(mock.latest.completedAt).getTime() >
          MOCK_STALE_DAYS * DAY)
    )
      attention.push({
        kind: 'NO_RECENT_MOCK',
        count: 1,
        message: mock.latest
          ? 'The last completed mock inspection was more than 6 months ago.'
          : 'No mock inspection has been completed yet.',
      });

    return {
      data: {
        generatedAt: now.toISOString(),
        evidence,
        mock,
        notifications,
        attention,
      },
    };
  }

  private async evidenceSection(
    user: RequestUser,
    scope: OrgScope,
    locationId: string | undefined,
    now: Date,
  ) {
    const { data } = await this.evidence.overview(user, { locationId }, now);
    const where = await this.evidenceWhere(user, scope, locationId);
    const addedLast30Days = await this.prisma.cqcEvidence.count({
      where: {
        AND: [
          where,
          { status: CqcEvidenceStatus.CURRENT },
          { createdAt: { gte: new Date(now.getTime() - 30 * DAY) } },
        ],
      },
    });
    return {
      totals: { ...data.totals, addedLast30Days },
      keyQuestions: data.keyQuestions.map((k) => ({
        code: k.code,
        title: k.title,
        statementCount: k.statementCount,
        coveredCount: k.coveredCount,
        gapCount: k.gapCount,
      })),
    };
  }

  private async mockSection(
    scope: OrgScope,
    locationId: string | undefined,
    now: Date,
  ) {
    const where = this.mockWhere(scope, locationId);
    const [completed, byStatus, actions] = await Promise.all([
      this.prisma.cqcMockInspection.findMany({
        where: { AND: [where, { status: CqcMockInspectionStatus.COMPLETED }] },
        orderBy: { completedAt: 'desc' },
        take: 2,
        select: {
          id: true,
          title: true,
          completedAt: true,
          locationId: true,
          result: true,
        },
      }),
      this.prisma.cqcMockInspection.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.cqcMockInspectionAction.findMany({
        where: {
          inspection: {
            AND: [
              where,
              { status: { not: CqcMockInspectionStatus.CANCELLED } },
            ],
          },
          OR: [
            { status: CqcMockActionStatus.OPEN },
            { completedAt: { gte: new Date(now.getTime() - 30 * DAY) } },
          ],
        },
        select: {
          id: true,
          title: true,
          status: true,
          dueAt: true,
          completedAt: true,
          inspectionId: true,
          statement: { select: { title: true } },
        },
      }),
    ]);
    const summary = (r: (typeof completed)[number] | undefined) =>
      r
        ? {
            id: r.id,
            title: r.title,
            completedAt: r.completedAt!.toISOString(),
            overall:
              (r.result as Partial<InspectionResult> | null)?.overall ?? null,
            keyQuestions: keyQuestionRatings(r.result),
          }
        : null;
    const countOf = (status: CqcMockInspectionStatus) =>
      byStatus.find((g) => g.status === status)?._count._all ?? 0;
    const counts = {
      completed: countOf(CqcMockInspectionStatus.COMPLETED),
      inProgress: countOf(CqcMockInspectionStatus.IN_PROGRESS),
      cancelled: countOf(CqcMockInspectionStatus.CANCELLED),
      total: byStatus.reduce((n, g) => n + g._count._all, 0),
    };
    const open = actions.filter((a) => a.status === CqcMockActionStatus.OPEN);
    const overdue = open.filter(
      (a) => a.dueAt && a.dueAt.getTime() < now.getTime(),
    );
    const in7 = new Date(now.getTime() + 7 * DAY);
    const upcoming = [...open]
      .sort(
        (a, b) =>
          (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity),
      )
      .slice(0, 5);
    return {
      latest: summary(completed[0]),
      previous: summary(completed[1]),
      inProgress: counts.inProgress,
      counts,
      actions: {
        open: open.length,
        overdue: overdue.length,
        dueThisWeek: open.filter(
          (a) =>
            a.dueAt && a.dueAt.getTime() >= now.getTime() && a.dueAt <= in7,
        ).length,
        doneLast30Days: actions.filter(
          (a) => a.status === CqcMockActionStatus.DONE,
        ).length,
        next: upcoming.map((a) => ({
          id: a.id,
          title: a.title,
          statementTitle: a.statement?.title ?? null,
          dueAt: a.dueAt?.toISOString() ?? null,
          overdue: Boolean(a.dueAt && a.dueAt.getTime() < now.getTime()),
          inspectionId: a.inspectionId,
        })),
      },
    };
  }

  private async notificationSection(
    scope: OrgScope,
    locationId: string | undefined,
    now: Date,
  ) {
    const where = this.notificationWhere(scope, locationId);
    const [byStatus, open] = await Promise.all([
      this.prisma.cqcNotification.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.cqcNotification.findMany({
        where: { AND: [where, { status: { in: OPEN_NOTIFICATION } }] },
        orderBy: { dueAt: 'asc' },
        select: {
          id: true,
          referenceNumber: true,
          type: true,
          status: true,
          dueAt: true,
        },
      }),
    ]);
    const counts = Object.fromEntries(
      byStatus.map((s) => [s.status, s._count._all]),
    ) as Partial<Record<CqcNotificationStatus, number>>;
    return {
      byStatus: counts,
      open: open.length,
      overdue: open.filter((n) => n.dueAt.getTime() < now.getTime()).length,
      next: open.slice(0, 5).map((n) => ({
        id: n.id,
        referenceNumber: n.referenceNumber,
        type: n.type,
        status: n.status,
        dueAt: n.dueAt.toISOString(),
        overdue: n.dueAt.getTime() < now.getTime(),
      })),
    };
  }

  // ─── Reports ──────────────────────────────────────────────────────────────

  async reports(
    user: RequestUser,
    query: { locationId?: string; months?: number },
    now: Date = new Date(),
  ) {
    const scope = this.orgScope.fromRequestUser(user);
    if (query.locationId)
      this.orgScope.assertLocationAccess(scope, query.locationId);
    const count = query.months ?? 12;
    const months = monthsFrom(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count + 1, 1))
        .toISOString()
        .slice(0, 7),
      count,
    );
    const from = new Date(`${months[0]}-01T00:00:00.000Z`);
    const canEvidence = this.can(user, 'cqc_evidence.read');
    const canMock = this.can(user, 'cqc_mock_inspection.read');
    const canNotifications = this.can(user, 'cqc_notifications.read');
    const [evidence, mock, notifications] = await Promise.all([
      canEvidence
        ? this.evidenceReport(user, scope, query.locationId, months, from)
        : null,
      canMock ? this.mockReport(scope, query.locationId, months, from) : null,
      canNotifications
        ? this.notificationReport(scope, query.locationId, months, from)
        : null,
    ]);
    return {
      data: { months, from: from.toISOString(), evidence, mock, notifications },
    };
  }

  private async evidenceReport(
    user: RequestUser,
    scope: OrgScope,
    locationId: string | undefined,
    months: string[],
    from: Date,
  ) {
    const where = await this.evidenceWhere(user, scope, locationId);
    const [added, current] = await Promise.all([
      this.prisma.cqcEvidence.findMany({
        where: { AND: [where, { createdAt: { gte: from } }] },
        select: { createdAt: true, sourceType: true },
      }),
      this.prisma.cqcEvidence.findMany({
        where: { AND: [where, { status: CqcEvidenceStatus.CURRENT }] },
        select: { sourceType: true, categoryCode: true },
      }),
    ]);
    const byMonth = months.map((m) => ({ month: m, added: 0 }));
    for (const e of added) {
      const b = byMonth.find((x) => x.month === monthOf(e.createdAt));
      if (b) b.added += 1;
    }
    const tally = (values: string[]) =>
      Object.entries(
        values.reduce<Record<string, number>>((acc, v) => {
          acc[v] = (acc[v] ?? 0) + 1;
          return acc;
        }, {}),
      )
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count);
    return {
      byMonth,
      bySource: tally(current.map((e) => e.sourceType)),
      byCategory: tally(current.map((e) => e.categoryCode)),
    };
  }

  private async mockReport(
    scope: OrgScope,
    locationId: string | undefined,
    months: string[],
    from: Date,
  ) {
    const where = this.mockWhere(scope, locationId);
    const [inspections, actions, byStatus] = await Promise.all([
      this.prisma.cqcMockInspection.findMany({
        where: {
          AND: [
            where,
            {
              status: CqcMockInspectionStatus.COMPLETED,
              completedAt: { gte: from },
            },
          ],
        },
        orderBy: { completedAt: 'asc' },
        select: {
          id: true,
          title: true,
          completedAt: true,
          locationId: true,
          result: true,
        },
      }),
      this.prisma.cqcMockInspectionAction.findMany({
        where: {
          inspection: where,
          OR: [{ createdAt: { gte: from } }, { completedAt: { gte: from } }],
        },
        select: {
          createdAt: true,
          completedAt: true,
          dueAt: true,
          status: true,
        },
      }),
      // Inspections started or completed in the period, plus any still in progress.
      this.prisma.cqcMockInspection.groupBy({
        by: ['status'],
        where: {
          AND: [
            where,
            {
              OR: [
                { createdAt: { gte: from } },
                { completedAt: { gte: from } },
                { status: CqcMockInspectionStatus.IN_PROGRESS },
              ],
            },
          ],
        },
        _count: { _all: true },
      }),
    ]);
    const countOf = (status: CqcMockInspectionStatus) =>
      byStatus.find((g) => g.status === status)?._count._all ?? 0;
    const locationNames = new Map(
      (
        await this.prisma.location.findMany({
          where: {
            id: {
              in: inspections
                .map((i) => i.locationId)
                .filter((v): v is string => Boolean(v)),
            },
          },
          select: { id: true, name: true },
        })
      ).map((l) => [l.id, l.name]),
    );
    const actionsByMonth = months.map((m) => ({
      month: m,
      raised: 0,
      done: 0,
      doneLate: 0,
    }));
    for (const a of actions) {
      const raised = actionsByMonth.find(
        (x) => x.month === monthOf(a.createdAt),
      );
      if (raised && a.createdAt >= from) raised.raised += 1;
      if (a.completedAt) {
        const done = actionsByMonth.find(
          (x) => x.month === monthOf(a.completedAt!),
        );
        if (done) {
          done.done += 1;
          if (a.dueAt && a.completedAt > a.dueAt) done.doneLate += 1;
        }
      }
    }
    return {
      inspections: inspections.map((i) => ({
        id: i.id,
        title: i.title,
        completedAt: i.completedAt!.toISOString(),
        branch: i.locationId ? (locationNames.get(i.locationId) ?? null) : null,
        overall:
          (i.result as Partial<InspectionResult> | null)?.overall ?? null,
        keyQuestions: keyQuestionRatings(i.result),
      })),
      actionsByMonth,
      statusCounts: {
        completed: countOf(CqcMockInspectionStatus.COMPLETED),
        inProgress: countOf(CqcMockInspectionStatus.IN_PROGRESS),
        cancelled: countOf(CqcMockInspectionStatus.CANCELLED),
      },
    };
  }

  private async notificationReport(
    scope: OrgScope,
    locationId: string | undefined,
    months: string[],
    from: Date,
  ) {
    const rows = await this.prisma.cqcNotification.findMany({
      where: {
        AND: [
          this.notificationWhere(scope, locationId),
          { becameAwareAt: { gte: from } },
        ],
      },
      select: {
        type: true,
        status: true,
        becameAwareAt: true,
        dueAt: true,
        submittedAt: true,
      },
    });
    const byMonth = months.map((m) => ({ month: m, count: 0 }));
    const byType: Record<string, number> = {};
    let submitted = 0;
    let onTime = 0;
    for (const n of rows) {
      const b = byMonth.find((x) => x.month === monthOf(n.becameAwareAt));
      if (b) b.count += 1;
      byType[n.type] = (byType[n.type] ?? 0) + 1;
      if (n.submittedAt) {
        submitted += 1;
        if (n.submittedAt <= n.dueAt) onTime += 1;
      }
    }
    return {
      byMonth,
      byType: Object.entries(byType)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      submitted,
      submittedOnTime: onTime,
    };
  }
}
