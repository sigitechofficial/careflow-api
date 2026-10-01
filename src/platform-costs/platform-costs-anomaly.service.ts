import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { PlatformCostsDataService } from './platform-costs-data.service';
import {
  addDays,
  isoDate,
  parseIsoDate,
} from './platform-costs-aggregation.util';
import {
  detectAnomalies,
  type DetectedAnomaly,
} from './platform-costs-anomaly.util';
import {
  PLATFORM_COSTS_MANAGE,
  PLATFORM_COSTS_READ,
} from './platform-costs.constants';
import { escapeHtml, formatMoney } from './platform-costs-format.util';

/** How many recent usage days are re-evaluated after each cost sync. */
export const ANOMALY_LOOKBACK_DAYS = 14;

@Injectable()
export class PlatformCostsAnomalyService {
  private readonly logger = new Logger(PlatformCostsAnomalyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly data: PlatformCostsDataService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  /** Active staff users holding platform_costs.read/manage, plus every Super Admin. */
  async resolveRecipients(): Promise<Array<{ id: string; email: string }>> {
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        userRoles: {
          some: {
            role: {
              deletedAt: null,
              isActive: true,
              OR: [
                { name: 'Super Admin' },
                {
                  rolePermissions: {
                    some: {
                      permission: {
                        key: {
                          in: [PLATFORM_COSTS_READ, PLATFORM_COSTS_MANAGE],
                        },
                        deletedAt: null,
                        isActive: true,
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
      select: { id: true, email: true },
    });
    return users;
  }

  /** Evaluate the last 14 days; create (once per date) and notify new anomalies. */
  async detectAndNotify(now = new Date()): Promise<DetectedAnomaly[]> {
    const settings = await this.data.getSettings();
    const through = (await this.data.dataThrough()) ?? isoDate(now);
    const from = addDays(through, -(ANOMALY_LOOKBACK_DAYS + 8));
    const rows = await this.data.loadRows(from, through);
    const dates: string[] = [];
    for (let i = 0; i < ANOMALY_LOOKBACK_DAYS; i++)
      dates.push(addDays(through, -i));
    const detected = detectAnomalies(rows, dates, {
      thresholdPercent: settings.anomalyThresholdPercent,
      minDailyIncrease: settings.anomalyMinDailyIncrease.toNumber(),
    });
    if (!detected.length) return [];

    const existing = await this.prisma.azureCostAnomaly.findMany({
      where: { date: { in: detected.map((d) => parseIsoDate(d.date)) } },
      select: { date: true },
    });
    const known = new Set(existing.map((e) => isoDate(e.date)));
    const created: DetectedAnomaly[] = [];
    for (const a of detected) {
      if (known.has(a.date)) continue;
      try {
        const row = await this.prisma.azureCostAnomaly.create({
          data: {
            date: parseIsoDate(a.date),
            cost: new Prisma.Decimal(a.cost.toFixed(6)),
            baseline: new Prisma.Decimal(a.baseline.toFixed(6)),
            increasePercent: new Prisma.Decimal(a.increasePercent.toFixed(2)),
            topDriver: a.topDriver,
          },
        });
        created.push(a);
        await this.notify(row.id, a);
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        )
          continue;
        throw err;
      }
    }
    return created;
  }

  private async notify(anomalyId: string, a: DetectedAnomaly): Promise<void> {
    const recipients = await this.resolveRecipients();
    if (!recipients.length) {
      this.logger.warn(
        `Azure cost anomaly ${a.date}: no recipients hold ${PLATFORM_COSTS_READ}`,
      );
      return;
    }
    const title = `Azure cost spike on ${a.date}`;
    const message =
      `Azure spend was ${formatMoney(a.cost)} on ${a.date}, ${a.increasePercent}% above the ` +
      `7-day average of ${formatMoney(a.baseline)}` +
      (a.topDriver ? ` (largest increase: ${a.topDriver}).` : '.');
    try {
      await this.notifications.notifyUsers({
        recipientUserIds: recipients.map((r) => r.id),
        type: NotificationType.SYSTEM_MESSAGE,
        module: NotificationModule.SYSTEM,
        severity: NotificationSeverity.WARNING,
        title,
        message,
        recordType: 'AzureCostAnomaly',
        recordId: anomalyId,
        metadata: {
          kind: 'azure_cost_anomaly',
          date: a.date,
          route: '/azure-pricing',
        },
      });
    } catch (err) {
      this.logger.warn(
        `Anomaly in-app notification skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      await this.mail.send({
        to: recipients.map((r) => r.email),
        subject: `[Careflow] ${title}`,
        text: `${message}\n\nOpen Azure Pricing in the Careflow admin to review and acknowledge it.`,
        html: `<p>${escapeHtml(message)}</p><p>Open <strong>Azure Pricing</strong> in the Careflow admin to review and acknowledge it.</p>`,
      });
    } catch (err) {
      this.logger.warn(
        `Anomaly e-mail failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await this.prisma.azureCostAnomaly.update({
      where: { id: anomalyId },
      data: { notifiedAt: new Date() },
    });
  }
}
