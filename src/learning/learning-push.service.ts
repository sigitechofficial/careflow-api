import { Injectable, Logger, Optional } from '@nestjs/common';
import { FcmPushService } from '../notifications/fcm-push.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  formatNotificationDate,
  formatNotificationDateTime,
  loadNotificationDisplay,
} from '../common/utils/notification-display.util';

/**
 * Phone push for the carer app's Learn tab (type LEARNING, opens the course).
 * Failures never block the action that triggered them.
 */
@Injectable()
export class LearningPushService {
  private readonly logger = new Logger(LearningPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly push?: FcmPushService,
  ) {}

  private async send(
    employeeId: string,
    assignmentId: string,
    title: string,
    body: string,
    kind: string,
  ) {
    if (!this.push) return;
    try {
      await this.push.sendToEmployees(
        [employeeId],
        { title, body, data: { type: 'LEARNING', assignmentId } },
        kind,
      );
    } catch (err) {
      this.logger.warn(
        `Learning push failed for assignment ${assignmentId}: ${String(err)}`,
      );
    }
  }

  /** One push per carer, each opening their own assignment. */
  async assigned(
    rows: {
      employeeId: string | null;
      assignmentId: string;
      /** The carer's own due date, when it differs from the shared one. */
      dueAt?: Date | null;
    }[],
    courseTitle: string,
    dueAt?: Date | null,
  ) {
    const display = await loadNotificationDisplay(this.prisma);
    for (const r of rows) {
      if (!r.employeeId) continue;
      const own = r.dueAt !== undefined ? r.dueAt : dueAt;
      const due = own ? ` Due ${formatNotificationDate(own, display)}.` : '';
      await this.send(
        r.employeeId,
        r.assignmentId,
        'New training',
        `You have been assigned "${courseTitle}".${due}`,
        'training-assigned',
      );
    }
  }

  async overdue(employeeId: string, assignmentId: string, courseTitle: string) {
    await this.send(
      employeeId,
      assignmentId,
      'Training overdue',
      `"${courseTitle}" is overdue. Please finish it as soon as you can.`,
      'training-due',
    );
  }

  async dueDateExtended(params: {
    employeeId: string;
    assignmentId: string;
    courseTitle: string;
    dueAt: Date;
  }) {
    const display = await loadNotificationDisplay(this.prisma);
    await this.send(
      params.employeeId,
      params.assignmentId,
      'New due date',
      `"${params.courseTitle}" is open again. New due date: ${formatNotificationDate(params.dueAt, display)}.`,
      'training-due',
    );
  }

  async outcome(params: {
    employeeId: string;
    assignmentId: string;
    courseTitle: string;
    passed: boolean;
    /** Practical passed; the carer still has to pass the quiz. */
    quizNext?: boolean;
  }) {
    await this.send(
      params.employeeId,
      params.assignmentId,
      params.quizNext ? 'Practical passed' : params.passed ? 'Training passed' : 'Training not passed',
      params.quizNext
        ? `You passed the practical for "${params.courseTitle}". Now take the quiz in the app to finish the course.`
        : params.passed
        ? `Your manager has passed you on "${params.courseTitle}".`
        : `Your manager has recorded "${params.courseTitle}" as not passed. They will arrange more training.`,
      'training-assigned',
    );
  }

  async sessionBooked(params: {
    employeeId: string;
    assignmentId: string;
    courseTitle: string;
    startAt: Date;
  }) {
    const display = await loadNotificationDisplay(this.prisma);
    await this.send(
      params.employeeId,
      params.assignmentId,
      'Training session booked',
      `"${params.courseTitle}" on ${formatNotificationDateTime(params.startAt, display)}.`,
      'training-sessions',
    );
  }

  async sessionCancelled(params: {
    employeeId: string;
    assignmentId: string;
    courseTitle: string;
    startAt: Date;
  }) {
    const display = await loadNotificationDisplay(this.prisma);
    await this.send(
      params.employeeId,
      params.assignmentId,
      'Training session cancelled',
      `The "${params.courseTitle}" session on ${formatNotificationDateTime(params.startAt, display)} is cancelled. The office will book you on another one.`,
      'training-sessions',
    );
  }
}
