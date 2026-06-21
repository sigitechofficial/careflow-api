import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ServiceUserVisitPlansService } from '../service-user-visit-plans/service-user-visit-plans.service';

@Injectable()
export class VisitPlanScheduledEndJob {
  private readonly logger = new Logger(VisitPlanScheduledEndJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly visitPlans: ServiceUserVisitPlansService,
  ) {}

  @Cron('30 0 * * *', { timeZone: 'UTC' })
  async handleScheduledEndPlans(): Promise<void> {
    const systemUser = await this.prisma.user.findFirst({
      where: { deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!systemUser) {
      this.logger.warn('Scheduled end job skipped — no active user for audit');
      return;
    }
    const ended = await this.visitPlans.processScheduledEndPlans(systemUser.id);
    if (ended > 0) {
      this.logger.log(`Auto-ended ${ended} visit plan(s) after scheduled closure date`);
    }
  }
}
