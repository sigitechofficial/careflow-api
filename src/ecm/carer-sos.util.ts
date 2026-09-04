export type CarerSosContext = {
  employeeId: string;
  employeeName: string;
  message: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  isMockedLocation: boolean;
  locationUnavailable: boolean;
  idempotencyKey: string | null;
  deviceRecordedAt: string | null;
};

export type CarerSosAlertDto = {
  id: string;
  createdAt: string;
  lifecycle: string;
  title: string;
  message: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  locationUnavailable: boolean;
  isMockedLocation: boolean;
  employeeId: string;
  employeeName: string;
  acknowledgedAt: string | null;
  acknowledgedById: string | null;
  acknowledgedByName: string | null;
};

export function displayUserName(user: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
} | null | undefined): string | null {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  return name || user?.email?.trim() || null;
}

export function parseCarerSosContext(raw: unknown): Partial<CarerSosContext> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Partial<CarerSosContext>;
}

export function mapCarerSosAlert(
  row: {
    id: string;
    title: string;
    detail: string | null;
    lifecycle: string;
    createdAt: Date;
    context: unknown;
    acknowledgedAt?: Date | null;
    acknowledgedById?: string | null;
  },
  names?: { acknowledgedByName?: string | null },
): CarerSosAlertDto {
  const ctx = parseCarerSosContext(row.context);
  const message =
    (typeof ctx.message === 'string' && ctx.message.trim()) ||
    (row.detail && row.detail !== 'No message' ? row.detail : null);
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    lifecycle: row.lifecycle,
    title: row.title,
    message,
    latitude: typeof ctx.latitude === 'number' ? ctx.latitude : null,
    longitude: typeof ctx.longitude === 'number' ? ctx.longitude : null,
    accuracyMeters: typeof ctx.accuracyMeters === 'number' ? ctx.accuracyMeters : null,
    locationUnavailable: Boolean(ctx.locationUnavailable),
    isMockedLocation: Boolean(ctx.isMockedLocation),
    employeeId: typeof ctx.employeeId === 'string' ? ctx.employeeId : '',
    employeeName: typeof ctx.employeeName === 'string' ? ctx.employeeName : '',
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    acknowledgedById: row.acknowledgedById ?? null,
    acknowledgedByName: names?.acknowledgedByName ?? null,
  };
}
