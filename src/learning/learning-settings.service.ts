import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertLearningSettingsDto } from './dto/learning.dto';

@Injectable()
export class LearningSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private map(row: {
    id: string;
    defaultExpiryWarningDays: number;
    defaultAssignmentDueDays: number;
    allowEmployeeExternalTrainingSubmission: boolean;
    requireManagerApprovalForExternalTraining: boolean;
    automaticRefresherAssignment: boolean;
    automaticOverdueEscalation: boolean;
    defaultCertificateValidityDays: number;
    allowCourseAccessAfterExpiry: boolean;
    allowCourseRetakeAfterPass: boolean;
    complianceCalculationMode: string;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      defaultExpiryWarningDays: row.defaultExpiryWarningDays,
      defaultAssignmentDueDays: row.defaultAssignmentDueDays,
      allowEmployeeExternalTrainingSubmission: row.allowEmployeeExternalTrainingSubmission,
      requireManagerApprovalForExternalTraining: row.requireManagerApprovalForExternalTraining,
      automaticRefresherAssignment: row.automaticRefresherAssignment,
      automaticOverdueEscalation: row.automaticOverdueEscalation,
      defaultCertificateValidityDays: row.defaultCertificateValidityDays,
      allowCourseAccessAfterExpiry: row.allowCourseAccessAfterExpiry,
      allowCourseRetakeAfterPass: row.allowCourseRetakeAfterPass,
      complianceCalculationMode: row.complianceCalculationMode,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getOrCreate() {
    const existing = await this.prisma.learningSettings.findFirst();
    if (existing) return existing;

    return this.prisma.learningSettings.create({ data: {} });
  }

  async get() {
    const row = await this.getOrCreate();
    return this.map(row);
  }

  async upsert(userId: string, dto: UpsertLearningSettingsDto) {
    const existing = await this.getOrCreate();
    const row = await this.prisma.learningSettings.update({
      where: { id: existing.id },
      data: { ...dto, updatedById: userId },
    });
    return this.map(row);
  }
}
