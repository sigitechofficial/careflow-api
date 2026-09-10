/** How carers enter the property (UK domiciliary access). */
export const HOME_ACCESS_METHOD_VALUES = [
  'key_safe',
  'answers_door',
  'family_keyholder',
  'agency_holds_key',
  'intercom',
  'other',
] as const;

export type HomeAccessMethod = (typeof HOME_ACCESS_METHOD_VALUES)[number];

export const HOME_ACCESS_METHOD_LABELS: Record<HomeAccessMethod, string> = {
  key_safe: 'Key safe',
  answers_door: 'Person answers door',
  family_keyholder: 'Family / keyholder',
  agency_holds_key: 'Agency holds key',
  intercom: 'Intercom / call on arrival',
  other: 'Other',
};

export function homeAccessMethodLabel(value?: string | null): string | null {
  const code = value?.trim();
  if (!code) return null;
  if (code in HOME_ACCESS_METHOD_LABELS) {
    return HOME_ACCESS_METHOD_LABELS[code as HomeAccessMethod];
  }
  return code;
}
