import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import {
  EcmExceptionKind,
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  ScheduledJobStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EcmAlertService } from './ecm-alert.service';
import { ecmExceptionQueueHref } from './ecm-urgent-alert.util';

type VisitAlert = {
  key: string;
  group: 'Urgent' | 'Visits' | 'Medication';
  label: string;
  description: string;
  /** Raised as a visit exception (shows in Live visits › Exceptions, pops up when urgent), like the real one. */
  ecm?: { kind: EcmExceptionKind; title: string; criticality: string; needsCarer?: boolean; context?: Record<string, unknown> };
  /** Or sent as the same office notification the real alert sends. */
  notification?: 'LATE_START' | 'MED_MISSED' | 'MED_REFUSED' | 'MED_PRN_OVER_LIMIT' | 'MED_CONTROLLED';
};

/** Every office alert that can be tried. Labels say what the office sees; each mirrors the real alert. */
export const OFFICE_TEST_ALERTS: VisitAlert[] = [
  { key: 'CARER_SOS', group: 'Urgent', label: 'Carer SOS', description: 'A carer pressed SOS in the app (pops up for the office).', ecm: { kind: 'CARER_SOS', title: 'Carer SOS', criticality: 'TIME_CRITICAL', needsCarer: true, context: { message: 'Test SOS: please call me back.' } } },
  { key: 'LEFT_VISIT_AREA', group: 'Urgent', label: 'Carer left the visit area', description: 'The carer moved away from the client’s home during a visit (pops up).', ecm: { kind: 'LEFT_VISIT_AREA', title: 'Carer left visit area', criticality: 'TIME_CRITICAL', needsCarer: true } },
  { key: 'UNABLE_TO_START', group: 'Urgent', label: 'Unable to start visit', description: 'The carer can’t start the visit (no answer at the door, keys, etc.).', ecm: { kind: 'UNABLE_TO_START', title: 'Unable to start visit', criticality: 'PRIORITY', needsCarer: true, context: { reasonLabel: 'No answer at the door' } } },
  { key: 'OUTSIDE_AREA_CHECK_IN_REQUEST', group: 'Urgent', label: 'Manual check-in needs approval', description: 'The carer asks to clock in from outside the visit area (pops up).', ecm: { kind: 'OUTSIDE_AREA_CHECK_IN_REQUEST', title: 'Manual check-in request', criticality: 'PRIORITY', needsCarer: true } },
  { key: 'NFC_TAG_MISMATCH', group: 'Urgent', label: 'Wrong NFC tag scanned', description: 'The carer scanned a tag that isn’t this client’s.', ecm: { kind: 'NFC_TAG_MISMATCH', title: 'Wrong NFC tag scanned', criticality: 'PRIORITY', needsCarer: true } },
  { key: 'LATE_START', group: 'Visits', label: 'Late visit not started', description: 'A visit past its start time with nobody clocked in.', notification: 'LATE_START' },
  { key: 'LATE_ARRIVAL', group: 'Visits', label: 'Late arrival', description: 'The carer arrived after the planned start.', ecm: { kind: 'LATE_ARRIVAL', title: 'Late arrival', criticality: 'STANDARD' } },
  { key: 'VERY_LATE_ARRIVAL', group: 'Visits', label: 'Very late arrival', description: 'The carer arrived well after the planned start.', ecm: { kind: 'VERY_LATE_ARRIVAL', title: 'Very late arrival', criticality: 'PRIORITY' } },
  { key: 'POTENTIAL_MISSED', group: 'Visits', label: 'Possible missed visit', description: 'Nobody has clocked in and the visit window is closing.', ecm: { kind: 'POTENTIAL_MISSED', title: 'Possible missed visit', criticality: 'PRIORITY' } },
  { key: 'CONFIRMED_MISSED', group: 'Visits', label: 'Missed visit', description: 'The visit didn’t happen.', ecm: { kind: 'CONFIRMED_MISSED', title: 'Missed visit', criticality: 'TIME_CRITICAL' } },
  { key: 'MISSING_CHECKOUT', group: 'Visits', label: 'No clock-out', description: 'The carer clocked in but never clocked out.', ecm: { kind: 'MISSING_CHECKOUT', title: 'Missing clock-out', criticality: 'STANDARD' } },
  { key: 'SHORT_VISIT', group: 'Visits', label: 'Short visit', description: 'The visit was much shorter than planned.', ecm: { kind: 'SHORT_VISIT', title: 'Short visit', criticality: 'STANDARD' } },
  { key: 'MED_MISSED', group: 'Medication', label: 'Medication missed', description: 'A dose was recorded as missed on the MAR.', notification: 'MED_MISSED' },
  { key: 'MED_REFUSED', group: 'Medication', label: 'Medication refused', description: 'The client refused a dose.', notification: 'MED_REFUSED' },
  { key: 'MED_PRN_OVER_LIMIT', group: 'Medication', label: 'PRN given over its limit', description: 'An as-needed dose given too soon or over the daily maximum.', notification: 'MED_PRN_OVER_LIMIT' },
  { key: 'MED_CONTROLLED', group: 'Medication', label: 'Controlled medication given', description: 'A controlled drug was administered.', notification: 'MED_CONTROLLED' },
];

