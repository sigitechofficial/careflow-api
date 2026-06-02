import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';

function encryptionKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY?.trim();
  if (raw) {
    const buf = Buffer.from(raw, raw.length >= 44 ? 'base64' : 'utf8');
    if (buf.length >= 32) return buf.subarray(0, 32);
    return createHash('sha256').update(buf).digest();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FIELD_ENCRYPTION_KEY is required in production');
  }
  return createHash('sha256').update('careadmin-dev-field-encryption').digest();
}

export function encryptFieldValue(plain: string): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptFieldValue(stored: string): string {
  if (!isEncryptedFieldValue(stored)) return stored;
  const key = encryptionKey();
  const payload = stored.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted field payload');
  }
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const data = Buffer.from(dataB64, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function isEncryptedFieldValue(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}
