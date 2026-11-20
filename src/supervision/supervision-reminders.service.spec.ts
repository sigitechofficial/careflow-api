import { SupervisionRemindersService } from './supervision-reminders.service';
import * as reviewDues from '../employee-reviews/review-dues';
import * as managers from '../notifications/resolve-manager-recipients';

const SETTINGS = {
  remindersEnabled: true,
  reminderHour: 9,
  dueSoonDays: 14,
  reminderDaysBefore: [14, 7, 0],
  reminderDaysAfter: [1, 7, 14],
  escalateAfterDays: 0,
  notifySupervisor: true,
  notifyCarer: true,
  managersOnAllReminders: false,
  emailReminders: false,
} as never;

const NOW = new Date('2026-11-18T10:00:00Z');

function setup(opts: { nextDue: string; addedAt: string; pushSent: number; managers?: string[] }) {
  jest.spyOn(reviewDues, 'collectReviewDues').mockResolvedValue({
    dues: [{ employeeId: 'e1', reviewTypeId: 'r1', typeName: 'Supervision', typeCode: null, trackerId: null, lastDone: null, nextDue: new Date(opts.nextDue) }],
  } as never);
  jest.spyOn(managers, 'resolveManagerUserIds').mockResolvedValue(opts.managers ?? []);
  const logs: Array<{ id: string }> = [];
  const prisma = {
    employee: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'e1', createdAt: new Date(opts.addedAt), personalDetail: { firstName: 'Shah', lastName: 'Nawaz', username: null }, employment: { employeeNumber: null, locationId: 'l1', baseLocationId: null, supervisor: null } },
      ]),
    },
    supervisionSession: { findMany: jest.fn().mockResolvedValue([]) },
    supervisionSessionAttendee: { findMany: jest.fn().mockResolvedValue([]) },
    supervisionReminderLog: {
      create: jest.fn().mockImplementation(() => { const l = { id: `log${logs.length}` }; logs.push(l); return l; }),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    userNotificationPreference: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const orgSettings = { getSupervisionSettings: jest.fn().mockResolvedValue(SETTINGS), getOperationalTimezone: jest.fn().mockResolvedValue('Europe/London') };
  const notifications = { notifyUsers: jest.fn().mockResolvedValue(undefined) };
  const push = { sendToEmployees: jest.fn().mockResolvedValue({ sent: opts.pushSent }) };
  const svc = new SupervisionRemindersService(prisma as never, orgSettings as never, notifications as never, { get: () => undefined } as never, push as never);
  return { svc, prisma, push };
}

describe('SupervisionRemindersService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not chase reviews that fell due before the person was added to CareFlow (older start date)', async () => {
    const { svc, push, prisma } = setup({ nextDue: '2022-02-01T00:00:00Z', addedAt: '2026-11-17T12:00:00Z', pushSent: 1 });
    const summary = await svc.sendDueReminders(NOW).catch((e) => { throw e; });
    expect(summary.beforeAdded).toBe(1);
    expect(push.sendToEmployees).not.toHaveBeenCalled();
    expect(prisma.supervisionReminderLog.create).not.toHaveBeenCalled();
  });

  it('a reminder nobody can receive (no phone signed in) is kept as handled, so it is not repeated every hour', async () => {
    const { svc, prisma } = setup({ nextDue: '2026-11-18T00:00:00Z', addedAt: '2026-01-01T00:00:00Z', pushSent: 0 });
    const summary = await svc.sendDueReminders(NOW);
    expect(summary.noRecipients).toBe(1);
    expect(summary.failed).toBe(0);
    expect(prisma.supervisionReminderLog.delete).not.toHaveBeenCalled();
  });
});
