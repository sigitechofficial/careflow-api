import { VisitPlanNightDuty, VisitPlanSlotKind } from '@prisma/client';
import {
  isNightTimeSlotCode,
  nightDutyAppLabel,
  nightDutyHomeTag,
  resolveStoredNightDuty,
  resolveVisitPlanNightDuty,
  slotAllowsNightDuty,
  slotTimesCrossMidnight,
} from './visit-plan-night-duty.util';

describe('visit-plan-night-duty.util', () => {
  it('treats end <= start as midnight crossing', () => {
    expect(slotTimesCrossMidnight('22:00', '07:00')).toBe(true);
    expect(slotTimesCrossMidnight('20:00', '23:59')).toBe(false);
    expect(slotTimesCrossMidnight('08:00', '09:00')).toBe(false);
  });

  it('allows night duty on OVERNIGHT or midnight-crossing times', () => {
    expect(slotAllowsNightDuty({ slotKind: VisitPlanSlotKind.OVERNIGHT, plannedStartTime: '20:00', plannedEndTime: '23:59' })).toBe(
      true,
    );
    expect(slotAllowsNightDuty({ slotKind: VisitPlanSlotKind.STANDARD, plannedStartTime: '22:00', plannedEndTime: '07:00' })).toBe(
      true,
    );
    expect(slotAllowsNightDuty({ slotKind: VisitPlanSlotKind.STANDARD, plannedStartTime: '08:00', plannedEndTime: '09:00' })).toBe(
      false,
    );
  });

  it('allows night duty for any visit in the Night time slot, even one that does not cross midnight', () => {
    expect(isNightTimeSlotCode('NIGHT')).toBe(true);
    expect(isNightTimeSlotCode('NIGHT__2')).toBe(true);
    expect(isNightTimeSlotCode('NIGHT__X')).toBe(true);
    expect(isNightTimeSlotCode('EVENING')).toBe(false);
    expect(
      resolveVisitPlanNightDuty({
        slotKind: VisitPlanSlotKind.STANDARD,
        plannedStartTime: '02:00',
        plannedEndTime: '03:00',
        slotCode: 'NIGHT__2',
        medicationRoundCode: 'NIGHT',
        nightDuty: VisitPlanNightDuty.WAKING_NIGHT,
      }),
    ).toBe(VisitPlanNightDuty.WAKING_NIGHT);
    expect(
      slotAllowsNightDuty({ plannedStartTime: '18:00', plannedEndTime: '19:00', slotCode: 'EVENING' }),
    ).toBe(false);
  });

  it('forces NONE when the slot is not an overnight window', () => {
    expect(
      resolveVisitPlanNightDuty({
        slotKind: VisitPlanSlotKind.STANDARD,
        plannedStartTime: '08:00',
        plannedEndTime: '09:00',
        nightDuty: VisitPlanNightDuty.SLEEPING_NIGHT,
      }),
    ).toBe(VisitPlanNightDuty.NONE);
  });

  it('keeps sleeping or waking when overnight is allowed', () => {
    expect(
      resolveVisitPlanNightDuty({
        slotKind: VisitPlanSlotKind.OVERNIGHT,
        plannedStartTime: '22:00',
        plannedEndTime: '07:00',
        nightDuty: VisitPlanNightDuty.WAKING_NIGHT,
      }),
    ).toBe(VisitPlanNightDuty.WAKING_NIGHT);
  });

  it('reads stored night duty from slot first, then job metadata', () => {
    expect(
      resolveStoredNightDuty({
        slotNightDuty: VisitPlanNightDuty.SLEEPING_NIGHT,
        jobMetadata: { nightDuty: VisitPlanNightDuty.WAKING_NIGHT },
      }),
    ).toBe(VisitPlanNightDuty.SLEEPING_NIGHT);
    expect(
      resolveStoredNightDuty({
        slotNightDuty: VisitPlanNightDuty.NONE,
        jobMetadata: { nightDuty: VisitPlanNightDuty.WAKING_NIGHT },
      }),
    ).toBe(VisitPlanNightDuty.WAKING_NIGHT);
    expect(resolveStoredNightDuty({})).toBe(VisitPlanNightDuty.NONE);
    expect(nightDutyAppLabel(VisitPlanNightDuty.SLEEPING_NIGHT)).toBe('Sleeping night');
    expect(nightDutyHomeTag(VisitPlanNightDuty.WAKING_NIGHT)).toEqual({
      id: 'waking_night',
      label: 'Waking night',
      tone: 'primary',
    });
    expect(nightDutyHomeTag(VisitPlanNightDuty.NONE)).toBeNull();
  });
});
