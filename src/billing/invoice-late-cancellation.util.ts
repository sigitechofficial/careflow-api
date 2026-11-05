import { calculateBillableAmount } from './visit-reconciliation.util';

/**
 * Late cancellation billing (docs/SU_LATE_CANCELLATION_BILLING_PLAN.md): a visit cancelled with a
 * Charge decision is billed as its own invoice line, priced like a delivered visit of the planned
 * length (charge card rate for that day and time) and multiplied by the charge percent.
 */

type ChargeRuleLike = Parameters<typeof calculateBillableAmount>[0];

/** Percent billed for a Charge decision: the cancellation rule's percent, else the full visit. */
export function lateCancellationPercent(
  chargePercent: number | null | undefined,
  suggestedChargePercent: number | null | undefined,
): number {
  for (const value of [chargePercent, suggestedChargePercent]) {
    if (value != null && value > 0) return Math.min(100, Math.round(value));
  }
  return 100;
}

/** Planned minutes of one carer's visit (end − start, else the estimated duration). */
export function lateCancellationMinutes(job: {
  scheduledStartDateTime: Date;
  scheduledEndDateTime: Date | null;
  estimatedDurationMinutes: number | null;
}): number {
  const minutes = job.scheduledEndDateTime
    ? Math.round(
        (job.scheduledEndDateTime.getTime() -
          job.scheduledStartDateTime.getTime()) /
          60000,
      )
    : (job.estimatedDurationMinutes ?? 0);
  return Math.max(0, minutes);
}

/**
 * Amount billed for a chargeable cancellation, or null when the charge card has no rate for it.
 * Each carer of a double-up is priced as a delivered visit would be.
 */
export function lateCancellationAmount(input: {
  rules: ChargeRuleLike;
  defaultChargeMethod: string;
  start: Date;
  minutes: number;
  carers: number;
  percent: number;
  isBankHolidayFn: (d: Date) => boolean;
  timeZone: string;
}): number | null {
  if (input.minutes <= 0) return null;
  const end = new Date(input.start.getTime() + input.minutes * 60000);
  const calc = calculateBillableAmount(
    input.rules,
    input.start,
    input.minutes,
    input.defaultChargeMethod,
    input.isBankHolidayFn(input.start),
    {
      start: input.start,
      end,
      isBankHolidayFn: input.isBankHolidayFn,
      timeZone: input.timeZone,
    },
    null,
    input.minutes,
  );
  if (!calc) return null;
  const full = calc.amount * Math.max(1, input.carers);
  return Math.round(full * input.percent) / 100;
}

/** "Late cancellation — Morning (05/11/2026 08:00) · 22h notice · 100%". */
export function lateCancellationDescription(input: {
  jobName: string;
  when: string;
  noticeHours: number | null;
  percent: number;
  late: boolean;
}): string {
  const notice =
    input.noticeHours != null
      ? ` · ${Math.round(input.noticeHours * 10) / 10}h notice`
      : '';
  return `${input.late ? 'Late charge — ' : ''}Late cancellation — ${input.jobName} (${input.when})${notice} · ${input.percent}%`;
}
