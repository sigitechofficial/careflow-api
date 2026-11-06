import { SurveyTargetKind } from '@prisma/client';
import {
  callDue,
  checkContactPlan,
  dueReminderStep,
  reminderGapPassed,
  isQuietTime,
  MAX_SURVEY_REMINDERS,
  readContactPlan,
  suggestedContactPlan,
} from './survey-contact-plan.util';

const DAY = 86_400_000;
const staffNamed = { targetKind: SurveyTargetKind.EMPLOYEE, isAnonymous: false };
const suAnon = { targetKind: SurveyTargetKind.SERVICE_USER, isAnonymous: true };

describe('checkContactPlan', () => {
  it('accepts up to three increasing reminders and channels the survey can use', () => {
    const r = checkContactPlan({ reminders: [{ afterDays: 3 }, { afterDays: 7 }], channels: ['APP', 'EMAIL'] }, staffNamed);
    expect(r).toEqual({
      ok: true,
      plan: {
        reminders: [{ afterDays: 3 }, { afterDays: 7 }],
        channels: ['APP', 'EMAIL'],
        quietStart: '20:00',
        quietEnd: '09:00',
        weekdaysOnly: false,
        call: null,
      },
    });
  });

  it('refuses more than three reminders, reminders too close together, and channels that cannot reach the people', () => {
    const four = [1, 4, 7, 10].map((afterDays) => ({ afterDays }));
    expect(checkContactPlan({ reminders: four, channels: ['EMAIL'] }, staffNamed).ok).toBe(false);
    expect(checkContactPlan({ reminders: [{ afterDays: 3 }, { afterDays: 4 }], channels: ['EMAIL'] }, staffNamed).ok).toBe(false);
    expect(checkContactPlan({ reminders: [{ afterDays: 3 }], channels: ['PORTAL'] }, staffNamed).ok).toBe(false);
    expect(checkContactPlan({ reminders: [{ afterDays: 3 }], channels: [] }, staffNamed).ok).toBe(false);
  });

  it('never allows a call list on an anonymous survey (it would show who has answered)', () => {
    const r = checkContactPlan({ reminders: [{ afterDays: 3 }], channels: ['PORTAL'], call: { afterDays: 10 } }, suAnon);
    expect(r).toEqual({ ok: false, message: expect.stringContaining('Anonymous surveys have no call list') });
  });

  it('puts the call list after the last reminder and gives it a role', () => {
    const named = { ...suAnon, isAnonymous: false };
    expect(checkContactPlan({ reminders: [{ afterDays: 7 }], channels: ['PORTAL'], call: { afterDays: 7 } }, named).ok).toBe(false);
    const ok = checkContactPlan({ reminders: [{ afterDays: 7 }], channels: ['PORTAL'], call: { afterDays: 10 } }, named);
    expect(ok.ok && ok.plan.call).toEqual({ afterDays: 10, roleId: null, ownerKey: 'CARE_COORDINATOR', withinDays: 5 });
  });

  it('has nothing to remind on public surveys', () => {
    expect(checkContactPlan({ reminders: [] }, { targetKind: SurveyTargetKind.PUBLIC, isAnonymous: true }).ok).toBe(false);
  });
});

describe('readContactPlan', () => {
  it('reads tolerantly and never more than the maximum', () => {
    const p = readContactPlan({ reminders: [1, 2, 3, 4].map((d) => ({ afterDays: d * 3 })), channels: ['EMAIL', 'NOPE'] });
    expect(p?.reminders).toHaveLength(MAX_SURVEY_REMINDERS);
    expect(p?.channels).toEqual(['EMAIL']);
    expect(readContactPlan(null)).toBeNull();
  });
});

