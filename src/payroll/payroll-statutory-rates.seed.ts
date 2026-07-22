import { Prisma } from '@prisma/client';
import { govUkEnglandRateSnapshot2026_27 } from './payroll-statutory.util';

type TxLike = {
  payrollStatutoryRateSet: {
    findFirst: (args: {
      where: { taxYearId: string; nation: string; isActive: boolean };
    }) => Promise<{ id: string } | null>;
    create: (args: {
      data: {
        taxYearId: string;
        nation: string;
        version: number;
        isActive: boolean;
        personalAllowanceAnnual: Prisma.Decimal | number;
        basicRateBandAnnual: Prisma.Decimal | number;
        higherRateThresholdAnnual: Prisma.Decimal | number;
        additionalRateThresholdAnnual: Prisma.Decimal | number;
        basicRatePercent: Prisma.Decimal | number;
        higherRatePercent: Prisma.Decimal | number;
        additionalRatePercent: Prisma.Decimal | number;
        niLelWeekly: Prisma.Decimal | number;
        niPtWeekly: Prisma.Decimal | number;
        niStWeekly: Prisma.Decimal | number;
        niUelWeekly: Prisma.Decimal | number;
        niLelMonthly: Prisma.Decimal | number;
        niPtMonthly: Prisma.Decimal | number;
        niStMonthly: Prisma.Decimal | number;
        niUelMonthly: Prisma.Decimal | number;
        niEmployeeRateMainPercent: Prisma.Decimal | number;
        niEmployeeRateUpperPercent: Prisma.Decimal | number;
        niEmployerRatePercent: Prisma.Decimal | number;
        sourceNote: string;
      };
    }) => Promise<{ id: string }>;
  };
};

/**
 * Ensure an active England/NI/Wales statutory rate set exists for a tax year.
 * Uses GOV.UK 2026–27 figures (personal allowance and Class 1 rates also apply to 2025–26).
 */
export async function ensureEnglandStatutoryRateSet(
  tx: TxLike,
  taxYearId: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.payrollStatutoryRateSet.findFirst({
    where: { taxYearId, nation: 'ENG', isActive: true },
  });
  if (existing) return { id: existing.id, created: false };

  const rates = govUkEnglandRateSnapshot2026_27();
  const created = await tx.payrollStatutoryRateSet.create({
    data: {
      taxYearId,
      nation: 'ENG',
      version: 1,
      isActive: true,
      ...rates,
      sourceNote:
        'GOV.UK employer rates England/NI/Wales PAYE + Class 1 NI (2026-27 published figures; PA/NI bands also used for 2025-26). W1/M1 engine only.',
    },
  });
  return { id: created.id, created: true };
}
