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

    return {
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
