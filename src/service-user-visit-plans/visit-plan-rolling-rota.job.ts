import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { VisitPlanBulkScheduleService } from './visit-plan-bulk-schedule.service';
import {
  clampAutoExtendRotaRunHour,
  clampRotaHorizonDays,
  currentHourInTimeZone,
  londonTodayIsoDate,
  resolveRollingRotaDayToGenerate,
  ROTA_ROLLING_TIMEZONE,
} from './visit-plan-rolling-rota.util';

@Injectable()
export class VisitPlanRollingRotaJob {
  private readonly logger = new Logger(VisitPlanRollingRotaJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bulkSchedule: VisitPlanBulkScheduleService,
  ) {}

  /** Hourly check; runs bulk extend once per day at the configured London hour. */
  @Cron('0 * * * *', { timeZone: ROTA_ROLLING_TIMEZONE })
  async handleRollingRotaExtension(): Promise<void> {
    const settings = await this.prisma.organisationGeneralSettings.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: {
        domAutoExtendRotaEnabled: true,
        domRotaHorizonDays: true,
        domAutoExtendRotaRunHour: true,
      },
    });
    if (!settings?.domAutoExtendRotaEnabled) return;

    const now = new Date();
    const runHour = clampAutoExtendRotaRunHour(settings.domAutoExtendRotaRunHour);
    const currentHour = currentHourInTimeZone(now, ROTA_ROLLING_TIMEZONE);
    if (currentHour !== runHour) return;

    const systemUser = await this.prisma.user.findFirst({
      where: { deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!systemUser) {
      this.logger.warn('Rolling rota job skipped — no active user for audit');
      return;
    }

    const today = londonTodayIsoDate(now);
    const horizonDays = clampRotaHorizonDays(settings.domRotaHorizonDays);
    const dayToGenerate = resolveRollingRotaDayToGenerate(today, horizonDays);

    try {
      const response = await this.bulkSchedule.bulkGenerate(systemUser.id, {
        fromDate: dayToGenerate,
        toDate: dayToGenerate,
        readyOnly: true,
      });

      const totals = response.data.totals;
      this.logger.log(
        `Rolling rota extended ${dayToGenerate} (horizon ${horizonDays}d): ` +
          `${totals.visitsCreated} created, ${totals.visitsSkipped} skipped, ` +
          `${totals.succeeded} plans ok, ${totals.failed} failed, ${totals.skipped} skipped plans`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Rolling rota job failed for ${dayToGenerate}: ${message}`);
    }
  }
}
