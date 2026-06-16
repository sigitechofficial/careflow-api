const FIELD_MESSAGES: Record<string, string> = {
  username: 'This username is already in use. Choose a different username.',
  email: 'This email address is already in use. Choose a different email.',
  employeeNumber: 'This employee number is already in use.',
  payrollNumber: 'This payroll number is already in use.',
  nationalInsuranceNo: 'This National Insurance number is already in use.',
  nmcPinNumber: 'This NMC PIN is already in use.',
};

function fieldFromConstraintTarget(target: unknown): string | null {
  const raw = String(target ?? '').trim();
  if (!raw) return null;
  if (FIELD_MESSAGES[raw]) return raw;
  const suffixMatch = raw.match(/_([A-Za-z0-9]+)_key$/);
  if (suffixMatch?.[1] && FIELD_MESSAGES[suffixMatch[1]]) return suffixMatch[1];
  return raw;
}

export function uniqueConstraintFields(meta: unknown): string[] {
  const target = (meta as { target?: unknown } | undefined)?.target;
  if (!target) return [];
  const items = Array.isArray(target) ? target : [target];
  const fields = items
    .map(fieldFromConstraintTarget)
    .filter((f): f is string => Boolean(f));
  return [...new Set(fields)];
}

export function uniqueConstraintMessage(meta: unknown): string {
  const fields = uniqueConstraintFields(meta);
  if (fields.length === 1) {
    return FIELD_MESSAGES[fields[0]] ?? `This ${fields[0]} is already in use.`;
  }
  if (fields.length > 1) {
    return `These values are already in use: ${fields.join(', ')}.`;
  }
  return 'This value is already in use.';
}

export function uniqueConstraintErrors(meta: unknown): Array<{ target: unknown; field?: string }> {
  const target = (meta as { target?: unknown } | undefined)?.target;
  const fields = uniqueConstraintFields(meta);
  return [
    {
      target,
      ...(fields.length === 1 ? { field: fields[0] } : {}),
    },
  ];
}
