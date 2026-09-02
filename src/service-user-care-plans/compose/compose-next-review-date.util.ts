import {
  defaultNextReviewDate,
  isoDateOnly,
} from '../care-plan-review-schedule';
import type { CarePlanComposeContext, ComposeFieldResult } from './compose-context.types';

/** Prefill a form DATE field from Care Pathway frequency. Not the instance source of truth. */
export function resolveComposeNextReviewDate(
  ctx: CarePlanComposeContext,
  label: string,
): ComposeFieldResult | null {
  const next = defaultNextReviewDate(new Date(), ctx.reviewFrequencyMonths ?? null);
  if (!next || !ctx.reviewFrequencyMonths) return null;
  const months = ctx.reviewFrequencyMonths;
  const unit = months === 1 ? 'month' : 'months';
  return {
    fieldKey: '',
    label,
    value: isoDateOnly(next),
    source: 'static',
    sourceLabel: `Care Pathway review frequency (${months} ${unit})`,
  };
}
