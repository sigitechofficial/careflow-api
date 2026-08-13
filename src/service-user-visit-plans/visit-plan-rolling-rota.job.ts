import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { VisitPlanBulkScheduleService } from './visit-plan-bulk-schedule.service';
import {
  clampAutoExtendRotaRunHour,
  clampRotaHorizonDays,
  currentHourInTimeZone,
  operationalRotaTodayIsoDate,
  resolveRollingRotaDayToGenerate,
} from './visit-plan-rolling-rota.util';

@Injectable()
export class VisitPlanRollingRotaJob {
  private readonly logger = new Logger(VisitPlanRollingRotaJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bulkSchedule: VisitPlanBulkScheduleService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  /** Hourly UTC tick; runs bulk extend once per day at the configured org-timezone hour. */
  @Cron('0 * * * *')
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

    const timeZone = await this.orgSettings.getOperationalTimezone();
    const now = new Date();
    const runHour = clampAutoExtendRotaRunHour(settings.domAutoExtendRotaRunHour);
    const currentHour = currentHourInTimeZone(now, timeZone);
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

    const today = operationalRotaTodayIsoDate(now, timeZone);
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
        `Rolling rota extended ${dayToGenerate} (horizon ${horizonDays}d, tz ${timeZone}): ` +
          `${totals.visitsCreated} created, ${totals.visitsSkipped} skipped, ` +
          `${totals.succeeded} plans ok, ${totals.failed} failed, ${totals.skipped} skipped plans`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Rolling rota job failed for ${dayToGenerate}: ${message}`);
    }
  }
}
