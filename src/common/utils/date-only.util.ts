import { BadRequestException } from '@nestjs/common';

/** Helpers for Postgres `DATE` columns exposed as `YYYY-MM-DD` strings in the API. */

/** Prisma DATE value → `YYYY-MM-DD` (UTC calendar date), or null. */
export function dateOnlyToIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

/**
 * `YYYY-MM-DD` → Date at UTC midnight for a Prisma DATE column.
 * undefined → undefined (leave unchanged); null / '' → null (clear); invalid → 400.
 */
export function parseDateOnly(
  value: string | null | undefined,
  field = 'date',
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== trimmed
  ) {
    throw new BadRequestException(`${field} must be a valid YYYY-MM-DD date`);
  }
  return date;
}

/** Optional text column: undefined → unchanged; null / blank → null; otherwise trimmed. */
export function optionalText(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.trim() || null;
}

/** Trim, drop blanks and de-duplicate (case-sensitive) a list of free-text values. */
export function cleanStringList(
  values: string[] | undefined,
): string[] | undefined {
  if (values === undefined) return undefined;
  const out: string[] = [];
  for (const raw of values) {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}
