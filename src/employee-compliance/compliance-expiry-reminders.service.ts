import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ComplianceReminderStatus,
  ComplianceReminderType,
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FcmPushService } from '../notifications/fcm-push.service';
import { resolveManagerUserIds } from '../notifications/resolve-manager-recipients';
import { MailService } from '../mail/mail.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import type { ReviewSettings } from '../organisation-general-settings/review-settings.util';
import { EmployeeComplianceService } from './employee-compliance.service';
import {
  complianceReminderHorizonDays,
  complianceReminderStage,
  daysToExpiry,
  expiryText,
} from './compliance-expiry-reminder.util';

export type ComplianceExpiryReminderSummary = {
  timeZone: string;
  statusesUpdated: number;
  recordsChecked: number;
  sent: number;
  alreadySent: number;
  noRecipients: number;
  failed: number;
};

const DAY_MS = 86_400_000;

const recordSelect = {
  id: true,
  employeeId: true,
  expiryDate: true,
  complianceType: { select: { name: true, code: true } },
  employee: {
    select: {
      personalDetail: { select: { firstName: true, lastName: true, username: true } },
      employment: {
        select: {
          employeeNumber: true,
          locationId: true,
          baseLocationId: true,
          supervisor: { select: { id: true, isActive: true, deletedAt: true } },
        },
      },
    },
  },
} satisfies Prisma.EmployeeComplianceSelect;

type ReminderRecord = Prisma.EmployeeComplianceGetPayload<{ select: typeof recordSelect }>;

/**
 * Compliance and DBS expiry reminders (job `compliance-expiry-reminders`, Settings → Reviews &
 * reminders). For every current employee's compliance record with an expiry date it sends the
 * latest enabled stage crossed (90 / 60 / 30 / 7 days before, expired) to the employee's named
 * supervisor and branch managers, and optionally pushes the employee. Each stage is claimed in
 * ComplianceReminder (unique per record, stage and expiry date) before sending, so it goes out once;
 * renewing the record with a new expiry date starts the stages again.
 */
@Injectable()
export class ComplianceExpiryRemindersService {
  private readonly logger = new Logger(ComplianceExpiryRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly compliance: EmployeeComplianceService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    @Optional() private readonly push?: FcmPushService,
    @Optional() private readonly mail?: MailService,
  ) {}

