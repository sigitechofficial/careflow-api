import { Injectable, NotFoundException } from '@nestjs/common';
import { LearningCertificateStatus, LearningCompetencyAssessmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LearningSettingsService } from './learning-settings.service';

@Injectable()
export class LearningEligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: LearningSettingsService,
  ) {}

  async getEmployeeEligibility(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null, isActive: true },
    });
    if (!employee) throw new NotFoundException('Employee not found or inactive');

    const settings = await this.settings.getOrCreate();
    const now = new Date();
    const warningMs = settings.defaultExpiryWarningDays * 86_400_000;

    const warnings: string[] = [];
    const restrictions: string[] = [];

    const expiredCertificates = await this.prisma.learningCertificate.findMany({
      where: {
        employeeId,
        OR: [
          { status: LearningCertificateStatus.EXPIRED },
          { status: LearningCertificateStatus.ACTIVE, expiresAt: { lt: now } },
        ],
        course: { isMandatory: true },
      },
      include: { course: { select: { title: true } } },
    });

    for (const cert of expiredCertificates) {
      restrictions.push(`Mandatory certificate expired: ${cert.course.title}`);
    }

    const expiringCertificates = await this.prisma.learningCertificate.findMany({
      where: {
        employeeId,
        status: LearningCertificateStatus.ACTIVE,
        expiresAt: { gte: now, lte: new Date(now.getTime() + warningMs) },
        course: { isMandatory: true },
      },
      include: { course: { select: { title: true } } },
    });

    for (const cert of expiringCertificates) {
      warnings.push(`Mandatory certificate expiring soon: ${cert.course.title}`);
    }

    const expiredCompetencies = await this.prisma.learningCompetencyAssessment.findMany({
      where: {
        employeeId,
        status: LearningCompetencyAssessmentStatus.APPROVED,
        validUntil: { lt: now },
      },
      include: { competency: { select: { name: true, isActive: true } } },
    });

    for (const assessment of expiredCompetencies) {
      if (assessment.competency.isActive) {
        restrictions.push(`Mandatory competency expired: ${assessment.competency.name}`);
      }
    }

    const expiringCompetencies = await this.prisma.learningCompetencyAssessment.findMany({
      where: {
        employeeId,
        status: LearningCompetencyAssessmentStatus.APPROVED,
        validUntil: { gte: now, lte: new Date(now.getTime() + warningMs) },
      },
      include: { competency: { select: { name: true, isActive: true } } },
    });

    for (const assessment of expiringCompetencies) {
      if (assessment.competency.isActive) {
        warnings.push(`Competency expiring soon: ${assessment.competency.name}`);
      }
    }

    return {
      eligible: restrictions.length === 0,
      warnings,
      restrictions,
    };
  }
}
