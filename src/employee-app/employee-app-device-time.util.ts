const MINUTE_MS = 60_000;

/** A phone clock this far ahead of the server is treated as wrong. */
export const DEVICE_TIME_MAX_FUTURE_MS = 2 * MINUTE_MS;

/** A phone time older than this is not trusted (the phone stayed offline too long). */
export const DEVICE_TIME_MAX_AGE_MS = 24 * 60 * MINUTE_MS;

/** A clock-in/out that reaches the server later than this is shown as "Synced late". */
export const SYNCED_LATE_THRESHOLD_MS = 5 * MINUTE_MS;

/**
 * When a clock-in or clock-out really happened. The carer app works offline and sends
 * the time on the phone; the server may only receive it hours later. Use the phone's
 * time so the visit is not recorded as starting when it synced — unless that time is
 * in the future or too old to trust, then fall back to when the server received it.
 */
export function resolveDeviceEventTime(
  deviceTime: string | Date | null | undefined,
  receivedAt: Date,
): { at: Date; source: 'device' | 'server' } {
  const device = deviceTime instanceof Date ? deviceTime : deviceTime ? new Date(deviceTime) : null;
  if (!device || Number.isNaN(device.getTime())) return { at: receivedAt, source: 'server' };

  const aheadMs = device.getTime() - receivedAt.getTime();
  if (aheadMs > DEVICE_TIME_MAX_FUTURE_MS) return { at: receivedAt, source: 'server' };
  // A few seconds ahead is clock drift: never store a time after the server's own.
  if (aheadMs > 0) return { at: receivedAt, source: 'device' };
  if (-aheadMs > DEVICE_TIME_MAX_AGE_MS) return { at: receivedAt, source: 'server' };
  return { at: device, source: 'device' };
}

/** True when the server received the event well after it happened on the phone. */
export function isSyncedLate(
  occurredAt: Date | null | undefined,
  receivedAt: Date | null | undefined,
): boolean {
  if (!occurredAt || !receivedAt) return false;
  return receivedAt.getTime() - occurredAt.getTime() > SYNCED_LATE_THRESHOLD_MS;
}
