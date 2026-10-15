/** NFC chip UIDs are 4, 7 or 10 bytes (8, 14 or 20 hex characters). */
const VALID_UID_HEX_LENGTHS = new Set([8, 14, 20]);

/**
 * Normalises a scanned/typed NFC UID to upper-case hex with no separators.
 * Accepts `04:a2:3b:1c:5d:80:00`, `04 A2 3B…`, `04-A2-…` or `04a23b1c5d8000`.
 * Returns null when the value is not a valid 4/7/10-byte hex UID.
 */
export function normalizeNfcTagUid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hex = raw.replace(/[\s:\-]/g, '').toUpperCase();
  if (!/^[0-9A-F]+$/.test(hex)) return null;
  if (!VALID_UID_HEX_LENGTHS.has(hex.length)) return null;
  return hex;
}

/** `04A23B1C5D8000` → `04:A2:3B:1C:5D:80:00` for display. */
export function formatNfcTagUid(uid: string): string {
  return uid.match(/.{1,2}/g)?.join(':') ?? uid;
}

export const NFC_TAG_STATUSES = ['ACTIVE', 'LOST', 'RETIRED'] as const;
export type NfcTagStatus = (typeof NFC_TAG_STATUSES)[number];
