import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  CandidateStage,
  NotificationModule,
  NotificationSeverity,
  NotificationType,
} from '@prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RecruitmentNotificationHook {
  private readonly logger = new Logger(RecruitmentNotificationHook.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  private async userIdsForEmployee(employeeId: string | null | undefined): Promise<string[]> {
    if (!employeeId) return [];
    const pd = await this.prisma.employeePersonalDetail.findFirst({
      where: { employeeId, deletedAt: null },
      select: { email: true },
    });
    if (!pd?.email) return [];
    const users = await this.prisma.user.findMany({
      where: { email: { equals: pd.email, mode: 'insensitive' }, deletedAt: null, isActive: true },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  private async hrUserIds(): Promise<string[]> {
    const hrRole = await this.prisma.role.findFirst({
      where: { name: 'HR', deletedAt: null },
      select: { id: true },
    });
    if (!hrRole) return [];
    const links = await this.prisma.userRole.findMany({
      where: { roleId: hrRole.id },
      select: { userId: true },
    });
    const userIds = links.map((l) => l.userId);
    if (userIds.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, deletedAt: null, isActive: true },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  private async notify(
    recipientUserIds: string[],
    type: NotificationType,
    title: string,
    message: string,
    recordType: string,
    recordId: string,
  ) {
    if (!this.notifications || recipientUserIds.length === 0) return;
    const unique = [...new Set(recipientUserIds)];
    try {
      await this.notifications.notifyUsers({
        recipientUserIds: unique,
        type,
        module: NotificationModule.HR,
        severity: NotificationSeverity.INFO,
        title,
        message,
        recordType,
        recordId,
      });
    } catch (err) {
      this.logger.warn(`Recruitment notification failed: ${String(err)}`);
    }
  }

  async onApplicationReceived(params: {
    candidateId: string;
    candidateName: string;
    vacancyTitle: string;
    hiringManagerId?: string | null;
  }) {
    const recipients = [
      ...await this.userIdsForEmployee(params.hiringManagerId),
      ...await this.hrUserIds(),
    ];
    await this.notify(
      recipients,
      NotificationType.HR_APPLICATION_RECEIVED,
      'New application received',
      `${params.candidateName} applied for ${params.vacancyTitle}.`,
      'Candidate',
      params.candidateId,
    );
  }

  async onStageChange(params: {
    candidateId: string;
    candidateName: string;
    vacancyTitle: string;
    hiringManagerId?: string | null;
    toStage: CandidateStage;
  }) {
    const managerIds = await this.userIdsForEmployee(params.hiringManagerId);
    const hrIds = await this.hrUserIds();

    if (params.toStage === CandidateStage.SHORTLISTED) {
      await this.notify(
        managerIds,
        NotificationType.HR_CANDIDATE_SHORTLISTED,
        'Candidate shortlisted',
        `${params.candidateName} was shortlisted for ${params.vacancyTitle}.`,
        'Candidate',
        params.candidateId,
      );
    }

    if (params.toStage === CandidateStage.INTERVIEW) {
      await this.notify(
        managerIds,
        NotificationType.HR_INTERVIEW_SCHEDULED,
        'Candidate moved to interview',
        `${params.candidateName} is ready for interview (${params.vacancyTitle}).`,
        'Candidate',
        params.candidateId,
      );
    }

    if (params.toStage === CandidateStage.ACCEPTED) {
      await this.notify(
        [...managerIds, ...hrIds],
        NotificationType.HR_OFFER_ACCEPTED,
        'Offer accepted',
        `${params.candidateName} accepted the offer for ${params.vacancyTitle}.`,
        'Candidate',
        params.candidateId,
      );
    }
  }
}
