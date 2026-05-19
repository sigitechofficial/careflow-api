import { BadRequestException } from '@nestjs/common';

/** Parse YYYY-MM-DD to UTC midnight. */
export function parseScheduleDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) throw new BadRequestException('Date must be YYYY-MM-DD');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
  if (Number.isNaN(dt.getTime())) throw new BadRequestException('Invalid date');
  return dt;
}

export function formatScheduleDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
