import { BadRequestException } from '@nestjs/common';

export function parseWeeklyContractedHours(value: string | null | undefined): number | null {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number.parseFloat(String(value).trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function assertWeeklyContractedHoursForCreate(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    throw new BadRequestException('Weekly contracted hours is required to create a visit plan');
  }
  if (parseWeeklyContractedHours(trimmed) === null) {
    throw new BadRequestException('Weekly contracted hours must be a valid number');
  }
  return trimmed;
}
