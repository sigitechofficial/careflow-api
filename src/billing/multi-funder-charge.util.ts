import { FundingStatus, Prisma } from '@prisma/client';
import { type FundingSplitLine, buildFundingSplits } from './billing-run.util';
import { calculateBillableAmount } from './visit-reconciliation.util';

type DbClient = Prisma.TransactionClient | { serviceUserFunding: Prisma.TransactionClient['serviceUserFunding']; chargeCardRule: Prisma.TransactionClient['chargeCardRule']; chargeCard: Prisma.TransactionClient['chargeCard'] };

export type MultiFunderChargeInput = {
  fundingId: string;
  funderId: string | null;
  funderName: string | null;
  splitPercent: number | null;
  splitPriority: number;
  isPrimary: boolean;
  isActive: boolean;
  status: import('@prisma/client').FundingStatus;
  chargeCardId: string | null;
  cardGrossAmount: number | null;
};

export type MultiFunderChargeLine = {
  fundingId: string;
  funderId: string | null;
  funderName: string | null;
  splitPercent: number | null;
  splitPriority: number;
  isPrimary: boolean;
  chargeCardId: string | null;
  cardGrossAmount: number | null;
  amount: number;
  included: boolean;
  reason: string | null;
};

export type MultiFunderChargeResult = {
  totalAmount: number;
  primaryChargeCardId: string | null;
  lines: MultiFunderChargeLine[];
};

export function shouldUsePerFunderChargeCards(splits: FundingSplitLine[]): boolean {
  return splits.length >= 2 && splits.some((s) => s.splitPercent != null && s.splitPercent > 0);
}

export function calculatePerFunderChargeAmounts(
  inputs: MultiFunderChargeInput[],
): MultiFunderChargeResult | null {
  const splits = buildFundingSplits(
    inputs.map((row) => ({
      id: row.fundingId,
      funderId: row.funderId,
      splitPercent: row.splitPercent,
      splitPriority: row.splitPriority,
      isPrimary: row.isPrimary,
      isActive: row.isActive,
      status: row.status,
      funder: row.funderName ? { name: row.funderName } : null,
    })),
  );
  if (!shouldUsePerFunderChargeCards(splits)) return null;

  const ordered = [...inputs].sort((a, b) => a.splitPriority - b.splitPriority);
  const withPercent = ordered.filter((row) => row.splitPercent != null && row.splitPercent > 0);

  const lines: MultiFunderChargeLine[] = ordered.map((row) => {
    const base = {
      fundingId: row.fundingId,
      funderId: row.funderId,
      funderName: row.funderName,
      splitPercent: row.splitPercent,
      splitPriority: row.splitPriority,
      isPrimary: row.isPrimary,
      chargeCardId: row.chargeCardId,
      cardGrossAmount: row.cardGrossAmount,
      amount: 0,
      included: false,
      reason: null as string | null,
    };

    if (!row.chargeCardId) {
      if (row.splitPercent != null && row.splitPercent > 0) {
        return {
          ...base,
          reason: 'No charge card on this funding contract.',
        };
      }
      return { ...base, reason: 'No split % on this funding.' };
    }

    if (row.cardGrossAmount == null) {
      if (row.splitPercent != null && row.splitPercent > 0) {
        return {
          ...base,
          reason: 'No matching rate on this funder\'s charge card for this visit.',
        };
      }
      return { ...base, reason: 'No split % on this funding.' };
    }

    if (withPercent.length === 0) {
      const primary = ordered.find((r) => r.isPrimary) ?? ordered[0];
      const isPrimaryLine = row.fundingId === primary?.fundingId;
      return {
        ...base,
        amount: isPrimaryLine ? row.cardGrossAmount : 0,
        included: isPrimaryLine && row.cardGrossAmount > 0,
        reason: isPrimaryLine ? null : 'No split % on this funding.',
      };
    }

    if (withPercent.length === 1 && ordered.length > 1) {
      const winner = withPercent[0]!;
      const isWinner = row.fundingId === winner.fundingId;
      return {
        ...base,
        amount: isWinner ? row.cardGrossAmount : 0,
        included: isWinner && row.cardGrossAmount > 0,
        reason: isWinner ? null : 'Only one funder has a split % — that funder receives the full visit charge at their rate card.',
      };
    }

    if (row.splitPercent == null || row.splitPercent <= 0) {
      return { ...base, reason: 'No split % on this funding — receives £0.' };
    }

    const amount = Math.round(row.cardGrossAmount * (row.splitPercent / 100) * 100) / 100;
    return {
      ...base,
      amount,
      included: amount > 0,
      reason: null,
    };
  });

  const totalAmount = Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
  const primaryLine =
    lines.find((line) => line.isPrimary && line.chargeCardId) ??
    lines.find((line) => line.included && line.chargeCardId) ??
    null;

  return {
    totalAmount,
    primaryChargeCardId: primaryLine?.chargeCardId ?? null,
    lines,
  };
}

