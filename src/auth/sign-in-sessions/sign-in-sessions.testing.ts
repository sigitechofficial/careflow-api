/**
 * Tests only: an in-memory AuthSession table and organisation device limits, enough for SignInSessionsService
 * and endAllSignInSessions. `limits` sets the organisation's settings (office website and Care app).
 */
type Row = {
  id: string;
  kind: string;
  accountId: string;
  refreshTokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
};

export function fakeSignInPrisma(
  limits: Partial<{ officeMultipleDeviceLogin: boolean; officeMaxDevices: number; appSettingSingleDeviceLoginCareApp: boolean; appSettingMaxDevicesCareApp: number }> = {},
) {
  const rows: Row[] = [];
  let tick = 0;
  const matches = (r: Row, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => {
      const value = (r as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('in' in v) return (v.in as unknown[]).includes(value);
        if ('gt' in v) return (value as Date) > v.gt;
      }
      return value === v;
    });
  const settings = { officeMultipleDeviceLogin: true, officeMaxDevices: 0, appSettingSingleDeviceLoginCareApp: false, appSettingMaxDevicesCareApp: 0, ...limits };
  return {
    rows,
    settings,
    organisationGeneralSettings: { findFirst: async () => settings },
    authSession: {
      create: async ({ data }: { data: Partial<Row> }) => {
        // Strictly increasing times, so "oldest" is well defined within one test.
        const at = new Date(Date.now() + ++tick);
        const row = { userAgent: null, ipAddress: null, createdAt: at, lastUsedAt: at, revokedAt: null, revokedReason: null, ...data } as Row;
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
      findMany: async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: { createdAt: 'asc' | 'desc' } }) => {
        const found = rows.filter((r) => matches(r, where));
        if (orderBy?.createdAt) found.sort((a, b) => (orderBy.createdAt === 'desc' ? -1 : 1) * (a.createdAt.getTime() - b.createdAt.getTime()));
        return found;
      },
      count: async ({ where }: { where?: Record<string, unknown> }) => rows.filter((r) => matches(r, where)).length,
      updateMany: async ({ where, data }: { where?: Record<string, unknown>; data: Partial<Row> }) => {
        const found = rows.filter((r) => matches(r, where));
        for (const r of found) Object.assign(r, data);
        return { count: found.length };
      },
    },
  };
}
