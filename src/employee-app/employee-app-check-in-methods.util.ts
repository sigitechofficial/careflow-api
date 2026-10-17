import { isAuthorisedManualGrantActive } from '../ecm/visit-check-in-method-grant.util';

/** Stable order for clock-in sheet pills. */
export const CHECK_IN_METHOD_ORDER = ['GPS', 'NFC', 'QR', 'MANUAL'] as const;

export type EmployeeAppCheckInMethod = (typeof CHECK_IN_METHOD_ORDER)[number];

export type OrgCheckInMethodFlags = {
  domCheckInGpsEnabled?: boolean | null;
  domCheckInManualEnabled?: boolean | null;
  domCheckInNfcEnabled?: boolean | null;
  domCheckInQrEnabled?: boolean | null;
};

/**
 * Per-visit context. `nfcTagAvailable: false` means the visit's client has no
 * ACTIVE NFC tag, so NFC cannot work there even when the org has it switched on.
 * Leave it undefined to judge by org settings alone.
 */
export type CheckInMethodVisitContext = { nfcTagAvailable?: boolean };

/** GPS only when flags are missing. Manual / NFC / QR are opt-in. */
export function resolveEnabledCheckInMethods(
  settings?: OrgCheckInMethodFlags | null,
  visit?: CheckInMethodVisitContext,
): string[] {
  const flags: Record<EmployeeAppCheckInMethod, boolean> = {
    GPS: settings?.domCheckInGpsEnabled !== false,
    NFC: Boolean(settings?.domCheckInNfcEnabled) && visit?.nfcTagAvailable !== false,
    QR: Boolean(settings?.domCheckInQrEnabled),
    MANUAL: Boolean(settings?.domCheckInManualEnabled),
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

/**
 * Manual / NFC / QR are org opt-in. When any is usable, carer should use that —
 * not Request office. NFC only counts where the client has an active tag.
 */
export function orgHasOptInCheckInMethod(
  settings?: OrgCheckInMethodFlags | null,
  visit?: CheckInMethodVisitContext,
): boolean {
  return Boolean(
    settings?.domCheckInManualEnabled ||
      (settings?.domCheckInNfcEnabled && visit?.nfcTagAvailable !== false) ||
      settings?.domCheckInQrEnabled,
  );
}

export function mergeEnabledMethodsWithGrant(
  enabled: string[],
  grant:
    | { status: string; expiresAt: Date | string; consumedAt?: Date | string | null }
    | null
    | undefined,
  now = new Date(),
): string[] {
  if (!isAuthorisedManualGrantActive(grant, now)) return enabled;
  const set = new Set(enabled);
  set.add('MANUAL');
  return CHECK_IN_METHOD_ORDER.filter((method) => set.has(method));
}
