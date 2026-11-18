import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LearningDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(locationId?: string) {
    let assignmentWhere: { employeeId: { not: null }; OR?: unknown[] } = {
      employeeId: { not: null },
    };
    let overdueWhere: { status: 'OVERDUE'; OR?: unknown[] } = { status: 'OVERDUE' };
    // Certificates / external training belong to a carer: scope them by the carer's location (17 Nov 2026).
    let employeeScope: { employeeId?: { in: string[] } } = {};

    if (locationId) {
      const employmentRows = await this.prisma.employeeEmployment.findMany({
        where: {
          OR: [
            { locationId },
            { baseLocationId: locationId },
            { floorLocations: { some: { locationId } } },
          ],
        },
        select: { employeeId: true },
      });
      const employeeIds = [...new Set(employmentRows.map((r) => r.employeeId))];
      const locationScope = [
        { locationId },
        ...(employeeIds.length ? [{ employeeId: { in: employeeIds } }] : []),
      ];
      assignmentWhere = { employeeId: { not: null }, OR: locationScope };
      overdueWhere = { status: 'OVERDUE', OR: locationScope };
      employeeScope = { employeeId: { in: employeeIds } };
    }

    const now = new Date();
    const [
      categories,
      courses,
      publishedCourses,
      assignments,
      overdueAssignments,
      certificates,
      competencies,
      trainingEvents,
      externalTrainingPending,
    ] = await Promise.all([
      this.prisma.learningCategory.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.learningCourse.count({ where: { deletedAt: null } }),
      this.prisma.learningCourse.count({ where: { deletedAt: null, status: 'PUBLISHED' } }),
      this.prisma.learningAssignment.count({ where: assignmentWhere as never }),
      this.prisma.learningAssignment.count({ where: overdueWhere as never }),
      this.prisma.learningCertificate.count({ where: { status: 'ACTIVE', ...employeeScope } }),
      this.prisma.learningCompetency.count({ where: { deletedAt: null, isActive: true } }),
      // Upcoming = not finished yet; sessions whose end time has passed are not upcoming (17 Nov 2026).
      this.prisma.learningTrainingEvent.count({
        where: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] }, endAt: { gte: now } },
      }),
      this.prisma.learningExternalTraining.count({
        where: { deletedAt: null, verificationStatus: 'PENDING', ...employeeScope },
      }),
    ]);

    // Assignment outcomes for compliance KPIs (cancelled / exempt ones are not owed).
    const in30 = new Date(now.getTime() + 30 * 86_400_000);
    const owed = { ...(assignmentWhere as object), status: { notIn: ['CANCELLED', 'EXEMPT'] } };
    const DONE = ['COMPLETED', 'PASSED'];
    const [byStatus, mandatoryOwed, mandatoryDone, dueNext30, certificatesExpiring30, certificatesExpired, policyTypeCourses] =
      await Promise.all([
        this.prisma.learningAssignment.groupBy({
          by: ['status'],
          where: assignmentWhere as never,
          orderBy: { status: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.learningAssignment.count({ where: { ...owed, isMandatory: true } as never }),
        this.prisma.learningAssignment.count({
          where: { ...(assignmentWhere as object), isMandatory: true, status: { in: DONE } } as never,
        }),
        this.prisma.learningAssignment.count({
          where: {
            ...(assignmentWhere as object),
            status: { notIn: [...DONE, 'CANCELLED', 'EXEMPT'] },
            dueAt: { gte: now, lte: in30 },
          } as never,
        }),
        this.prisma.learningCertificate.count({
          where: { status: 'ACTIVE', expiresAt: { gte: now, lte: in30 }, ...employeeScope },
        }),
        this.prisma.learningCertificate.count({
          where: { OR: [{ status: 'EXPIRED' }, { status: 'ACTIVE', expiresAt: { lt: now } }], ...employeeScope },
        }),
        // Read-and-sign belongs in the Policy Library; these are legacy 'policy' courses still in Learning.
        this.prisma.learningCourse.count({ where: { deletedAt: null, courseType: 'POLICY' } }),
      ]);
    const assignmentsByStatus: Record<string, number> = {};
    for (const g of byStatus) {
      const c = g._count;
      assignmentsByStatus[g.status] = typeof c === 'object' && c ? (c._all ?? 0) : 0;
    }
    const count = (...k: string[]) => k.reduce((n, key) => n + (assignmentsByStatus[key] ?? 0), 0);

    const extras = await this.dashboardExtras(assignmentWhere, now);

    return {
      ...extras,
      assignmentsByStatus,
      owedAssignments: assignments - count('CANCELLED', 'EXEMPT'),
      completedAssignments: count('COMPLETED', 'PASSED'),
      awaitingSignOff: count('AWAITING_ASSESSMENT', 'AWAITING_APPROVAL'),
      failedAssignments: count('FAILED'),
      expiredAssignments: count('EXPIRED'),
      mandatoryOwed,
      mandatoryCompleted: mandatoryDone,
      dueNext30,
      certificatesExpiring30,
      certificatesExpired,
      policyTypeCourses,
      categories,
      courses,
      publishedCourses,
      assignments,
      overdueAssignments,
      activeCertificates: certificates,
      competencies,
      upcomingTrainingEvents: trainingEvents,
      externalTrainingPending,
    };
  }

  /** Learning dashboard (17 Nov 2026): sessions needing attendance, next sessions, weakest mandatory courses. */
  private async dashboardExtras(assignmentWhere: object, now: Date) {
    const OPEN_EVENT = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] as const;
    const UNRECORDED = ['INVITED', 'BOOKED'] as const;
    const [sessionsNeedAttendance, nextEvents, mandatoryRows] = await Promise.all([
      // Session has ended but someone on it still has no attendance recorded.
      this.prisma.learningTrainingEvent.count({
        where: {
          status: { in: [...OPEN_EVENT] },
          endAt: { lt: now },
          attendees: { some: { attendanceStatus: { in: [...UNRECORDED] } } },
        } as never,
      }),
      this.prisma.learningTrainingEvent.findMany({
        where: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] }, endAt: { gte: now } },
        orderBy: { startAt: 'asc' },
        take: 5,
        select: {
          id: true,
          title: true,
          startAt: true,
          endAt: true,
          course: { select: { title: true } },
          _count: { select: { attendees: { where: { attendanceStatus: 'BOOKED' } } } },
        },
      }),
      this.prisma.learningAssignment.groupBy({
        by: ['courseId', 'status'],
        where: {
          ...(assignmentWhere as object),
          isMandatory: true,
          status: { notIn: ['CANCELLED', 'EXEMPT'] },
        } as never,
        orderBy: { courseId: 'asc' },
        _count: { _all: true },
      }),
    ]);

    const byCourse = new Map<string, { owed: number; done: number }>();
    for (const r of mandatoryRows as Array<{ courseId: string; status: string; _count: { _all?: number } }>) {
      const row = byCourse.get(r.courseId) ?? { owed: 0, done: 0 };
      const n = r._count?._all ?? 0;
      row.owed += n;
      if (r.status === 'COMPLETED' || r.status === 'PASSED') row.done += n;
      byCourse.set(r.courseId, row);
    }
    const weakest = [...byCourse.entries()]
      .filter(([, v]) => v.done < v.owed)
      .sort((a, b) => a[1].done / a[1].owed - b[1].done / b[1].owed || b[1].owed - a[1].owed)
      .slice(0, 5);
    const titles = weakest.length
      ? await this.prisma.learningCourse.findMany({
          where: { id: { in: weakest.map(([id]) => id) } },
          select: { id: true, title: true },
        })
      : [];
    const titleOf = new Map(titles.map((c) => [c.id, c.title]));

    return {
      sessionsNeedAttendance,
      nextSessions: nextEvents.map((e) => ({
        id: e.id,
        title: e.title,
        courseTitle: e.course?.title ?? null,
        startAt: e.startAt,
        endAt: e.endAt,
        booked: e._count.attendees,
      })),
      mandatoryCoursesLowest: weakest.map(([courseId, v]) => ({
        courseId,
        title: titleOf.get(courseId) ?? 'Course',
        owed: v.owed,
        completed: v.done,
      })),
    };
  }
}