const CLOSED_JOB: ScheduledJobStatus[] = [ScheduledJobStatus.CANCELLED, ScheduledJobStatus.CALLED_OFF, ScheduledJobStatus.DRAFT];

/**
 * Test office alerts (Administration › Test office alerts, Super Admin): raises the chosen alerts on a recent real
 * visit, exactly as the real ones are raised, but only for the person who asked. Each is marked [TEST] and can be
 * removed with `clear`. Nothing goes out by email, text or push.
 */
@Injectable()
export class OfficeTestAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: EcmAlertService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** The alerts, where a click on each one opens, the visit they would go on, and how many test alerts are live. */
  async catalogue() {
    const [visit, openExceptions] = await Promise.all([
      this.pickVisit().catch(() => null),
      this.prisma.ecmException.count({ where: { context: { path: ['test'], equals: true } } }),
    ]);
    return {
      data: {
        alerts: OFFICE_TEST_ALERTS.map(({ key, group, label, description, ecm, notification }) => ({
          key,
          group,
          label,
          description,
          popsUp: Boolean(ecm && ['CARER_SOS', 'LEFT_VISIT_AREA', 'OUTSIDE_AREA_CHECK_IN_REQUEST'].includes(ecm.kind)),
          opens: notification?.startsWith('MED_') ? 'Medication › Missed & refused doses' : 'Live visits › Exceptions, on the visit',
        })),
        visit: visit
          ? {
              id: visit.id,
              name: visit.jobName,
              serviceUser: [visit.serviceUser.firstName, visit.serviceUser.lastName].filter(Boolean).join(' '),
              start: visit.scheduledStartDateTime,
              inProgress: visit.allocations.some((a) => a.actualStartDateTime && !a.actualEndDateTime),
            }
          : null,
        openTestExceptions: openExceptions,
      },
    };
  }

  /** A visit to hang the alerts on: one in progress, else the latest that has started, else the next one coming up. */
  private async pickVisit(scheduledJobId?: string) {
    const select = {
      id: true,
      jobName: true,
      serviceUserId: true,
      scheduledStartDateTime: true,
      serviceUser: { select: { firstName: true, lastName: true, preferredName: true } },
      allocations: {
        where: { deletedAt: null, isActive: true },
        select: { employeeId: true, actualStartDateTime: true, actualEndDateTime: true, isLeadCarer: true },
      },
    } as const;
    if (scheduledJobId) {
      const job = await this.prisma.scheduledJob.findFirst({ where: { id: scheduledJobId, deletedAt: null }, select });
      if (!job) throw new BadRequestException('That visit was not found.');
      return job;
    }
    const now = new Date();
    const recent = { deletedAt: null, isActive: true, status: { notIn: CLOSED_JOB }, scheduledStartDateTime: { gte: new Date(now.getTime() - 3 * 86_400_000), lte: now } };
    return (
      (await this.prisma.scheduledJob.findFirst({
        where: { ...recent, allocations: { some: { deletedAt: null, isActive: true, actualStartDateTime: { not: null }, actualEndDateTime: null } } },
        orderBy: { scheduledStartDateTime: 'desc' },
        select,
      })) ??
      (await this.prisma.scheduledJob.findFirst({ where: { ...recent, allocations: { some: { deletedAt: null, isActive: true } } }, orderBy: { scheduledStartDateTime: 'desc' }, select })) ??
      (await this.prisma.scheduledJob.findFirst({ where: { deletedAt: null, status: { notIn: CLOSED_JOB }, scheduledStartDateTime: { lte: now } }, orderBy: { scheduledStartDateTime: 'desc' }, select })) ??
      // A new system whose rota only runs ahead: the next visit coming up.
      (await this.prisma.scheduledJob.findFirst({ where: { deletedAt: null, status: { notIn: CLOSED_JOB }, scheduledStartDateTime: { gt: now } }, orderBy: { scheduledStartDateTime: 'asc' }, select }))
    );
  }

  async trigger(userId: string, keys: string[], scheduledJobId?: string) {
    const chosen = OFFICE_TEST_ALERTS.filter((a) => keys.includes(a.key));
    if (!chosen.length) throw new BadRequestException('Choose at least one alert.');
    const job = await this.pickVisit(scheduledJobId);
    if (!job) throw new BadRequestException('There is no visit to raise test alerts on yet. Add a visit to the rota first.');
    const su = job.serviceUser;
    const fullName = [su.firstName, su.lastName].filter(Boolean).join(' ').trim() || su.preferredName?.trim() || 'Service user';
    const suName = su.preferredName?.trim() || fullName;
    const carer = job.allocations.find((a) => a.isLeadCarer) ?? job.allocations[0];

    const raised: string[] = [];
    for (const a of chosen) {
      if (a.ecm) {
        const exception = await this.prisma.ecmException.create({
          data: {
            scheduledJobId: job.id,
            kind: a.ecm.kind,
            title: `[TEST] ${a.ecm.title}`,
            detail: 'Test alert raised from Administration › Test office alerts. Close it or remove all test alerts when done.',
            context: { test: true, ...(a.ecm.needsCarer && carer ? { employeeId: carer.employeeId } : {}), ...(a.ecm.context ?? {}) },
          },
        });
        await this.alerts.applySlaAndAlert({ exceptionId: exception.id, criticality: a.ecm.criticality, recipientUserIds: [userId] });
        raised.push(a.label);
        continue;
      }
      if (!this.notifications) continue;
      if (a.notification === 'LATE_START') {
        await this.notifications.notifyUsers({
          recipientUserIds: [userId],
          type: NotificationType.SCHEDULE_UNALLOCATED_VISIT,
          title: `[TEST] Late visit not started — ${suName}`,
          message: `${job.jobName} (${fullName}) has not started. This is a test alert.`,
          module: NotificationModule.SCHEDULING,
          severity: NotificationSeverity.WARNING,
          recordType: 'ScheduledJob',
          recordId: job.id,
          metadata: { kind: 'LATE_START', test: true, scheduledJobId: job.id, href: ecmExceptionQueueHref(job.id) },
        });
      } else {
        const med = {
          MED_MISSED: { title: 'Medication missed', status: 'MISSED', text: 'was missed' },
          MED_REFUSED: { title: 'Medication refused', status: 'REFUSED', text: 'was refused' },
          MED_PRN_OVER_LIMIT: { title: 'PRN given over limit', status: 'GIVEN', text: 'was given within its minimum gap' },
          MED_CONTROLLED: { title: 'Controlled medication given', status: 'GIVEN', text: 'was given' },
        }[a.notification!];
        await this.notifications.notifyUsers({
          recipientUserIds: [userId],
          type: NotificationType.MEDICATION_ALERT,
          title: `[TEST] ${med.title} — ${suName}`,
          message: `Paracetamol 500mg${a.notification === 'MED_CONTROLLED' ? ' (controlled)' : ''} ${med.text} — ${fullName}. This is a test alert.`,
          module: NotificationModule.SERVICE_CARE,
          severity: NotificationSeverity.WARNING,
          recordType: 'MedicationAdministrationEvent',
          recordId: randomUUID(),
          metadata: { serviceUserId: job.serviceUserId, status: med.status, test: true, href: '/medication/exceptions' },
        });
      }
      raised.push(a.label);
    }
    return {
      data: {
        visit: { id: job.id, name: job.jobName, serviceUser: fullName, start: job.scheduledStartDateTime },
        raised,
        message: `${raised.length} test alert${raised.length === 1 ? '' : 's'} sent to you, on ${job.jobName}.`,
      },
    };
  }

  /** Removes every test alert: the [TEST] visit exceptions (everyone's) and this person's test notifications. */
  async clear(userId: string) {
    const exceptions = await this.prisma.ecmException.deleteMany({ where: { context: { path: ['test'], equals: true } } });
    const notes = await this.prisma.notification.deleteMany({
      where: { metadata: { path: ['test'], equals: true }, recipients: { some: { userId } } },
    });
    return { data: { removedExceptions: exceptions.count, removedNotifications: notes.count, message: `Removed ${exceptions.count} test exception(s) and ${notes.count} test notification(s).` } };
  }
}
