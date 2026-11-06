/**
 * UK mobile numbers for survey text messages, from the numbers already held on people's records.
 * Accepts the ways people write them (07700 900123, +44 7700 900123, 0044 7700 900123,
 * 447700900123, (07700) 900-123, +44 (0)7700 900123) and returns the international form
 * (+447700900123). Landlines, personal numbering (070), pagers (076, except 07624 Isle of Man
 * mobiles), short numbers and anything that is not a UK mobile are refused (null).
 */
export function normaliseUkMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^tel:/i, '');
  if (!trimmed || /[a-z]/i.test(trimmed)) return null;
  let digits = trimmed.replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(digits)) return null;
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `44${digits.slice(1)}`;
  if (digits.startsWith('440')) digits = `44${digits.slice(3)}`;
  if (!/^447\d{9}$/.test(digits)) return null;
  if (digits.startsWith('4470')) return null;
  if (digits.startsWith('4476') && !digits.startsWith('447624')) return null;
  return `+${digits}`;
}

/** For logs and screens that must not show the number: "07*** ***123". */
export function maskMobile(e164: string): string {
  const national = e164.startsWith('+44') ? `0${e164.slice(3)}` : e164;
  return `${national.slice(0, 2)}*** ***${national.slice(-3)}`;
}

/** The first UK mobile among a person's numbers (pass the mobile first), normalised, or null. */
export function firstUkMobile(...numbers: Array<string | null | undefined>): string | null {
  for (const n of numbers) {
    const ok = normaliseUkMobile(n);
    if (ok) return ok;
  }
  return null;
}
