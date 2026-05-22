import { BadRequestException } from '@nestjs/common';

/** Minutes since midnight for HH:mm (24h). Returns -1 if invalid. */
export function minutesFromHHmm(value: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function assertEndTimeAfterStart(startTime?: string | null, endTime?: string | null): void {
  if (!startTime?.trim() || !endTime?.trim()) return;
  const start = minutesFromHHmm(startTime);
  const end = minutesFromHHmm(endTime);
  if (start < 0 || end < 0) {
    throw new BadRequestException('startTime and endTime must be HH:mm (24h)');
  }
  if (end <= start) {
    throw new BadRequestException('endTime must be greater than startTime');
  }
}

export function durationMinutesFromTimes(startTime?: string | null, endTime?: string | null): number | null {
  if (!startTime?.trim() || !endTime?.trim()) return null;
  const start = minutesFromHHmm(startTime);
  const end = minutesFromHHmm(endTime);
  if (start < 0 || end < 0 || end <= start) return null;
  return end - start;
}