describe('dueReminderStep', () => {
  const plan = { reminders: [{ afterDays: 3 }, { afterDays: 7 }] };
  const sentAt = new Date('2026-11-01T10:00:00Z');
  it('is due once the days have passed, one step at a time', () => {
    expect(dueReminderStep({ sentAt, reminderCount: 0, remindedAt: null }, plan, new Date(sentAt.getTime() + 2 * DAY))).toBeNull();
    expect(dueReminderStep({ sentAt, reminderCount: 0, remindedAt: null }, plan, new Date(sentAt.getTime() + 3 * DAY))).toBe(1);
    expect(dueReminderStep({ sentAt, reminderCount: 1, remindedAt: new Date(sentAt.getTime() + 3 * DAY) }, plan, new Date(sentAt.getTime() + 7 * DAY))).toBe(2);
  });
  it('stops at the end of the plan', () => {
    expect(dueReminderStep({ sentAt, reminderCount: 2, remindedAt: null }, plan, new Date(sentAt.getTime() + 30 * DAY))).toBeNull();
  });
  it('waits two days after any reminder, including one sent by hand', () => {
    const remindedAt = new Date(sentAt.getTime() + 6 * DAY);
    expect(dueReminderStep({ sentAt, reminderCount: 1, remindedAt }, plan, new Date(sentAt.getTime() + 7 * DAY))).toBeNull();
    expect(dueReminderStep({ sentAt, reminderCount: 1, remindedAt }, plan, new Date(sentAt.getTime() + 8 * DAY))).toBe(2);
  });
  it('anonymous surveys (day-only reminder dates) count a whole extra day, so the gap is never shorter than two days', () => {
    // Stored as the start of the day; the reminder may have gone at 23:59 that day.
    const day = new Date('2026-11-10T00:00:00Z');
    expect(reminderGapPassed(day, new Date('2026-11-12T09:00:00Z'), true)).toBe(false);
    expect(reminderGapPassed(day, new Date('2026-11-13T09:00:00Z'), true)).toBe(true);
    expect(reminderGapPassed(day, new Date('2026-11-12T09:00:00Z'))).toBe(true);
  });
});

describe('isQuietTime', () => {
  const plan = { quietStart: '20:00', quietEnd: '09:00', weekdaysOnly: false };
  it('is quiet overnight in the organisation time zone (BST and GMT)', () => {
    expect(isQuietTime(new Date('2026-07-01T19:30:00Z'), plan, 'Europe/London')).toBe(true); // 20:30 BST
    expect(isQuietTime(new Date('2026-07-01T07:30:00Z'), plan, 'Europe/London')).toBe(true); // 08:30 BST
    expect(isQuietTime(new Date('2026-07-01T08:30:00Z'), plan, 'Europe/London')).toBe(false); // 09:30 BST
    expect(isQuietTime(new Date('2026-12-01T19:30:00Z'), plan, 'Europe/London')).toBe(false); // 19:30 GMT
  });
  it('is quiet all weekend when weekdays only', () => {
    expect(isQuietTime(new Date('2026-11-07T12:00:00Z'), { ...plan, weekdaysOnly: true }, 'Europe/London')).toBe(true); // Saturday
    expect(isQuietTime(new Date('2026-11-09T12:00:00Z'), { ...plan, weekdaysOnly: true }, 'Europe/London')).toBe(false);
  });
});

describe('callDue', () => {
  it('is due after the call step days', () => {
    const sentAt = new Date('2026-11-01T10:00:00Z');
    const plan = { call: { afterDays: 10, roleId: null, ownerKey: 'CARE_COORDINATOR', withinDays: 5 } };
    expect(callDue(sentAt, plan, new Date(sentAt.getTime() + 9 * DAY))).toBe(false);
    expect(callDue(sentAt, plan, new Date(sentAt.getTime() + 10 * DAY))).toBe(true);
    expect(callDue(sentAt, { call: null }, new Date(sentAt.getTime() + 99 * DAY))).toBe(false);
  });
});

describe('suggestedContactPlan', () => {
  it('uses the reminder the library guidance states', () => {
    const p = suggestedContactPlan({
      targetKind: SurveyTargetKind.EMPLOYEE,
      isAnonymous: true,
      libraryMeta: { channels: ['ONLINE', 'PAPER'], managerGuidance: { howToRun: ['Send one group reminder after 1 week.'] } },
    });
    expect(p?.reminders).toEqual([{ afterDays: 7 }]);
    expect(p?.call).toBeNull();
  });
  it('makes a call list for telephone surveys of people we support, never for anonymous ones', () => {
    const meta = { channels: ['TELEPHONE', 'IN_PERSON'] };
    expect(suggestedContactPlan({ targetKind: SurveyTargetKind.SERVICE_USER, isAnonymous: false, libraryMeta: meta })).toMatchObject({
      reminders: [],
      call: { afterDays: 0, ownerKey: 'CARE_COORDINATOR' },
    });
    expect(suggestedContactPlan({ targetKind: SurveyTargetKind.SERVICE_USER, isAnonymous: true, libraryMeta: meta })?.call).toBeNull();
  });
});
