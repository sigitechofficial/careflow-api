import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  PolicyAcknowledgementStatus,
  Prisma,
} from '@prisma/client';
import { isoDateInTimeZone } from '../jobs/job-catalogue';
import { FcmPushService } from '../notifications/fcm-push.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { employeeInManagerScope } from './policy-acknowledgement-rules';
import {
  daysUntil,
  isoWeekKey,
  policyDueText,
  policyReminderDue,
  readReminderMetadata,
  reminderAlreadySent,
  withReminder,
  withoutReminder,
  type PolicyReminder,
} from './policy-acknowledgement-reminder.util';
import {
  PolicyAcknowledgementsService,
  type OutstandingAcknowledgement,
} from './policy-acknowledgements.service';
import { formatVersionLabel } from './policy-status';

export const POLICY_ACKNOWLEDGEMENT_PUSH_TYPE = 'POLICY_ACKNOWLEDGEMENT';
const MANAGE_PERMISSION = 'policies.acknowledgements.manage';
const SUPER_ADMIN_ROLE = 'Super Admin';
const DAY_MS = 86_400_000;

export type PolicyPublishNotificationSummary = {
  staff: number;
  rowsCreated: number;
  pushed: number;
  webNotified: number;
};

export type PolicyReminderRunSummary = {
  timeZone: string;
  today: string;
  outstanding: number;
  sent: number;
  alreadySent: number;
  noChannel: number;
  failed: number;
  managerSummary: { weekKey: string; notifications: number; alreadySent: number; overdue: number };
};

type DeliveryGroup = {
  version: OutstandingAcknowledgement['version'];
  reminder: PolicyReminder;
  dueAt: Date;
  claimed: Array<{ id: string; employeeId: string; linkedUserId: string | null; metadata: Prisma.JsonValue | null }>;
};

/**
 * Notifications for staff read-and-acknowledge, following the supervision reminders:
 * - on publish: PENDING rows + "New policy to read" push (Employee App) and in-app (web users);
 * - daily (job `policy-acknowledgement-reminders`): 3 days before, on the due date, 1 day overdue,
 *   then every 7 days while overdue — each claimed once in PolicyAcknowledgement.metadata;
 * - weekly: overdue counts per policy for users with policies.acknowledgements.manage, in branch scope.
 */
@Injectable()
export class PolicyAcknowledgementNotificationsService {
  private readonly logger = new Logger(PolicyAcknowledgementNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly acknowledgements: PolicyAcknowledgementsService,
    private readonly notifications: NotificationsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly users: UsersService,
    @Optional() private readonly push?: FcmPushService,
  ) {}

  private formatter(timeZone: string) {
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric' });
    return (d: Date) => fmt.format(d);
  }

  private async timeZone(): Promise<string> {
    try {
      return (await this.orgSettings.getOperationalTimezone()) || 'Europe/London';
    } catch {
      return 'Europe/London';
    }
  }

  // ---------------------------------------------------------------------------
  // On publish
  // ---------------------------------------------------------------------------

