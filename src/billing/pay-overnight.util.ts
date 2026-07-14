/**
 * Overnight (waking night / sleep-in / live-in) and on-call pay helpers.
 */

export type SleepInCalcInput = {
  fixedAllowance: number;
  awakeMinutes: number;
  awakeHourlyRate: number;
  minimumCallOutMinutes?: number;
  callOutCount?: number;
  /** When true, entire shift paid at waking-night rate instead of sleep-in. */
  convertToWakingNight?: boolean;
  wakingNightHourlyRate?: number;
  scheduledShiftMinutes?: number;
};

export type SleepInCalcResult = {
  amount: number;
  components: Array<{ type: string; amount: number; explanation: string }>;
  explanation: string;
};

export function calculateSleepInPay(input: SleepInCalcInput): SleepInCalcResult {
  if (input.convertToWakingNight && input.wakingNightHourlyRate != null && input.scheduledShiftMinutes) {
    const amount =
      Math.round(input.wakingNightHourlyRate * (input.scheduledShiftMinutes / 60) * 100) / 100;
    return {
      amount,
      components: [
        {
          type: 'WAKING_NIGHT_CONVERSION',
          amount,
          explanation: `Converted to waking night: ${input.scheduledShiftMinutes}m × £${input.wakingNightHourlyRate.toFixed(2)}/hr`,
        },
      ],
      explanation: `Sleep-in converted to waking night = £${amount.toFixed(2)}`,
    };
  }

  const minCall = input.minimumCallOutMinutes ?? 0;
  let awakeMinutes = input.awakeMinutes;
  if ((input.callOutCount ?? 0) > 0 && minCall > 0) {
    awakeMinutes = Math.max(awakeMinutes, (input.callOutCount ?? 0) * minCall);
  }

  const awakePay = Math.round(input.awakeHourlyRate * (awakeMinutes / 60) * 100) / 100;
  const allowance = input.fixedAllowance;
  const amount = Math.round((allowance + awakePay) * 100) / 100;

  return {
    amount,
    components: [
      {
        type: 'SLEEP_IN_ALLOWANCE',
        amount: allowance,
        explanation: `Sleep-in allowance £${allowance.toFixed(2)}`,
      },
      {
        type: 'SLEEP_IN_AWAKE',
        amount: awakePay,
        explanation: `Awake ${awakeMinutes}m × £${input.awakeHourlyRate.toFixed(2)}/hr = £${awakePay.toFixed(2)}`,
      },
    ],
    explanation: `Sleep-in £${allowance.toFixed(2)} + awake £${awakePay.toFixed(2)} = £${amount.toFixed(2)}`,
  };
}

export function calculateWakingNightPay(
  shiftMinutes: number,
  wakingNightHourlyRate: number,
): { amount: number; explanation: string } {
  const amount = Math.round(wakingNightHourlyRate * (shiftMinutes / 60) * 100) / 100;
  return {
    amount,
    explanation: `Waking night ${shiftMinutes}m × £${wakingNightHourlyRate.toFixed(2)}/hr = £${amount.toFixed(2)}`,
  };
}

export type LiveInCalcInput = {
  dailyAllowance: number;
  expectedWorkingHoursPay?: number;
  sleepInComponent?: number;
  mealAllowance?: number;
  nightInterruptionPay?: number;
  emergencyCallOutPay?: number;
  handoverDayRate?: number;
  isHandoverDay?: boolean;
  weeklyCap?: number;
  weeklyAccruedSoFar?: number;
};

export function calculateLiveInDayPay(input: LiveInCalcInput): {
  amount: number;
  explanation: string;
  capped: boolean;
} {
  if (input.isHandoverDay && input.handoverDayRate != null) {
    return {
      amount: input.handoverDayRate,
      explanation: `Handover day rate £${input.handoverDayRate.toFixed(2)}`,
      capped: false,
    };
  }

  let gross =
    input.dailyAllowance +
    (input.expectedWorkingHoursPay ?? 0) +
    (input.sleepInComponent ?? 0) +
    (input.mealAllowance ?? 0) +
    (input.nightInterruptionPay ?? 0) +
    (input.emergencyCallOutPay ?? 0);

  let capped = false;
  if (input.weeklyCap != null && input.weeklyAccruedSoFar != null) {
    const remaining = Math.max(0, input.weeklyCap - input.weeklyAccruedSoFar);
    if (gross > remaining) {
      gross = remaining;
      capped = true;
    }
  }

  return {
    amount: Math.round(gross * 100) / 100,
    explanation: `Live-in day £${gross.toFixed(2)}${capped ? ' (weekly cap applied)' : ''}`,
    capped,
  };
}

export type OnCallStandbyUnit = 'HOUR' | 'NIGHT' | 'DAY' | 'WEEKEND' | 'ROTA_PERIOD';

export function calculateOnCallStandby(input: {
  allowance: number;
  units: number;
  unit: OnCallStandbyUnit;
}): { amount: number; explanation: string } {
  const amount = Math.round(input.allowance * input.units * 100) / 100;
  return {
    amount,
    explanation: `On-call standby ${input.units} × £${input.allowance.toFixed(2)} per ${input.unit.toLowerCase()} = £${amount.toFixed(2)}`,
  };
}

export function calculateCallOutPay(input: {
  workedMinutes: number;
  hourlyRate: number;
  minimumMinutes?: number;
  isRemote?: boolean;
  remoteHourlyRate?: number;
  emergencyUpliftPerHour?: number;
  travelMinutes?: number;
  travelHourlyRate?: number;
}): { amount: number; explanation: string } {
  const min = input.minimumMinutes ?? 0;
  const payableMins = Math.max(input.workedMinutes, min);
  const rate = input.isRemote
    ? (input.remoteHourlyRate ?? input.hourlyRate)
    : input.hourlyRate + (input.emergencyUpliftPerHour ?? 0);
  let amount = rate * (payableMins / 60);
  const parts = [`call-out ${payableMins}m × £${rate.toFixed(2)}/hr`];

  if (input.travelMinutes && input.travelHourlyRate) {
    const travel = input.travelHourlyRate * (input.travelMinutes / 60);
    amount += travel;
    parts.push(`travel ${input.travelMinutes}m × £${input.travelHourlyRate.toFixed(2)}/hr`);
  }

  amount = Math.round(amount * 100) / 100;
  return { amount, explanation: `${parts.join(' + ')} = £${amount.toFixed(2)}` };
}