export async function loadPerFunderChargeCalculation(
  db: DbClient,
  params: {
    serviceUserId: string;
    billMinutes: number;
    /** Planned visit minutes — drives fixed vs hourly rate selection. */
    rateBasisMinutes?: number | null;
    billRateAnchor: Date;
    approvedBillStart: Date;
    approvedBillEnd: Date;
    isBankHoliday: boolean;
    isBankHolidayFn: (date: Date) => boolean;
    nightDuty?: string | null;
    timeZone?: string;
  },
): Promise<MultiFunderChargeResult | null> {
  if (params.billMinutes <= 0) return null;

  const fundingRows = await db.serviceUserFunding.findMany({
    where: { serviceUserId: params.serviceUserId, deletedAt: null },
    include: {
      funder: {
        select: {
          id: true,
          name: true,
          defaultChargeCardId: true,
        },
      },
    },
  });

  const splits = buildFundingSplits(
    fundingRows.map((funding) => ({
      id: funding.id,
      funderId: funding.funderId,
      splitPercent: funding.splitPercent,
      splitPriority: funding.splitPriority,
      isPrimary: funding.isPrimary,
      isActive: funding.isActive,
      status: funding.status,
      funder: funding.funder ? { name: funding.funder.name } : null,
    })),
  );
  if (!shouldUsePerFunderChargeCards(splits)) return null;

  const inputs: MultiFunderChargeInput[] = [];
  for (const funding of fundingRows) {
    const chargeCardId =
      funding.defaultChargeCardId ?? funding.funder?.defaultChargeCardId ?? null;
    let cardGrossAmount: number | null = null;
    if (chargeCardId) {
      const [rules, card] = await Promise.all([
        db.chargeCardRule.findMany({ where: { chargeCardId } }),
        db.chargeCard.findUnique({
          where: { id: chargeCardId },
          select: { defaultChargeMethod: true },
        }),
      ]);
      const calc = calculateBillableAmount(
        rules,
        params.billRateAnchor,
        params.billMinutes,
        card?.defaultChargeMethod ?? 'HOURLY_PRO_RATA',
        params.isBankHoliday,
        {
          start: params.approvedBillStart,
          end: params.approvedBillEnd,
          isBankHolidayFn: params.isBankHolidayFn,
          timeZone: params.timeZone,
        },
        params.nightDuty,
        params.rateBasisMinutes,
      );
      cardGrossAmount = calc?.amount ?? null;
    }

    inputs.push({
      fundingId: funding.id,
      funderId: funding.funderId,
      funderName: funding.funder?.name ?? null,
      splitPercent: funding.splitPercent != null ? Number(funding.splitPercent) : null,
      splitPriority: funding.splitPriority,
      isPrimary: funding.isPrimary,
      isActive: funding.isActive,
      status: funding.status as FundingStatus,
      chargeCardId,
      cardGrossAmount,
    });
  }

  return calculatePerFunderChargeAmounts(inputs);
}
