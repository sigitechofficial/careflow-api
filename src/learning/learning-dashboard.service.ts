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
    }

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
      this.prisma.learningCertificate.count({ where: { status: 'ACTIVE' } }),
      this.prisma.learningCompetency.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.learningTrainingEvent.count({ where: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } } }),
      this.prisma.learningExternalTraining.count({
        where: { deletedAt: null, verificationStatus: 'PENDING' },
      }),
    ]);

    // Assignment outcomes for compliance KPIs (cancelled / exempt ones are not owed).
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86_400_000);
    const owed = { ...(assignmentWhere as object), status: { notIn: ['CANCELLED', 'EXEMPT'] } };
    const DONE = ['COMPLETED', 'PASSED'];
    const [byStatus, mandatoryOwed, mandatoryDone, dueNext30, certificatesExpiring30, certificatesExpired] =
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
        this.prisma.learningCertificate.count({ where: { status: 'ACTIVE', expiresAt: { gte: now, lte: in30 } } }),
        this.prisma.learningCertificate.count({
          where: { OR: [{ status: 'EXPIRED' }, { status: 'ACTIVE', expiresAt: { lt: now } }] },
        }),
      ]);
    const assignmentsByStatus: Record<string, number> = {};
    for (const g of byStatus) {
      const c = g._count;
      assignmentsByStatus[g.status] = typeof c === 'object' && c ? (c._all ?? 0) : 0;
    }
    const count = (...k: string[]) => k.reduce((n, key) => n + (assignmentsByStatus[key] ?? 0), 0);

    return {
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
}
