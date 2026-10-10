import { Prisma } from '@prisma/client';
import { payRulesSignature, pickPayCardVersionForDay } from './pay-card-version.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('pickPayCardVersionForDay', () => {
  const versions = [
    { version: 1, effectiveFrom: d('2026-01-01') },
    { version: 2, effectiveFrom: d('2027-01-01') },
  ];

  it('uses the old version for visits before the new rates start', () => {
    expect(pickPayCardVersionForDay(versions, '2026-12-31')).toBe(1);
  });

  it('uses the new version from its start date onwards', () => {
    expect(pickPayCardVersionForDay(versions, '2027-01-01')).toBe(2);
    expect(pickPayCardVersionForDay(versions, '2027-06-15')).toBe(2);
  });

  it('falls back to the earliest version for days before any version', () => {
    expect(pickPayCardVersionForDay(versions, '2025-06-01')).toBe(1);
  });

  it('prefers the higher version when two start on the same day', () => {
    expect(
      pickPayCardVersionForDay(
        [...versions, { version: 3, effectiveFrom: d('2027-01-01') }],
        '2027-01-01',
      ),
    ).toBe(3);
  });

  it('returns null when the card has no history', () => {
    expect(pickPayCardVersionForDay([], '2026-01-01')).toBeNull();
  });
});

describe('payRulesSignature', () => {
  const stored = {
    label: 'Weekday',
    dayType: 'WEEKDAY',
    startTime: '07:00',
    endTime: '22:00',
    rateType: 'HOURLY',
    amount: new Prisma.Decimal('12.5000'),
    priority: 0,
    sortOrder: 0,
    appliesToVisit: true,
    appliesToTravel: false,
    appliesToWaiting: false,
    appliesToTraining: false,
    multiplier: null,
  };

  it('treats stored Decimal rules and submitted numbers with the same values as unchanged', () => {
    const submitted = { ...stored, amount: 12.5, multiplier: undefined, serviceType: '' };
    expect(payRulesSignature([stored])).toBe(payRulesSignature([submitted]));
  });

  it('detects a changed rate', () => {
    expect(payRulesSignature([stored])).not.toBe(payRulesSignature([{ ...stored, amount: 13 }]));
  });

  it('detects an added rule', () => {
    expect(payRulesSignature([stored])).not.toBe(
      payRulesSignature([stored, { ...stored, label: 'Weekend', sortOrder: 1 }]),
    );
  });
});
