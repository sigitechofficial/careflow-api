import { MedicationKind, MedicationSchedulePattern } from '@prisma/client';

import {

  MEDICATION_DOW,

  scheduleAppliesOnDay,

} from '../medications/medication-schedule-applies.util';



export { MEDICATION_DOW };



export type PreviewScheduleInput = {

  dueTime: string;

  dueVisitName?: string | null;

  roundId?: string | null;

  roundName?: string | null;

  daysOfWeek?: string[];

};



export type SchedulePreviewInput = {

  startDate: string;

  endDate: string;

  medicationKind: MedicationKind;

  schedulePattern?: MedicationSchedulePattern | null;

  frequencyIntervalDays?: number;

  monthlyDayOfMonth?: number | null;

  monthlyAnchorToStartDate?: boolean;

  schedules: PreviewScheduleInput[];

};



export type SchedulePreviewResult = {

  from: string;

  to: string;

  dayCount: number;

  totalDueSlots: number;

  schedulesCount: number;

  perSchedule: Array<{

    dueTime: string;

    timeSlotLabel: string;

    dueSlotCount: number;

  }>;

  scheduleType: 'daily' | 'weekly' | 'specific' | 'prn' | 'interval' | 'monthly';

  summaryLabel: string;

  prnNote?: string;

};



function parseUtcDateOnly(iso: string): Date {

  const day = iso.slice(0, 10);

  return new Date(`${day}T00:00:00.000Z`);

}



function utcDateOnly(d: Date): string {

  return d.toISOString().slice(0, 10);

}



function addUtcDays(d: Date, days: number): Date {

  const next = new Date(d);

  next.setUTCDate(next.getUTCDate() + days);

  return next;

}



function inferPreviewScheduleType(

  kind: MedicationKind,

  schedulePattern: MedicationSchedulePattern | null | undefined,

  schedules: PreviewScheduleInput[],

  frequencyIntervalDays?: number,

): SchedulePreviewResult['scheduleType'] {

  if (kind === MedicationKind.PRN) return 'prn';

  if (schedulePattern === MedicationSchedulePattern.MONTHLY) return 'monthly';

  if (schedulePattern === MedicationSchedulePattern.WEEKLY) return 'weekly';

  if (frequencyIntervalDays != null && frequencyIntervalDays > 1) return 'interval';

  const allDays = schedules.flatMap(s => s.daysOfWeek ?? []);

  if (!allDays.length || new Set(allDays).size >= 7) return 'daily';

  if (allDays.length <= 2) return 'weekly';

  return 'specific';

}



export function computeSchedulePreview(input: SchedulePreviewInput): SchedulePreviewResult {

  const start = parseUtcDateOnly(input.startDate);

  const end = parseUtcDateOnly(input.endDate);

  if (end.getTime() < start.getTime()) {

    throw new Error('endDate must be on or after startDate');

  }



  const dayCount =

    Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;

  const interval = Math.max(1, input.frequencyIntervalDays ?? 1);

  const daysOfWeek = input.schedules.flatMap(s => s.daysOfWeek ?? []);

  const scheduleType = inferPreviewScheduleType(

    input.medicationKind,

    input.schedulePattern,

    input.schedules,

    input.frequencyIntervalDays,

  );



  if (input.medicationKind === MedicationKind.PRN) {

    return {

      from: utcDateOnly(start),

      to: utcDateOnly(end),

      dayCount,

      totalDueSlots: 0,

      schedulesCount: input.schedules.length,

      perSchedule: [],

      scheduleType: 'prn',

      summaryLabel: 'PRN — no pre-generated due slots',

      prnNote:

        'PRN administrations are recorded on demand. The MAR shows PRN (+) cells when the medication is active.',

    };

  }



  const perSchedule = input.schedules.map(sch => {

    const timeSlotLabel =

      sch.roundName?.trim() ||

      sch.dueVisitName?.trim() ||

      sch.dueTime ||

      'Administration';

    let dueSlotCount = 0;

    const slotDays = sch.daysOfWeek?.length ? sch.daysOfWeek : daysOfWeek;

    for (let cursor = new Date(start); cursor.getTime() <= end.getTime(); cursor = addUtcDays(cursor, 1)) {

      const applies = scheduleAppliesOnDay({

        dayDate: cursor,

        medicationStartDate: start,

        schedulePattern: input.schedulePattern ?? null,

        frequencyIntervalDays: interval,

        daysOfWeek: slotDays,

        monthlyDayOfMonth: input.monthlyDayOfMonth ?? null,

        monthlyAnchorToStartDate: input.monthlyAnchorToStartDate ?? true,

      });

      if (applies) dueSlotCount += 1;

    }

    return { dueTime: sch.dueTime, timeSlotLabel, dueSlotCount };

  });



  const totalDueSlots = perSchedule.reduce((sum, row) => sum + row.dueSlotCount, 0);

  const timesLabel =

    input.schedules.length === 1 ? '1 time per active day' : `${input.schedules.length} times per active day`;



  let summaryLabel = `${totalDueSlots} due administrations across ${dayCount} days`;

  if (scheduleType === 'interval') {

    summaryLabel = `${totalDueSlots} due slots (every ${interval} day(s), ${timesLabel})`;

  } else if (scheduleType === 'monthly') {

    summaryLabel = `${totalDueSlots} due slots (${timesLabel} on monthly dates)`;

  } else if (scheduleType === 'weekly' || scheduleType === 'specific') {

    summaryLabel = `${totalDueSlots} due slots (${timesLabel} on selected weekdays)`;

  } else {

    summaryLabel = `${totalDueSlots} due slots (${timesLabel})`;

  }



  return {

    from: utcDateOnly(start),

    to: utcDateOnly(end),

    dayCount,

    totalDueSlots,

    schedulesCount: input.schedules.length,

    perSchedule,

    scheduleType,

    summaryLabel,

  };

}



export function defaultPreviewEndDate(startDate: string, previewDays = 30): string {

  const start = parseUtcDateOnly(startDate);

  return utcDateOnly(addUtcDays(start, Math.max(0, previewDays - 1)));

}


