const DEFAULT_SUSPENSION_REVIEW_DAYS = 7;

export function defaultSuspensionReviewDueAt(from = new Date()): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + DEFAULT_SUSPENSION_REVIEW_DAYS);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function parseVisitPlanDateOnly(value: string, field: string): Date {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error(`${field} must be YYYY-MM-DD`);
  }
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${field} is not a valid date`);
  }
  return d;
}
