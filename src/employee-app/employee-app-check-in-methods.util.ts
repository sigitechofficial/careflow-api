/** Stable order for clock-in sheet pills. */
export const CHECK_IN_METHOD_ORDER = ['GPS', 'NFC', 'QR', 'MANUAL'] as const;

export type EmployeeAppCheckInMethod = (typeof CHECK_IN_METHOD_ORDER)[number];

export type OrgCheckInMethodFlags = {
  domCheckInGpsEnabled?: boolean | null;
  domCheckInManualEnabled?: boolean | null;
  domCheckInNfcEnabled?: boolean | null;
  domCheckInQrEnabled?: boolean | null;
};

/** GPS + Manual default on when flags are missing (legacy row / no settings). */
export function resolveEnabledCheckInMethods(
  settings?: OrgCheckInMethodFlags | null,
): string[] {
  const flags: Record<EmployeeAppCheckInMethod, boolean> = {
    GPS: settings?.domCheckInGpsEnabled !== false,
    NFC: Boolean(settings?.domCheckInNfcEnabled),
    QR: Boolean(settings?.domCheckInQrEnabled),
    MANUAL: settings?.domCheckInManualEnabled !== false,
  };
  return CHECK_IN_METHOD_ORDER.filter((method) => flags[method]);
}

export function normalizeCheckInMethod(raw?: string | null): string {
  const value = (raw ?? 'GPS').trim().toUpperCase();
  return value.length > 0 ? value : 'GPS';
}

export function isCheckInMethodEnabled(
  method: string | null | undefined,
  enabled: string[],
): boolean {
  return enabled.includes(normalizeCheckInMethod(method));
}

export function hasAnyCheckInMethodEnabled(settings: OrgCheckInMethodFlags): boolean {
  return resolveEnabledCheckInMethods(settings).length > 0;
}
