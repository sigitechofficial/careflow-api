import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { IncidentsService } from './incidents.service';

/** Starts scheduled interim suspensions on their start date (checked hourly, organisation timezone). */
@Injectable()
export class IncidentSuspensionStartJob {
  private readonly logger = new Logger(IncidentSuspensionStartJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly incidents: IncidentsService,
  ) {}

  @Cron('5 * * * *', { timeZone: 'UTC' })
  async handleScheduledSuspensions(): Promise<void> {
    const systemUser = await this.prisma.user.findFirst({
      where: { deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!systemUser) {
      this.logger.warn('Suspension start job skipped — no active user for audit');
      return;
    }
    const started = await this.incidents.startScheduledSuspensions(systemUser.id);
    if (started > 0) this.logger.log(`Started ${started} scheduled carer suspension(s)`);
  }
}
