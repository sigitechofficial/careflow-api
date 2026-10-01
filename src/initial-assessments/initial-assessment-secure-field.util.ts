import { Prisma } from '@prisma/client';
import {
  decryptFieldValue,
  encryptFieldValue,
  isEncryptedFieldValue,
} from '../common/utils/field-encryption.util';

/** §3.5 "Door entry code" — the single IA home for the key-safe / door code (synced with DOM Care). */
export const IA_DOOR_CODE_FIELD_KEY = 'doorCode';

export function isSecureQuestionMetadata(metadata: Prisma.JsonValue | null | undefined): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  return (metadata as Record<string, unknown>).secureField === true;
}

export function hasStoredSecureValue(textValue: string | null | undefined): boolean {
  return Boolean(textValue?.trim());
}

export function encryptSecureText(plain: string | null | undefined): string | null {
  const trimmed = plain?.trim();
  if (!trimmed) return null;
  if (isEncryptedFieldValue(trimmed)) return trimmed;
  return encryptFieldValue(trimmed);
}

export function decryptSecureText(stored: string | null | undefined): string | null {
  if (stored == null || !stored.trim()) return null;
  if (!isEncryptedFieldValue(stored)) return stored;
  return decryptFieldValue(stored);
}

export function maskSecureAnswer(textValue: string | null | undefined) {
  return {
    textValue: null as string | null,
    secureMasked: true,
    hasSecureValue: hasStoredSecureValue(textValue),
  };
}
