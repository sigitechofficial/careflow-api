/**
 * Production QA Demo Data may only run against these Service User numbers.
 * SU-1042 is the existing IA demo identifier (Margaret Hughes). Do not invent
 * extra numbers or reuse a real customer.
 */
export const IA_QA_DEMO_SERVICE_USER_NUMBERS = ['SU-1042'] as const

export function isDesignatedIaQaDemoServiceUserNumber(
  serviceUserNumber: string | null | undefined,
): boolean {
  return (
    typeof serviceUserNumber === 'string' &&
    (IA_QA_DEMO_SERVICE_USER_NUMBERS as readonly string[]).includes(serviceUserNumber)
  );
}
