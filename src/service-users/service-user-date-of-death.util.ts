/** Profile reference type for date of death (admin personal details + portal). */
export const SU_PROFILE_DATE_OF_DEATH_REF = 'SU_PROFILE_DATE_OF_DEATH';

/** Parse YYYY-MM-DD or ISO datetime into a UTC noon (or full ISO) Date for storage. */
export function parseServiceUserDateOfDeath(
  raw: string | null | undefined,
): Date | null {
  const t = raw?.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return new Date(`${t}T12:00:00.000Z`);
  }
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
