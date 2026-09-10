import { homeAccessMethodLabel } from '../service-user-addresses/home-access.constants';

type AddressLike = {
  addressLine1?: string | null;
  addressLine2?: string | null;
  town?: string | null;
  postcode?: string | null;
  keySafeNumber?: string | null;
  accessInstructions?: string | null;
  accessMethod?: string | null;
  keySafeLocation?: string | null;
  deletedAt?: Date | null;
};

function trimOrNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function formatEmployeeAppAddressLine(addr?: AddressLike | null): string | null {
  if (!addr || addr.deletedAt) return null;
  const line = [addr.addressLine1, addr.addressLine2, addr.town, addr.postcode]
    .map((part) => trimOrNull(part))
    .filter((part): part is string => Boolean(part))
    .join(', ');
  return line || null;
}

export type EmployeeAppKeySafePayload = {
  address: string | null;
  code: string | null;
  accessNote: string | null;
  accessMethod: string | null;
  accessMethodLabel: string | null;
  keySafeLocation: string | null;
};

/** Visit overview `keySafe` — office address fields only, no static copy. */
export function employeeAppKeySafePayload(addr?: AddressLike | null): EmployeeAppKeySafePayload | null {
  if (!addr || addr.deletedAt) return null;
  const address = formatEmployeeAppAddressLine(addr);
  const code = trimOrNull(addr.keySafeNumber);
  const accessNote = trimOrNull(addr.accessInstructions);
  const accessMethod = trimOrNull(addr.accessMethod);
  const accessMethodLabel = homeAccessMethodLabel(accessMethod);
  const keySafeLocation = trimOrNull(addr.keySafeLocation);
  if (!address && !code && !accessNote && !accessMethod && !keySafeLocation) return null;
  return { address, code, accessNote, accessMethod, accessMethodLabel, keySafeLocation };
}

/** Client profile `access` — same office fields, app-facing names. */
export function employeeAppAccessPayload(addr?: AddressLike | null): {
  keySafeCode: string | null;
  note: string | null;
  address: string | null;
  accessMethod: string | null;
  accessMethodLabel: string | null;
  keySafeLocation: string | null;
} | null {
  const keySafe = employeeAppKeySafePayload(addr);
  if (!keySafe) return null;
  return {
    keySafeCode: keySafe.code,
    note: keySafe.accessNote,
    address: keySafe.address,
    accessMethod: keySafe.accessMethod,
    accessMethodLabel: keySafe.accessMethodLabel,
    keySafeLocation: keySafe.keySafeLocation,
  };
}

