import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Whether the user of the current request is a Super Admin, for checks that only receive a user id
 * (maker / checker in assertDifferentUser). Set by PermissionsGuard once the user is known.
 */
const storage = new AsyncLocalStorage<{ superAdmin: boolean }>();

/** Express middleware: every request runs in its own context. */
export function runInRequestContext(_req: unknown, _res: unknown, next: () => void) {
  storage.run({ superAdmin: false }, next);
}

export function markSuperAdminRequest() {
  const store = storage.getStore();
  if (store) store.superAdmin = true;
}

export function isSuperAdminRequest(): boolean {
  return storage.getStore()?.superAdmin === true;
}
