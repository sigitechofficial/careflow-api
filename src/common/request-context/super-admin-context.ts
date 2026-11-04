import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Whether the user of the current request is a Super Admin, for checks that only receive a user id
 * (maker / checker in assertDifferentUser). Set by PermissionsGuard once the user is known.
 * Also the hours requests this request sent to Hours approvals (the response lists them).
 */
const storage = new AsyncLocalStorage<{ superAdmin: boolean; hoursRequestIds: string[] }>();

/** Express middleware: every request runs in its own context. */
export function runInRequestContext(_req: unknown, _res: unknown, next: () => void) {
  storage.run({ superAdmin: false, hoursRequestIds: [] }, next);
}

export function markSuperAdminRequest() {
  const store = storage.getStore();
  if (store) store.superAdmin = true;
}

export function isSuperAdminRequest(): boolean {
  return storage.getStore()?.superAdmin === true;
}

/** An hours request sent for manager approval during this request (a manager can approve it at once). */
export function trackHoursRequest(id: string) {
  const store = storage.getStore();
  if (store && !store.hoursRequestIds.includes(id)) store.hoursRequestIds.push(id);
}

export function trackedHoursRequests(): string[] {
  return storage.getStore()?.hoursRequestIds ?? [];
}