  /**
   * After a version requiring acknowledgement is published: create PENDING rows for everyone in
   * scope who still has to acknowledge it (an acknowledgement of an earlier minor of the same major
   * counts), then tell them. Delivery failures are logged, never thrown.
   */
  async onVersionPublished(documentId: string, versionId: string, now = new Date()): Promise<PolicyPublishNotificationSummary> {
    const outstanding = (await this.acknowledgements.collectOutstanding({ documentId, now })).filter(
      (o) => o.version.id === versionId,
    );
    const summary: PolicyPublishNotificationSummary = { staff: outstanding.length, rowsCreated: 0, pushed: 0, webNotified: 0 };
    if (!outstanding.length) return summary;

    const fresh = outstanding.filter((o) => !o.row);
    if (fresh.length) {
      const created = await this.prisma.policyAcknowledgement.createMany({
        data: fresh.map((o) => ({
          versionId,
          employeeId: o.subject.employeeId,
          status: PolicyAcknowledgementStatus.PENDING,
          metadata: {
            notifiedAt: now.toISOString(),
            dueAt: o.state.dueAt?.toISOString() ?? null,
            reminders: {},
          } as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
      summary.rowsCreated = created.count;
    }
    if (!fresh.length) return summary;

    const timeZone = await this.timeZone();
    const fmt = this.formatter(timeZone);
    const version = fresh[0]!.version;
    const { title, reference } = version.document;
    const label = formatVersionLabel(version.versionMajor, version.versionMinor);

    // Same text for everyone with the same due date (staff who started later have a later one).
    const byDue = new Map<string, OutstandingAcknowledgement[]>();
    for (const o of fresh) {
      const key = o.state.dueAt ? isoDateInTimeZone(o.state.dueAt, timeZone) : '';
      byDue.set(key, [...(byDue.get(key) ?? []), o]);
    }
    for (const group of byDue.values()) {
      const dueAt = group[0]!.state.dueAt;
      const by = dueAt ? ` by ${fmt(dueAt)}` : '';
      if (this.push) {
        try {
          const report = await this.push.sendToEmployees(
            group.map((o) => o.subject.employeeId),
            {
              title: `New policy to read: ${title}`,
              body: `Please read and acknowledge ${reference} (${label})${by}.`,
              data: { type: POLICY_ACKNOWLEDGEMENT_PUSH_TYPE, documentId },
            },
          );
          summary.pushed += report.sent;
        } catch (err) {
          this.logger.warn(`Policy ${reference} published: push failed: ${(err as Error).message}`);
        }
      }
      const userIds = [...new Set(group.map((o) => o.subject.linkedUserId).filter((id): id is string => !!id))];
      if (userIds.length) {
        try {
          await this.notifications.notifyUsers({
            recipientUserIds: userIds,
            type: NotificationType.POLICY_ACKNOWLEDGEMENT_DUE,
            title: `New policy to read: ${title}`,
            message: `Please read and acknowledge ${reference} ${title} (${label})${by}.`,
            module: NotificationModule.POLICY,
            severity: NotificationSeverity.INFO,
            recordType: 'PolicyDocument',
            recordId: documentId,
            metadata: { href: `/policies/${documentId}`, documentId, versionId, dueAt: dueAt?.toISOString() ?? null },
          });
          summary.webNotified += userIds.length;
        } catch (err) {
          this.logger.warn(`Policy ${reference} published: in-app notification failed: ${(err as Error).message}`);
        }
      }
    }
    this.logger.log(
      `Policy ${reference} ${label} published: staff=${summary.staff} rows=${summary.rowsCreated} ` +
        `pushed=${summary.pushed} web=${summary.webNotified}`,
    );
    return summary;
  }

  // ---------------------------------------------------------------------------
  // Daily reminders + weekly manager summary
  // ---------------------------------------------------------------------------

  async sendDueReminders(now = new Date()): Promise<PolicyReminderRunSummary> {
    const timeZone = await this.timeZone();
    const today = isoDateInTimeZone(now, timeZone);
    const outstanding = await this.acknowledgements.collectOutstanding({ now });
    const summary: PolicyReminderRunSummary = {
      timeZone,
      today,
      outstanding: outstanding.length,
      sent: 0,
      alreadySent: 0,
      noChannel: 0,
      failed: 0,
      managerSummary: { weekKey: isoWeekKey(today), notifications: 0, alreadySent: 0, overdue: 0 },
    };

    const groups = new Map<string, DeliveryGroup>();
    for (const o of outstanding) {
      if (!o.state.dueAt) continue;
      const reminder = policyReminderDue(daysUntil(isoDateInTimeZone(o.state.dueAt, timeZone), today));
      if (!reminder) continue;
      const claimed = await this.claim(o, reminder.kind, now);
      if (!claimed) {
        summary.alreadySent += 1;
        continue;
      }
      const key = `${o.version.id}|${reminder.kind}|${reminder.days}`;
      const group = groups.get(key) ?? { version: o.version, reminder, dueAt: o.state.dueAt, claimed: [] };
      group.claimed.push({
        id: claimed.id,
        employeeId: o.subject.employeeId,
        linkedUserId: o.subject.linkedUserId,
        metadata: claimed.metadata,
      });
      groups.set(key, group);
    }

    const fmt = this.formatter(timeZone);
    for (const group of groups.values()) {
      const outcome = await this.deliver(group, fmt, now);
      summary[outcome] += group.claimed.length;
    }

    summary.managerSummary = await this.sendWeeklyManagerSummary(outstanding, today);
    this.logger.log(
      `Policy acknowledgement reminders (${today} ${timeZone}): outstanding=${summary.outstanding} sent=${summary.sent} ` +
        `already=${summary.alreadySent} noChannel=${summary.noChannel} failed=${summary.failed} ` +
        `managerSummaries=${summary.managerSummary.notifications}`,
    );
    return summary;
  }

  /**
   * Claims the reminder in the row's metadata before sending (creating the row for staff who came
   * into scope after publication), so each kind is sent once. Optimistic: the update only applies
   * if the row has not changed since it was read and is still not acknowledged.
   */
  private async claim(
    o: OutstandingAcknowledgement,
    kind: string,
    now: Date,
  ): Promise<{ id: string; metadata: Prisma.JsonValue | null } | null> {
    const entry = { at: now.toISOString() };
    if (!o.row) {
      try {
        const metadata = {
          ...withReminder(null, kind, entry),
          dueAt: o.state.dueAt?.toISOString() ?? null,
        } as Prisma.InputJsonValue;
        const created = await this.prisma.policyAcknowledgement.create({
          data: {
            versionId: o.version.id,
            employeeId: o.subject.employeeId,
            status: PolicyAcknowledgementStatus.PENDING,
            metadata,
          },
          select: { id: true, metadata: true },
        });
        return created;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
        throw err;
      }
    }
    if (reminderAlreadySent(o.row.metadata, kind)) return null;
    const metadata = withReminder(o.row.metadata, kind, entry) as Prisma.InputJsonValue;
    const res = await this.prisma.policyAcknowledgement.updateMany({
      where: {
        id: o.row.id,
        updatedAt: o.row.updatedAt,
        status: { not: PolicyAcknowledgementStatus.ACKNOWLEDGED },
      },
      data: { metadata },
    });
    return res.count ? { id: o.row.id, metadata: metadata as Prisma.JsonValue } : null;
  }

  /** Sends one reminder to a group; releases the claims if every channel errored. */
  private async deliver(
    group: DeliveryGroup,
    fmt: (d: Date) => string,
    now: Date,
  ): Promise<'sent' | 'noChannel' | 'failed'> {
    const { version, reminder, dueAt } = group;
    const { title, reference } = version.document;
    const documentId = version.documentId;
    const when = policyDueText(reminder.days);
    const heading = reminder.overdue ? `Policy overdue: ${title}` : `Policy to read: ${title}`;
    const text = `Please read and acknowledge ${reference} ${title}. It is ${when} (due ${fmt(dueAt)}).`;

    let pushed = false;
    let pushErrored = false;
    if (this.push) {
      try {
        const report = await this.push.sendToEmployees(
          group.claimed.map((c) => c.employeeId),
          { title: heading, body: text, data: { type: POLICY_ACKNOWLEDGEMENT_PUSH_TYPE, documentId } },
        );
        pushed = report.sent > 0;
      } catch (err) {
        pushErrored = true;
        this.logger.warn(`Policy reminder ${reference} ${reminder.kind}: push failed: ${(err as Error).message}`);
      }
    }

    const userIds = [...new Set(group.claimed.map((c) => c.linkedUserId).filter((id): id is string => !!id))];
    let notified = false;
    let notifyErrored = false;
    if (userIds.length) {
      try {
        await this.notifications.notifyUsers({
          recipientUserIds: userIds,
          type: NotificationType.POLICY_ACKNOWLEDGEMENT_DUE,
          title: heading,
          message: text,
          module: NotificationModule.POLICY,
          severity: reminder.overdue ? NotificationSeverity.WARNING : NotificationSeverity.INFO,
          recordType: 'PolicyDocument',
          recordId: documentId,
          metadata: {
            href: `/policies/${documentId}`,
            documentId,
            versionId: version.id,
            reminderKind: reminder.kind,
            dueAt: dueAt.toISOString(),
          },
        });
        notified = true;
      } catch (err) {
        notifyErrored = true;
        this.logger.warn(`Policy reminder ${reference} ${reminder.kind}: in-app failed: ${(err as Error).message}`);
      }
    }

    const attempted = Boolean(this.push) || userIds.length > 0;
    const allErrored = attempted && (!this.push || pushErrored) && (!userIds.length || notifyErrored);
    if (allErrored) {
      // Nothing went out: release the claims so the next run tries again.
      for (const c of group.claimed) {
        await this.prisma.policyAcknowledgement
          .update({ where: { id: c.id }, data: { metadata: withoutReminder(c.metadata, reminder.kind) as Prisma.InputJsonValue } })
          .catch(() => undefined);
      }
      return 'failed';
    }
    for (const c of group.claimed) {
      const entry = { at: now.toISOString(), pushed, notified: notified && Boolean(c.linkedUserId) };
      await this.prisma.policyAcknowledgement
        .update({ where: { id: c.id }, data: { metadata: withReminder(c.metadata, reminder.kind, entry) as Prisma.InputJsonValue } })
        .catch(() => undefined);
    }
    return pushed || notified ? 'sent' : 'noChannel';
  }

  /** Users who manage acknowledgements, with their branch scope (null = all branches). */
  private async managers(): Promise<Array<{ userId: string; assignedLocationIds: string[] | null }>> {
    const candidates = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        userRoles: {
          some: {
            role: {
              deletedAt: null,
              OR: [
                { name: SUPER_ADMIN_ROLE },
                { rolePermissions: { some: { permission: { key: MANAGE_PERMISSION } } } },
              ],
            },
          },
        },
      },
      select: { id: true },
    });
    const out: Array<{ userId: string; assignedLocationIds: string[] | null }> = [];
    for (const candidate of candidates) {
      const ctx = await this.users.getAuthContext(candidate.id);
      if (!ctx) continue;
      if (!ctx.permissions.includes(MANAGE_PERMISSION) && !ctx.roles.includes(SUPER_ADMIN_ROLE)) continue;
      out.push({ userId: ctx.id, assignedLocationIds: ctx.assignedLocationIds ?? null });
    }
    return out;
  }

  /**
   * Once per ISO week (first run on or after Monday at the reminder time): per policy, the number of
   * overdue staff in each manager's branches, linking to the policy's Staff acknowledgements.
   * Managers with nothing overdue get nothing.
   */
  async sendWeeklyManagerSummary(outstanding: OutstandingAcknowledgement[], today: string) {
    const weekKey = isoWeekKey(today);
    const overdue = outstanding.filter((o) => o.state.overdue);
    const result = { weekKey, notifications: 0, alreadySent: 0, overdue: overdue.length };
    if (!overdue.length) return result;

    const managers = await this.managers();
    if (!managers.length) return result;

    const since = new Date(Date.parse(`${weekKey}T00:00:00Z`) - DAY_MS);
    const previous = await this.prisma.notification.findMany({
      where: {
        type: NotificationType.POLICY_ACKNOWLEDGEMENT_SUMMARY,
        createdAt: { gte: since },
        recipients: { some: { userId: { in: managers.map((m) => m.userId) } } },
      },
      select: { metadata: true, recipients: { select: { userId: true } } },
    });
    const sent = new Set<string>();
    for (const n of previous) {
      const meta = readReminderMetadata(n.metadata);
      if (meta.weekKey !== weekKey || typeof meta.documentId !== 'string') continue;
      for (const r of n.recipients) sent.add(`${r.userId}|${meta.documentId}`);
    }

    const byDocument = new Map<string, OutstandingAcknowledgement[]>();
    for (const o of overdue) byDocument.set(o.version.documentId, [...(byDocument.get(o.version.documentId) ?? []), o]);

    for (const [documentId, items] of byDocument) {
      const version = items[0]!.version;
      const byCount = new Map<number, string[]>();
      for (const manager of managers) {
        const count = items.filter((o) => employeeInManagerScope(manager.assignedLocationIds, o.subject.branchIds)).length;
        if (!count) continue;
        if (sent.has(`${manager.userId}|${documentId}`)) {
          result.alreadySent += 1;
          continue;
        }
        byCount.set(count, [...(byCount.get(count) ?? []), manager.userId]);
      }
      const { reference, title } = version.document;
      const label = formatVersionLabel(version.versionMajor, version.versionMinor);
      for (const [count, userIds] of byCount) {
        const staff = `${count} staff member${count === 1 ? '' : 's'}`;
        const verb = count === 1 ? 'has' : 'have';
        try {
          await this.notifications.notifyUsers({
            recipientUserIds: userIds,
            type: NotificationType.POLICY_ACKNOWLEDGEMENT_SUMMARY,
            title: `Overdue: ${staff} ${verb} not acknowledged ${reference}`,
            message: `${staff} in your branches ${verb} not read and acknowledged ${reference} ${title} (${label}) by the due date. Open Staff acknowledgements to see who.`,
            module: NotificationModule.POLICY,
            severity: NotificationSeverity.WARNING,
            recordType: 'PolicyDocument',
            recordId: documentId,
            metadata: {
              href: `/policies/${documentId}#staff-acknowledgements`,
              documentId,
              versionId: version.id,
              weekKey,
              overdue: count,
            },
          });
          result.notifications += 1;
        } catch (err) {
          this.logger.warn(`Policy weekly summary ${reference}: in-app failed: ${(err as Error).message}`);
        }
      }
    }
    return result;
  }
}
