/**
 * Falls case-finding (NICE NG249): the IA records falls history and concerns, then indicates whether
 * a multifactorial falls assessment is needed. No numeric score is used to predict falls.
 * Mirrors careflow-admin `utils/falls-case-finding.ts` — change both together.
 */
export type FallsCaseFindingStatus = 'required' | 'suggested' | 'not_needed' | 'pending';

export type FallsCaseFindingInput = {
  fallsLast12Months: boolean | null;
  unsteadiness: boolean | null;
  fearOfFalling: boolean | null;
  clinicalConcern: boolean | null;
};

export type FallsCaseFinding = {
  status: FallsCaseFindingStatus;
  reasons: string[];
};

export const FALLS_CASE_FINDING_FIELD_KEYS = {
  fallsLast12Months: 'fallsLast12Months',
  unsteadiness: 'fallsUnsteadiness',
  fearOfFalling: 'fallsFearOfFalling',
  clinicalConcern: 'fallsClinicalConcern',
} as const;

export function fallsCaseFinding(input: FallsCaseFindingInput): FallsCaseFinding {
  const reasons: string[] = [];
  if (input.fallsLast12Months === true) reasons.push('Fall in the last 12 months');
  if (input.unsteadiness === true) reasons.push('Unsteadiness, gait or balance concern');
  if (input.fearOfFalling === true) reasons.push('Fear of falling');
  if (input.clinicalConcern === true) reasons.push('Other clinical concern about falls');

  if (input.fallsLast12Months === true || input.unsteadiness === true) {
    return { status: 'required', reasons };
  }
  if (input.fearOfFalling === true || input.clinicalConcern === true) {
    return { status: 'suggested', reasons };
  }
  const answers = [input.fallsLast12Months, input.unsteadiness, input.fearOfFalling, input.clinicalConcern];
  if (answers.every((a) => a === false)) return { status: 'not_needed', reasons: [] };
  return { status: 'pending', reasons: [] };
}

export const FALLS_ASSESSMENT_REQUIRED_MESSAGE =
  'Falls assessment required — falls case-finding is positive; complete the Falls tab (section 12.7)';
