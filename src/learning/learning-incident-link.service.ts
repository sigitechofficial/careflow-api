import { Injectable, Logger } from '@nestjs/common';
import { IncidentActionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';

type Db = Prisma.TransactionClient | PrismaService;

const INCIDENT_SOURCE = 'Incident';

function ukDate(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(d);
}

/**
 * Keeps an incident's "Course for carer" measure in step with the carer's learning assignment
 * (17 Nov 2026): the measure completes itself when the course is passed, and a course given
 * again stays linked to the same incident measure.
 */
@Injectable()
export class LearningIncidentLinkService {
  private readonly logger = new Logger(LearningIncidentLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  /** Course passed: complete the incident measure that gave it (if still open). Never throws. */
  async onAssignmentCompleted(assignmentId: string, db: Db = this.prisma): Promise<void> {
    try {
      const a = await db.learningAssignment.findUnique({
        where: { id: assignmentId },
        select: { sourceEntityType: true, completedAt: true },
      });
      if (a?.sourceEntityType !== INCIDENT_SOURCE) return;
      const rec = await db.incidentCarerCourseRecommendation.findFirst({
        where: { learningAssignmentId: assignmentId },
        select: { id: true },
      });
      if (!rec) return;
      const measure = await db.incidentAction.findFirst({
        where: {
          courseRecommendationId: rec.id,
          status: { notIn: [IncidentActionStatus.COMPLETED, IncidentActionStatus.CANCELLED] },
        },
        select: { id: true, title: true, status: true, incidentId: true },
      });
      if (!measure) return;

      const [attempt, certificate] = await Promise.all([
        db.learningAssessmentAttempt.findFirst({
          where: { assignmentId, result: 'PASSED' },
          orderBy: { submittedAt: 'desc' },
          select: { percentage: true },
        }),
        db.learningCertificate.findFirst({
          where: { assignmentId },
          orderBy: { issuedAt: 'desc' },
          select: { certificateNumber: true },
        }),
      ]);
      const parts = [`Course passed on ${ukDate(a.completedAt ?? new Date())}`];
      if (attempt?.percentage != null) parts.push(`quiz ${Math.round(Number(attempt.percentage))}%`);
      if (certificate) parts.push(`certificate ${certificate.certificateNumber}`);
      const completionNotes = `${parts.join(' · ')}. Completed automatically from Learning.`;

      await db.incidentAction.update({
        where: { id: measure.id },
        data: {
          status: IncidentActionStatus.COMPLETED,
          completionNotes,
          completedAt: new Date(),
          completedById: null,
        },
      });
      await this.audit.logAudit({
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_UPDATED,
        recordType: 'IncidentAction',
        recordId: measure.id,
        description: `Action completed: ${measure.title} (course passed in Learning)`,
        oldValues: { status: measure.status },
        newValues: { status: IncidentActionStatus.COMPLETED, completionNotes, learningAssignmentId: assignmentId },
      });
    } catch (e) {
      this.logger.warn(
        `Could not update the incident measure for learning assignment ${assignmentId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /**
   * A course given again: the new assignment keeps the incident source, and the incident
   * measure now follows the new assignment. Never throws.
   */
  async carrySource(oldAssignmentId: string, newAssignmentId: string): Promise<void> {
    try {
      const old = await this.prisma.learningAssignment.findUnique({
        where: { id: oldAssignmentId },
        select: { sourceEntityType: true, sourceEntityId: true, isMandatory: true },
      });
      if (old?.sourceEntityType !== INCIDENT_SOURCE) return;
      await this.prisma.$transaction([
        this.prisma.learningAssignment.update({
          where: { id: newAssignmentId },
          data: {
            sourceEntityType: old.sourceEntityType,
            sourceEntityId: old.sourceEntityId,
            isMandatory: old.isMandatory,
          },
        }),
        this.prisma.incidentCarerCourseRecommendation.updateMany({
          where: { learningAssignmentId: oldAssignmentId },
          data: { learningAssignmentId: newAssignmentId },
        }),
      ]);
    } catch (e) {
      this.logger.warn(
        `Could not carry the incident link to learning assignment ${newAssignmentId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
}
