import type { Prisma } from '@prisma/client';

/**
 * Credential columns (and credential derivatives) that must never leave the API.
 *
 * - `passwordHash` / `refreshTokenHash`: identity.User, EmployeePortalAccount,
 *   ServiceUserPortalAccount, TemporaryInspector
 * - `tokenHash`: PasswordResetToken
 * - `gatewayTestPasswordEnc` / `gatewayLivePasswordEnc`: PayrollEmployerSettings (HMRC Gateway)
 *
 * Add a column here whenever the schema gains another one like these.
 * `secret-fields.spec.ts` fails if a column in the Prisma schema looks like a secret but isn't covered.
 */
export const SECRET_FIELD_NAMES: ReadonlySet<string> = new Set([
  'passwordHash',
  'refreshTokenHash',
  'tokenHash',
  'gatewayTestPasswordEnc',
  'gatewayLivePasswordEnc',
]);

/** Catches renamed or prefixed variants too, e.g. `portalPasswordHash` or `apiSecretHash`. */
const SECRET_FIELD_SUFFIX = /(passwordhash|refreshtokenhash|passwordenc|secrethash|secretenc|apikeyhash|apikeyenc)$/i;

export function isSecretFieldName(key: string): boolean {
  return SECRET_FIELD_NAMES.has(key) || SECRET_FIELD_SUFFIX.test(key);
}

/**
 * The fields of a User that a response may show for "who did this" (entered by, reviewed by...).
 * Use it as `createdBy: { select: USER_DISPLAY_SELECT }`. Never use `createdBy: true`,
 * which returns the whole row, password hash included.
 */
export const USER_DISPLAY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} as const satisfies Prisma.UserSelect;

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Should the walker go into this object? Plain objects and arrays, yes. So are class instances
 * with no `toJSON`: JSON.stringify writes their own enumerable fields, so a secret on them would
 * reach the wire. Values that serialise themselves (Date, Prisma.Decimal, Buffer, typed arrays)
 * and Map/Set (which stringify to `{}`) are left as they are.
 */
function shouldWalk(value: object): boolean {
  if (Array.isArray(value)) return true;
  if (isPlainObject(value)) return true;
  if (ArrayBuffer.isView(value) || value instanceof Date || value instanceof Map || value instanceof Set) return false;
  return typeof (value as { toJSON?: unknown }).toJSON !== 'function';
}

function strip(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (!shouldWalk(value)) return value;
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    // Store the input first so a cycle points at it. If an item changes, the entry is replaced below.
    seen.set(value, value);
    let out: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const next = strip(value[i], seen);
      if (next !== value[i]) {
        out ??= value.slice();
        out[i] = next;
      }
    }
    const result = out ?? value;
    seen.set(value, result);
    return result;
  }

  seen.set(value, value);
  const source = value as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const key of Object.keys(source)) {
    if (isSecretFieldName(key)) {
      out ??= { ...source };
      delete out[key];
      continue;
    }
    const current = source[key];
    const next = strip(current, seen);
    if (next !== current) {
      out ??= { ...source };
      out[key] = next;
    }
  }
  const result = out ?? value;
  seen.set(value, result);
  return result;
}

/**
 * Returns `value` with every secret field (see {@link isSecretFieldName}) removed at any depth.
 * Copy-on-write: input objects are never changed, and subtrees with no secret keep their identity,
 * so clean responses don't allocate anything. This is the last safety net. Queries should still
 * use a narrow `select` on User relations.
 */
export function stripSecretFields<T>(value: T): T {
  return strip(value, new WeakMap()) as T;
}
