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

export type FunderSplitPreviewLine = {
  funderName: string;
  splitPercent: number | null;
  amount: number;
  included: boolean;
  reason: string | null;
  chargeCardName: string | null;
  /** True when this funder's funding charge card was used for the visit gross. */
  pricedWithVisitCard: boolean;
  pricingNote: string | null;
};

export type FunderSplitPreview = {
  totalAmount: number;
  note: string;
  visitChargeCardName: string | null;
  lines: FunderSplitPreviewLine[];
};

export type FunderSplitPreviewOptions = {
  visitChargeCardId?: string | null;
  visitChargeCardName?: string | null;
  fundingChargeCardById?: Map<string, { id: string; name: string } | null>;
};

/** Preview how a visit charge is split across funders on invoice run. */
export function buildFunderSplitPreview(
  total: number,
  splits: FundingSplitLine[],
  options?: FunderSplitPreviewOptions,
): FunderSplitPreview | null {
  if (splits.length < 2) return null;

  const visitChargeCardId = options?.visitChargeCardId ?? null;
  const visitChargeCardName = options?.visitChargeCardName?.trim() || null;
  const fundingChargeCardById = options?.fundingChargeCardById ?? new Map();

  const ordered = [...splits].sort((a, b) => a.splitPriority - b.splitPriority);
  const allocated = splitAmount(total, splits);
  const allocatedById = new Map(allocated.map((line) => [line.id, line.amount]));

  const withPercent = ordered.filter((s) => s.splitPercent != null && s.splitPercent > 0);
  const primaryName =
    ordered.find((s) => s.isPrimary)?.funderName ??
    ordered[0]?.funderName ??
    'primary funder';

  const distinctFundingCards = new Set(
    [...fundingChargeCardById.values()]
      .filter((card): card is { id: string; name: string } => Boolean(card?.id))
      .map((card) => card.id),
  );
  const hasMultipleFundingCards = distinctFundingCards.size > 1;

  const lines: FunderSplitPreviewLine[] = ordered.map((split) => {
    const amount = allocatedById.get(split.id) ?? 0;
    const included = amount > 0;
    const fundingCard = fundingChargeCardById.get(split.id) ?? null;
    const chargeCardName = fundingCard?.name ?? null;
    const pricedWithVisitCard = Boolean(
      visitChargeCardId && fundingCard?.id && fundingCard.id === visitChargeCardId,
    );

    let reason: string | null = null;
    let pricingNote: string | null = null;

    if (!included) {
      if (split.splitPercent == null || split.splitPercent <= 0) {
        reason = 'No split % on this funding — receives £0 on the invoice run.';
      } else {
        reason = 'Not allocated on this invoice run.';
      }
    } else if (hasMultipleFundingCards && !pricedWithVisitCard) {
      pricingNote = chargeCardName
        ? `${split.splitPercent != null ? `${split.splitPercent}% share` : 'Share'} of the visit charge priced with ${visitChargeCardName ?? 'the primary rate card'} — ${chargeCardName} on this funding is not applied to the visit gross in percentage-split mode.`
        : `Share of the visit charge priced with ${visitChargeCardName ?? 'the primary rate card'}.`;
    } else if (pricedWithVisitCard) {
      pricingNote = 'Visit gross charge is calculated with this funder\'s rate card.';
    }

    return {
      funderName: split.funderName ?? 'Unassigned funder',
      splitPercent: split.splitPercent,
      amount,
      included,
      reason,
      chargeCardName,
      pricedWithVisitCard,
      pricingNote,
    };
  });

  let note: string;
  if (total <= 0) {
    note =
      'Visit charge is £0 — funder split is not applied until there is an approved billable amount.';
  } else if (hasMultipleFundingCards) {
    note = `This visit has one gross charge using ${visitChargeCardName ?? 'the primary funding rate card'}. Percentage split divides that total on the invoice run — each funder's own charge card is not used to price the visit separately.`;
  } else if (withPercent.length === 0) {
    note = `Multiple funders apply but no split % is configured. The primary funder (${primaryName}) receives the full ${formatMoney(total)} when an invoice run is calculated. Other funders receive £0.`;
  } else if (withPercent.length === 1 && ordered.length > 1) {
    const named = withPercent[0]!.funderName ?? 'the funder with a split %';
    note = `Only ${named} has a split % configured, so that funder receives 100% (${formatMoney(total)}) on the invoice run. Other funders receive £0.`;
  } else if (lines.some((line) => !line.included)) {
    note =
      'The visit charge above is split across funders when an invoice run is calculated. Funders without a split % receive £0.';
  } else {
    note =
      'The visit charge above is split across funders when an invoice run is calculated. Each funder receives a separate invoice line.';
  }

  return { totalAmount: total, note, visitChargeCardName, lines };
}
