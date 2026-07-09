import { FundingStatus } from '@prisma/client';
import { isBillableFundingStatus } from './funding-contract.util';

export function parseBillingDateOnly(value: string): Date {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return d;
}

export function endOfBillingDate(value: string | Date): Date {
  const d = typeof value === 'string' ? parseBillingDateOnly(value) : new Date(value);
  return new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1);
}

export function formatPeriodLabel(periodEnd: Date): string {
  return `Week ending ${new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(periodEnd)}`;
}

export function formatMoney(amount: number | string, currency = 'GBP'): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (currency === 'GBP') return `£${n.toFixed(2)}`;
  return `${currency} ${n.toFixed(2)}`;
}

export type FundingSplitLine = {
  id: string;
  funderId: string | null;
  funderName: string | null;
  splitPercent: number | null;
  splitPriority: number;
  isPrimary: boolean;
};

export function buildFundingSplits(
  lines: Array<{
    id: string;
    funderId: string | null;
    splitPercent: unknown;
    splitPriority: number;
    isPrimary: boolean;
    isActive: boolean;
    status: FundingStatus;
    funder?: { name: string } | null;
  }>,
): FundingSplitLine[] {
  const active = lines.filter((l) => l.isActive && isBillableFundingStatus(l.status));
  return active
    .map((l) => ({
      id: l.id,
      funderId: l.funderId,
      funderName: l.funder?.name ?? null,
      splitPercent: l.splitPercent != null ? Number(l.splitPercent) : null,
      splitPriority: l.splitPriority,
      isPrimary: l.isPrimary,
    }))
    .sort((a, b) => a.splitPriority - b.splitPriority);
}

export function splitAmount(total: number, splits: FundingSplitLine[]): Array<FundingSplitLine & { amount: number }> {
  if (!splits.length) return [];

  const withPercent = splits.filter((s) => s.splitPercent != null && s.splitPercent > 0);
  if (!withPercent.length) {
    const primary = splits.find((s) => s.isPrimary) ?? splits[0];
    return [{ ...primary, amount: Math.round(total * 100) / 100 }];
  }

  const result: Array<FundingSplitLine & { amount: number }> = [];
  let allocated = 0;
  for (let i = 0; i < withPercent.length; i++) {
    const split = withPercent[i]!;
    const isLast = i === withPercent.length - 1;
    const raw = isLast
      ? total - allocated
      : Math.round(total * (split.splitPercent! / 100) * 100) / 100;
    allocated += raw;
    result.push({ ...split, amount: raw });
  }
  return result;
}
