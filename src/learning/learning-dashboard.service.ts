import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LearningDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
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
      this.prisma.learningAssignment.count({ where: { employeeId: { not: null } } }),
      this.prisma.learningAssignment.count({ where: { status: 'OVERDUE' } }),
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
