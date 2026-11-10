/** Profile reference type for date of death (admin personal details + portal). */
export const SU_PROFILE_DATE_OF_DEATH_REF = 'SU_PROFILE_DATE_OF_DEATH';

/**
 * The date of death and the Deceased status must agree. Given the state after a save, says what to do:
 * set the status to Deceased (a date was entered), refuse (Deceased chosen with no date, or the date cleared
 * while Deceased), or nothing.
 */
export function deathStatusAction(input: {
  dateOfDeath: Date | null;
  statusCode: string | null;
  statusChangedToDeceased: boolean;
  /** The save chose a status other than Deceased. */
  statusChangedAway?: boolean;
  dateCleared: boolean;
}): { kind: 'none' } | { kind: 'set_deceased' } | { kind: 'refuse'; message: string } {
  const deceased = input.statusCode === 'DECEASED';
  if (input.dateOfDeath && !deceased && input.statusChangedAway) {
    return { kind: 'refuse', message: 'This person has a date of death. To change their status, clear the date of death in Personal Details in the same save.' };
  }
  if (input.dateOfDeath && !deceased) return { kind: 'set_deceased' };
  if (!input.dateOfDeath && deceased && input.statusChangedToDeceased) {
    return { kind: 'refuse', message: 'Enter the date of death in Personal Details to set the status to Deceased.' };
  }
  if (!input.dateOfDeath && deceased && input.dateCleared) {
    return { kind: 'refuse', message: 'This person is recorded as Deceased. To remove the date of death, choose their correct status in the same save.' };
  }
  return { kind: 'none' };
}

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
