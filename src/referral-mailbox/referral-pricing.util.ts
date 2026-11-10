/**
 * Prices for referral replies: where a rate comes from, the rates in words, and example visit prices.
 * Rate sources, in order:
 *  1. Council / NHS funded care: the funder's standard charge card (Funders settings) — indicative only, never a quote.
 *  2. Everyone else (self-funded, direct payments, unknown, price-only enquiries): the branch's standard private
 *     rates, else the all-branches standard private rates (Referral inbox → Rates).
 *  3. Nothing set: no price; the reply says rates will follow and the enquiry asks staff to send them.
 */
import { describeQuoteRates, normaliseQuoteRates, round2, type QuoteRates } from '../crm/quotations/quote-pricing.util';

export type FundingType = 'LOCAL_AUTHORITY' | 'NHS' | 'PRIVATE' | 'DIRECT_PAYMENT' | 'MIXED' | 'UNKNOWN' | string;

/** Council- or NHS-funded care is priced by the funder's contract, not our private rates. */
export const isCommissioned = (type: FundingType) => type === 'LOCAL_AUTHORITY' || type === 'NHS';

const gbp = (n: number) => `£${n.toFixed(2)}`;

/** The weekday price of one visit of this length for one carer (short-visit band first, else pro-rata hourly). */
export function visitPrice(minutes: number, hourlyRate: number, rates: QuoteRates | null): number {
  const band = (rates?.shortVisits ?? [])
    .filter((b) => minutes <= b.upToMinutes)
    .sort((a, b) => a.upToMinutes - b.upToMinutes)[0];
  return round2(band ? band.pricePerVisit : (hourlyRate * minutes) / 60);
}

/** "Weekday hourly rate: £30.00 an hour; Weekend: +20%; …" from the quotation's own rate wording. */
export function standardRatesInWords(hourlyRate: number, rawRates: unknown): string {
  return describeQuoteRates(hourlyRate, normaliseQuoteRates(rawRates))
    .map((r) => `${r.label}: ${r.value}`)
    .join('; ');
}

/** The rates one per line, e.g. ["Standard visits: £30.00 per carer per hour", …]. */
export function standardRatesList(hourlyRate: number, rawRates: unknown): string[] {
  return describeQuoteRates(hourlyRate, normaliseQuoteRates(rawRates)).map((r) => `${r.label}: ${r.value}`);
}

/** Example weekday prices for common visit lengths (the referral's own lengths first). */
export function exampleVisitPrices(hourlyRate: number, rawRates: unknown, askedMinutes: number[] = []): string[] {
  const rates = normaliseQuoteRates(rawRates);
  const lengths = [...new Set([...askedMinutes.filter((m) => m > 0 && m <= 720), 30, 45, 60])].slice(0, 4);
  return lengths.map((m) => {
    const label = m % 60 === 0 ? `${m / 60}-hour` : `${m}-minute`;
    return `A ${label} weekday visit (one carer): ${gbp(visitPrice(m, hourlyRate, rates))}`;
  });
}

export const formatGbp = gbp;
