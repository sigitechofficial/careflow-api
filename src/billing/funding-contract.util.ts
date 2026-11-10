import { BadRequestException } from '@nestjs/common';
import { FundingStatus, Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export function isBillableFundingStatus(status: FundingStatus): boolean {
  return (
    status !== FundingStatus.ENDED &&
    status !== FundingStatus.REJECTED &&
    status !== FundingStatus.SUSPENDED
  );
}

export async function assertFundingSplitPercentages(
  tx: Tx,
  serviceUserId: string,
  nextSplitPercent: number | null | undefined,
  exceptFundingId?: string,
) {
  if (nextSplitPercent == null) return;
  if (nextSplitPercent < 0 || nextSplitPercent > 100) {
    throw new BadRequestException('Split percentage must be between 0 and 100');
  }
  const rows = await tx.serviceUserFunding.findMany({
    where: {
      serviceUserId,
      deletedAt: null,
      isActive: true,
      splitPercent: { not: null },
      ...(exceptFundingId ? { id: { not: exceptFundingId } } : {}),
    },
    select: { splitPercent: true },
  });
  const existingTotal = rows.reduce((sum, row) => sum + Number(row.splitPercent ?? 0), 0);
  const total = existingTotal + nextSplitPercent;
  if (total > 100.001) {
    throw new BadRequestException(
      `Total split percentage would be ${total.toFixed(1)}%. Combined splits for a service user cannot exceed 100%.`,
    );
  }
}

export type FundingBillingReadiness = {
  isReady: boolean;
  issues: string[];
};

export function assessFundingBillingReadiness(input: {
  status: FundingStatus;
  isActive: boolean;
  funderId: string | null;
  defaultChargeCardId: string | null;
  funderDefaultChargeCardId?: string | null;
  purchaseOrderNumber?: string | null;
  purchaseOrderExpiresAt?: Date | null;
  billingContactName?: string | null;
  /** The funder's billing contact or email (Settings → Funders); used when the line has none of its own. */
  funderBillingContact?: string | null;
}): FundingBillingReadiness {
  const issues: string[] = [];
  if (!input.isActive || !isBillableFundingStatus(input.status)) {
    issues.push('Funding is not active');
  }
  if (!input.funderId) {
    issues.push('Funder not assigned');
  }
  if (!input.defaultChargeCardId && !input.funderDefaultChargeCardId) {
    issues.push('No charge card on contract or funder');
  }
  if (input.purchaseOrderExpiresAt) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (input.purchaseOrderExpiresAt < today) {
      issues.push('Purchase order expired');
    }
  }
  if (!input.billingContactName?.trim() && !input.funderBillingContact?.trim()) {
    issues.push('Billing contact missing — add one to the funder in Settings → Funders');
  }
  return { isReady: issues.length === 0, issues };
}

export function formatAuthorisedHours(hours: number | null | undefined): string | null {
  if (hours == null || Number.isNaN(hours)) return null;
  return `${hours} hrs/week`;
}

export function formatFundersSplit(
  fundings: Array<{
    funder?: { name: string } | null;
    splitPercent: Prisma.Decimal | number | null;
    contributionAmount: Prisma.Decimal | number | null;
    isPrimary: boolean;
  }>,
): string {
  if (!fundings.length) return '—';
  return fundings
    .map((f) => {
      const name = f.funder?.name ?? 'Unassigned funder';
      if (f.splitPercent != null) {
        const pct = Number(f.splitPercent);
        return `${name} (${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%)`;
      }
      if (f.contributionAmount != null) {
        return `${name} (£${Number(f.contributionAmount).toFixed(0)} contribution)`;
      }
      if (f.isPrimary) return `${name} (primary)`;
      return name;
    })
    .join(', ');
}
