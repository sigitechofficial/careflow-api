import { CqcNotificationStatus, CqcNotificationType } from '@prisma/client';
import {
  CQC_NOTIFICATION_TYPES,
  awarenessProblem,
  cleanDetails,
  dueAtFrom,
  formatCqcNotificationReference,
  isOverdue,
  readinessProblems,
  submittedLate,
} from './cqc-notification-types.util';

describe('awarenessProblem', () => {
  const now = new Date('2026-11-27T12:00:00Z');
  const reported = new Date('2026-11-20T09:00:00Z');

  it('accepts a time up to when the linked record was reported', () => {
    expect(awarenessProblem(reported, reported, now)).toBeNull();
    expect(awarenessProblem(new Date('2026-11-19T09:00:00Z'), reported, now)).toBeNull();
    // Whole-minute forms: under a minute later is the same time.
    expect(awarenessProblem(new Date('2026-11-20T09:00:30Z'), reported, now)).toBeNull();
  });

  it('rejects moving it after the linked record was reported (it would reset the deadline)', () => {
    expect(awarenessProblem(new Date('2026-11-25T09:00:00Z'), reported, now)).toMatch(
      /cannot be later/,
    );
  });

  it('rejects a time in the future, with or without a link', () => {
    expect(awarenessProblem(new Date('2026-11-28T09:00:00Z'), null, now)).toMatch(/future/);
    expect(awarenessProblem(new Date('2026-11-26T09:00:00Z'), null, now)).toBeNull();
  });
});

describe('cqc-notification-types.util', () => {
  it('has a spec for every notification type', () => {
    expect(CQC_NOTIFICATION_TYPES.map((t) => t.type).sort()).toEqual(
      Object.values(CqcNotificationType).sort(),
    );
  });

  describe('cleanDetails', () => {
    it('keeps known answers and trims text', () => {
      const r = cleanDetails(CqcNotificationType.DEATH, {
        placeOfDeath: 'HOME',
        causeIfKnown: '  Pneumonia ',
        coronerInvolved: false,
      });
      expect(r).toEqual({
        ok: true,
        details: {
          placeOfDeath: 'HOME',
          causeIfKnown: 'Pneumonia',
          coronerInvolved: false,
        },
      });
    });

    it('turns empty values into null', () => {
      const r = cleanDetails(CqcNotificationType.DEATH, { causeIfKnown: '' });
      expect(r).toEqual({ ok: true, details: { causeIfKnown: null } });
    });

    it('rejects unknown keys, bad options and wrong kinds', () => {
      expect(cleanDetails(CqcNotificationType.DEATH, { foo: 'x' }).ok).toBe(
        false,
      );
      expect(
        cleanDetails(CqcNotificationType.DEATH, { placeOfDeath: 'MOON' }).ok,
      ).toBe(false);
      expect(
        cleanDetails(CqcNotificationType.DEATH, { coronerInvolved: 'yes' }).ok,
      ).toBe(false);
      expect(
        cleanDetails(CqcNotificationType.SERVICE_DISRUPTION, {
          endedAt: 'not a date',
        }).ok,
      ).toBe(false);
      expect(cleanDetails(CqcNotificationType.DEATH, ['x']).ok).toBe(false);
    });
  });

  describe('readinessProblems', () => {
    const base = {
      type: CqcNotificationType.POLICE_INCIDENT,
      eventOccurredAt: new Date('2026-11-18T10:00:00Z'),
      summary: 'Money missing from purse',
      actionsTaken: 'Carer removed from visits',
      details: { policeForce: 'Met Police', reasonForPolice: 'Reported theft' },
    };

    it('is empty when everything required is filled in', () => {
      expect(readinessProblems(base)).toEqual([]);
    });

    it('lists missing common and type-specific answers', () => {
      expect(
        readinessProblems({
          ...base,
          eventOccurredAt: null,
          summary: ' ',
          details: { policeForce: 'Met Police' },
        }),
      ).toEqual([
        'When it happened',
        'What happened',
        'Why the police are involved',
      ]);
    });
  });

  it('sets the internal target 24 hours after awareness', () => {
    expect(dueAtFrom(new Date('2026-11-18T10:00:00Z')).toISOString()).toBe(
      '2026-11-19T10:00:00.000Z',
    );
  });

  it('formats references', () => {
    expect(formatCqcNotificationReference(2026, 42)).toBe('CQCN-2026-000042');
  });

  it('is overdue only while still being prepared', () => {
    const now = new Date('2026-11-19T12:00:00Z');
    const dueAt = new Date('2026-11-19T10:00:00Z');
    expect(isOverdue({ status: CqcNotificationStatus.DRAFT, dueAt }, now)).toBe(
      true,
    );
    expect(isOverdue({ status: CqcNotificationStatus.READY, dueAt }, now)).toBe(
      true,
    );
    expect(
      isOverdue({ status: CqcNotificationStatus.SUBMITTED, dueAt }, now),
    ).toBe(false);
    expect(
      isOverdue(
        {
          status: CqcNotificationStatus.DRAFT,
          dueAt: new Date('2026-11-20T00:00:00Z'),
        },
        now,
      ),
    ).toBe(false);
  });

  it('flags late submissions', () => {
    const dueAt = new Date('2026-11-19T10:00:00Z');
    expect(
      submittedLate({ submittedAt: new Date('2026-11-19T11:00:00Z'), dueAt }),
    ).toBe(true);
    expect(
      submittedLate({ submittedAt: new Date('2026-11-19T09:00:00Z'), dueAt }),
    ).toBe(false);
    expect(submittedLate({ submittedAt: null, dueAt })).toBe(false);
  });
});
