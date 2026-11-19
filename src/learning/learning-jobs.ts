import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  LearningAssignmentStatus,
  LearningAssignmentType,
  LearningCertificateStatus,
  LearningNotificationEventType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LearningComplianceService } from './learning-compliance.service';
import { LearningPushService } from './learning-push.service';
import { LearningNotificationHook } from './learning-notification.hook';
import { LearningSettingsService } from './learning-settings.service';
import { LearningCompletionService } from './learning-completion.service';
import { LearningTasksService } from './learning-tasks.service';
import { JobHandler } from '../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../jobs/job-runner.service';
import { jobSkipped, jobSuccess, type JobOutcome } from '../jobs/job-run.types';

@Injectable()
export class LearningJobs {
  private readonly logger = new Logger(LearningJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: LearningSettingsService,
    private readonly complianceService: LearningComplianceService,
    private readonly notifications: LearningNotificationHook,
    private readonly push: LearningPushService,
    private readonly completion: LearningCompletionService,
    private readonly tasks: LearningTasksService,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  /** 02:30 UTC (was 02:00) to match the job catalogue and stay clear of the rolling rota. */
  @Cron('30 2 * * *', { timeZone: 'UTC' })
  async runDailyMaintenance() {
    await runCronTick(this.jobRunner, 'learning-maintenance', () =>
      this.runMaintenance(),
    );
  }

  @JobHandler('learning-maintenance')
  async runMaintenance(): Promise<JobOutcome> {
    if (!(await this.notifications.isLearningModuleActive())) {
      this.notifications.logSkipped('Learning module not active');
      return jobSkipped('Learning module not active');
    }

    const certificatesExpired = await this.markExpiredCertificates();
    const refresherAssignmentsCreated = await this.createRefresherAssignments();
    const assignmentsMarkedOverdue = await this.markOverdueAssignments();
    const reminders = await this.sendReminders();
    const progressRecalculated = await this.recalculateOpenProgress();
    // My tasks: open / close Learning tasks after overdue, expiry and reminders (18 Nov 2026).
    const tasksChecked = await this.tasks.reconcileAll();
    this.logger.log('Learning daily maintenance completed');
    return jobSuccess({
      certificatesExpired,
      progressRecalculated,
      tasksChecked,
      refresherAssignmentsCreated,
      assignmentsMarkedOverdue,
      dueSoonReminders: reminders.dueSoon,
      expiringCertificateReminders: reminders.expiringCertificates,
    });
  }

  private async markExpiredCertificates(): Promise<number> {
    const now = new Date();
    const expired = await this.prisma.learningCertificate.findMany({
      where: {
        status: LearningCertificateStatus.ACTIVE,
        expiresAt: { lt: now },
      },
      select: { id: true, employeeId: true, certificateNumber: true, course: { select: { title: true } } },
    });

    if (expired.length === 0) return 0;

    await this.prisma.learningCertificate.updateMany({
      where: { id: { in: expired.map((c) => c.id) } },
      data: { status: LearningCertificateStatus.EXPIRED },
    });

    for (const cert of expired) {
      await this.notifications.notifyCertificateExpired({
        employeeId: cert.employeeId,
        certificateId: cert.id,
        certificateNumber: cert.certificateNumber,
      });
      try {
        await this.notifications.notifyManagersCertificateExpired({
          employeeId: cert.employeeId,
          certificateId: cert.id,
          certificateNumber: cert.certificateNumber,
          courseTitle: cert.course?.title ?? 'Course',
        });
      } catch (e) {
        this.logger.warn(`Expired notice to managers failed for certificate ${cert.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return expired.length;
  }

  private async createRefresherAssignments(): Promise<number> {
    const settings = await this.settingsService.getOrCreate();
    if (!settings.automaticRefresherAssignment) return 0;
    let created = 0;

    const now = new Date();
    const certificates = await this.prisma.learningCertificate.findMany({
      where: {
        status: LearningCertificateStatus.EXPIRED,
        // No automatic refresher for withdrawn or archived courses (no new assignments).
        course: {
          refresherFrequencyDays: { not: null },
          deletedAt: null,
          status: { notIn: ['WITHDRAWN', 'ARCHIVED'] },
        },
      },
      include: {
        course: { select: { id: true, title: true, refresherFrequencyDays: true, currentVersionId: true } },
      },
    });

    for (const cert of certificates) {
      if (!cert.course.refresherFrequencyDays) continue;

      const existing = await this.prisma.learningAssignment.findFirst({
        where: {
          employeeId: cert.employeeId,
          courseId: cert.courseId,
          refresherOfAssignmentId: cert.assignmentId,
          status: { in: this.notifications.activeAssignmentStatuses() },
        },
      });
      if (existing) continue;

      const versionId =
        cert.courseVersionId ??
        cert.course.currentVersionId ??
        (
          await this.prisma.learningCourseVersion.findFirst({
            where: { courseId: cert.courseId, status: 'PUBLISHED' },
            orderBy: { versionNumber: 'desc' },
          })
        )?.id;

      if (!versionId) continue;

      await this.prisma.$transaction(async (tx) => {
        const assignment = await tx.learningAssignment.create({
          data: {
            assignmentType: LearningAssignmentType.REFRESHER,
            courseId: cert.courseId,
            courseVersionId: versionId,
            employeeId: cert.employeeId,
            refresherOfAssignmentId: cert.assignmentId,
            isMandatory: true,
            status: LearningAssignmentStatus.ASSIGNED,
            dueAt: new Date(now.getTime() + settings.defaultAssignmentDueDays * 86_400_000),
          },
        });

        await tx.learningEmployeeProgress.create({
          data: {
            assignmentId: assignment.id,
            employeeId: cert.employeeId,
            courseVersionId: versionId,
          },
        });
      });
      created += 1;
    }
    return created;
  }

  /**
   * Open courses: bring the stored % in line with the whole-course rule (18 Nov 2026), e.g. after
   * the rule changed or a course was edited. Only the % changes; never status or started.
   */
  private async recalculateOpenProgress(): Promise<number> {
    const open = await this.prisma.learningAssignment.findMany({
      where: {
        status: {
          in: [
            LearningAssignmentStatus.ASSIGNED,
            LearningAssignmentStatus.NOT_STARTED,
            LearningAssignmentStatus.IN_PROGRESS,
            LearningAssignmentStatus.AWAITING_ASSESSMENT,
            LearningAssignmentStatus.AWAITING_APPROVAL,
            LearningAssignmentStatus.OVERDUE,
          ],
        },
        progress: { isNot: null },
      },
      select: { id: true },
    });
    let changed = 0;
    for (const row of open) {
      try {
        if (await this.completion.recalculatePercentage(row.id)) changed += 1;
      } catch (e) {
        this.logger.warn(`Progress % not recalculated for assignment ${row.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return changed;
  }

  private async markOverdueAssignments(): Promise<number> {
    const now = new Date();
    const overdue = await this.prisma.learningAssignment.findMany({
      where: {
        dueAt: { lt: now },
        status: {
          in: [
            LearningAssignmentStatus.ASSIGNED,
            LearningAssignmentStatus.NOT_STARTED,
            LearningAssignmentStatus.IN_PROGRESS,
            LearningAssignmentStatus.AWAITING_ASSESSMENT,
            LearningAssignmentStatus.AWAITING_APPROVAL,
          ],
        },
      },
      include: { course: { select: { title: true } } },
    });

    for (const row of overdue) {
      await this.prisma.learningAssignment.update({
        where: { id: row.id },
        data: { status: LearningAssignmentStatus.OVERDUE },
      });
      if (row.employeeId) {
        await this.complianceService.recalculateForAssignment(row.id);
        await this.notifications.notifyDueOrOverdue({
          employeeId: row.employeeId,
          assignmentId: row.id,
          courseTitle: row.course.title,
          eventType: 'OVERDUE',
        });
        // Sent once: the assignment only becomes OVERDUE once.
        await this.push.overdue(row.employeeId, row.id, row.course.title);
        try {
          await this.notifications.notifyManagersOverdue({
            employeeId: row.employeeId,
            assignmentId: row.id,
            courseTitle: row.course.title,
            dueAt: row.dueAt,
          });
        } catch (e) {
          this.logger.warn(`Overdue notice to managers failed for assignment ${row.id}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    return overdue.length;
  }

  private async sendReminders(): Promise<{
    dueSoon: number;
    expiringCertificates: number;
  }> {
    const settings = await this.settingsService.getOrCreate();
    const now = new Date();
    const horizon = new Date(now.getTime() + settings.defaultExpiryWarningDays * 86_400_000);

    const dueSoon = await this.prisma.learningAssignment.findMany({
      where: {
        dueAt: { gte: now, lte: horizon },
        status: { in: this.notifications.activeAssignmentStatuses() },
        employeeId: { not: null },
      },
      include: { course: { select: { title: true } } },
    });

    for (const row of dueSoon) {
      if (!row.employeeId) continue;
      await this.notifications.notifyDueOrOverdue({
        employeeId: row.employeeId,
        assignmentId: row.id,
        courseTitle: row.course.title,
        eventType: 'DUE_SOON',
      });
    }

    const expiringCerts = await this.prisma.learningCertificate.findMany({
      where: {
        status: LearningCertificateStatus.ACTIVE,
        expiresAt: { gte: now, lte: horizon },
      },
      include: { course: { select: { title: true } } },
    });

    // Carer and the carer's training managers, each once per certificate (18 Nov 2026).
    for (const cert of expiringCerts) {
      try {
        await this.notifications.notifyCertificateExpiring({
          employeeId: cert.employeeId,
          certificateId: cert.id,
          certificateNumber: cert.certificateNumber,
          expiresAt: cert.expiresAt!,
        });
      } catch (e) {
        this.logger.warn(`Expiry warning to carer failed for certificate ${cert.id}: ${e instanceof Error ? e.message : e}`);
      }
      try {
        await this.notifications.notifyManagersCertificateExpiring({
          employeeId: cert.employeeId,
          certificateId: cert.id,
          certificateNumber: cert.certificateNumber,
          courseTitle: cert.course?.title ?? 'Course',
          expiresAt: cert.expiresAt!,
        });
      } catch (e) {
        this.logger.warn(`Expiry warning to managers failed for certificate ${cert.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return {
      dueSoon: dueSoon.length,
      expiringCertificates: expiringCerts.length,
    };
  }
}