  async sendExpiryReminders(now = new Date()): Promise<ComplianceExpiryReminderSummary> {
    const [settings, timeZone] = await Promise.all([
      this.orgSettings.getReviewSettings(),
      this.orgSettings.getOperationalTimezone(),
    ]);
    // Keep the stored status (EXPIRING_SOON / EXPIRED) in step for reports that read it.
    const { updated } = await this.compliance.runDailyComplianceCheck();
    const summary: ComplianceExpiryReminderSummary = {
      timeZone,
      statusesUpdated: updated,
      recordsChecked: 0,
      sent: 0,
      alreadySent: 0,
      noRecipients: 0,
      failed: 0,
    };
    const stages = settings.complianceReminderStages;
    if (!stages.length) return summary;

    const horizon = new Date(now.getTime() + (complianceReminderHorizonDays(stages) + 1) * DAY_MS);
    const records = await this.prisma.employeeCompliance.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        isNoLongerRequired: false,
        expiryDate: { not: null, lte: horizon },
        complianceType: { is: { deletedAt: null, isActive: true, hasExpiry: true } },
        employee: {
          deletedAt: null,
          isActive: true,
          OR: [{ employment: { is: null } }, { employment: { is: { OR: [{ endDate: null }, { endDate: { gt: now } }] } } }],
        },
      },
      select: recordSelect,
    });
    summary.recordsChecked = records.length;

    const managersByLocation = new Map<string, string[]>();
    const managersFor = async (locationId: string | null) => {
      const key = locationId ?? '';
      if (!managersByLocation.has(key)) {
        managersByLocation.set(key, await resolveManagerUserIds(this.prisma, { locationId }));
      }
      return managersByLocation.get(key)!;
    };

    for (const record of records) {
      if (!record.expiryDate) continue;
      const daysLeft = daysToExpiry(record.expiryDate, now);
      const stage = complianceReminderStage(daysLeft, stages);
      if (!stage) continue;
      const employment = record.employee.employment;
      const supervisor = employment?.supervisor;
      const staff = new Set<string>();
      if (supervisor && supervisor.isActive && !supervisor.deletedAt) staff.add(supervisor.id);
      for (const id of await managersFor(employment?.locationId ?? employment?.baseLocationId ?? null)) staff.add(id);
      if (!staff.size && !settings.complianceNotifyEmployee) {
        summary.noRecipients += 1;
        continue;
      }
      const outcome = await this.deliver(record, stage as ComplianceReminderType, daysLeft, [...staff], settings, timeZone);
      summary[outcome] += 1;
    }

    this.logger.log(
      `Compliance expiry reminders: checked=${summary.recordsChecked} sent=${summary.sent} already=${summary.alreadySent} ` +
        `none=${summary.noRecipients} failed=${summary.failed} statuses=${summary.statusesUpdated}`,
    );
    return summary;
  }

  private async deliver(
    record: ReminderRecord,
    stage: ComplianceReminderType,
    daysLeft: number,
    staffUserIds: string[],
    settings: ReviewSettings,
    timeZone: string,
  ): Promise<'sent' | 'alreadySent' | 'failed'> {
    const expiry = record.expiryDate!;
    let reminderId: string;
    try {
      const row = await this.prisma.complianceReminder.create({
        data: { employeeComplianceId: record.id, reminderType: stage, dueDate: expiry },
        select: { id: true },
      });
      reminderId = row.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'alreadySent';
      throw err;
    }

    const person = this.employeeLabel(record);
    const typeName = record.complianceType?.name ?? 'Compliance check';
    const expiryLabel = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(expiry);
    const when = expiryText(daysLeft, expiryLabel);
    const expired = stage === ComplianceReminderType.EXPIRED;
    const title = `${typeName} ${expired ? 'expired' : 'expiring'} — ${person}`;
    const message = `${typeName} for ${person} ${when}. Upload the renewed document and update the expiry date on the staff record.`;
    const href = `/employee/${record.employeeId}/edit?tab=compliance`;
    const type = expired ? NotificationType.COMPLIANCE_EXPIRED : NotificationType.COMPLIANCE_EXPIRING;

    let notified: string[] = [];
    if (staffUserIds.length) {
      try {
        await this.notifications.notifyUsers({
          recipientUserIds: staffUserIds,
          type,
          title,
          message,
          module: NotificationModule.EMPLOYEE,
          severity: expired || daysLeft <= 7 ? NotificationSeverity.WARNING : NotificationSeverity.INFO,
          recordType: 'EmployeeCompliance',
          recordId: record.id,
          metadata: { href, employeeId: record.employeeId, reminderType: stage, expiryDate: expiry },
        });
        notified = staffUserIds;
      } catch (err) {
        this.logger.warn(`Compliance reminder ${record.id} ${stage}: in-app failed: ${(err as Error).message}`);
      }
    }

    let employeePushed = false;
    if (settings.complianceNotifyEmployee && this.push) {
      try {
        const report = await this.push.sendToEmployees([record.employeeId], {
          title: `${typeName} ${expired ? 'has expired' : 'is expiring'}`,
          body: `Your ${typeName} ${when}. Please send the office your renewed document.`,
          data: { type, employeeComplianceId: record.id },
        }, 'compliance-reminders');
        employeePushed = report.sent > 0;
      } catch (err) {
        this.logger.warn(`Compliance reminder ${record.id}: push failed: ${(err as Error).message}`);
      }
    }

    const emailed =
      settings.complianceEmailReminders && notified.length ? await this.email(notified, type, title, message, href) : false;

    if (!notified.length && !employeePushed && !emailed) {
      await this.prisma.complianceReminder.delete({ where: { id: reminderId } }).catch(() => undefined);
      return 'failed';
    }
    await this.prisma.complianceReminder.update({
      where: { id: reminderId },
      data: {
        status: ComplianceReminderStatus.SENT,
        sentAt: new Date(),
        metadata: { recipientUserIds: notified, employeePushed, emailed, daysLeft },
      },
    });
    return 'sent';
  }

  private employeeLabel(record: ReminderRecord): string {
    const pd = record.employee.personalDetail;
    const name = [pd?.firstName, pd?.lastName].filter(Boolean).join(' ') || 'Employee';
    const number = record.employee.employment?.employeeNumber?.trim();
    const username = pd?.username?.trim();
    const ref = number ? `#${number}` : username ? `@${username}` : `ID ${record.employeeId.slice(0, 8)}`;
    return `${name} (${ref})`;
  }

  /** Emails staff who have not turned this notification type off. */
  private async email(userIds: string[], type: NotificationType, subject: string, text: string, href: string) {
    if (!this.mail) return false;
    const optedOut = new Set(
      (
        await this.prisma.notificationPreference.findMany({
          where: { userId: { in: userIds }, type, inAppEnabled: false },
          select: { userId: true },
        })
      ).map((r) => r.userId),
    );
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds.filter((id) => !optedOut.has(id)) }, deletedAt: null, isActive: true },
      select: { email: true },
    });
    const to = users.map((u) => u.email).filter(Boolean);
    if (!to.length) return false;
    const base = this.config.get<string>('app.adminAppUrl', '');
    const body = base ? `${text}\n\nOpen the staff record: ${base}${href}` : text;
    try {
      // One message per person so staff never see each other's addresses.
      for (const address of to) await this.mail.send({ kind: 'compliance-reminders', to: address, subject, text: body });
      return true;
    } catch (err) {
      this.logger.warn(`Compliance reminder email failed: ${(err as Error).message}`);
      return false;
    }
  }
}
