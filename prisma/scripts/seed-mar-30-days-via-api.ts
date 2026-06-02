/**
 * Record 30 days of MAR cells via HTTP APIs (POST medication-events).
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/seed-mar-30-days-via-api.ts [serviceUserId]
 *   npx ts-node --transpile-only prisma/scripts/seed-mar-30-days-via-api.ts --dry-run [serviceUserId]
 *   npx ts-node --transpile-only prisma/scripts/seed-mar-30-days-via-api.ts --month=2026-05 [serviceUserId]
 *   npx ts-node --transpile-only prisma/scripts/seed-mar-30-days-via-api.ts --time-slot=Evening [serviceUserId]
 *
 * Env: API_BASE_URL, PROBE_EMAIL, PROBE_PASSWORD
 */
const cliArgs = process.argv.slice(2);
const DRY_RUN = cliArgs.includes('--dry-run');
const monthArg = cliArgs.find((a) => a.startsWith('--month='))?.slice('--month='.length);
const timeSlotArg = cliArgs.find((a) => a.startsWith('--time-slot='))?.slice('--time-slot='.length);
const SERVICE_USER_ID =
  cliArgs.find((a) => !a.startsWith('--')) ?? 'ea274b6c-9a8a-4bc1-b6c5-27e7c4bd5fdd';

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.PROBE_EMAIL ?? 'admin@careadmin.local';
const PASS = process.env.PROBE_PASSWORD ?? 'Admin@12345';

/** Recordable MAR codes — one per calendar day for 30 days (cycles). */
const STATUS_CODES_30 = [
  'G',
  'R',
  'N',
  'U',
  'H',
  'A',
  'C',
  'F',
  'I',
  'S',
  'T',
  'O',
  'P',
  'PCI',
] as const;

const NEEDS_REASON = new Set(['R', 'N', 'U', 'H', 'A', 'O', 'P', 'PCI']);
const GIVEN_LIKE = new Set(['G', 'F', 'I', 'S', 'T']);

type ChartCell = {
  day: number;
  date: string;
  cellState?: string;
  recordId?: string | null;
};

type ChartRow = {
  medicationId: string;
  scheduleId: string | null;
  medicationName: string;
  dose?: string | null;
  scheduleType: string;
  timeSlot: string;
  dueTime: string | null;
  days: ChartCell[];
};

type ScheduleDto = { id: string; roundId?: string | null; dueTime?: string | null };

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function scheduledIso(dateYmd: string, dueTime: string | null): string {
  const [y, m, d] = dateYmd.split('-').map(Number);
  let hh = 8;
  let mm = 0;
  if (dueTime) {
    const [h, min] = dueTime.split(':').map(Number);
    if (!Number.isNaN(h)) hh = h;
    if (!Number.isNaN(min)) mm = min;
  }
  return new Date(Date.UTC(y, m - 1, d, hh, 0, 0)).toISOString();
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const json = await res.json();
  const token = json.data?.accessToken ?? json.accessToken;
  if (!res.ok || !token) {
    console.error('Login failed', res.status, json);
    process.exit(1);
  }
  return token;
}

async function fetchChart(token: string, month: string): Promise<ChartRow[]> {
  const url = `${BASE}/service-users/${SERVICE_USER_ID}/medication-chart/regular?month=${month}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (!res.ok) {
    console.error('Chart failed', res.status, json);
    process.exit(1);
  }
  const data = json.data ?? json;
  return (data.medications ?? []) as ChartRow[];
}

async function fetchSchedules(
  token: string,
  medicationId: string,
): Promise<ScheduleDto[]> {
  const url = `${BASE}/service-users/${SERVICE_USER_ID}/medications/${medicationId}/schedules`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (!res.ok) {
    console.error('Schedules failed', res.status, json);
    return [];
  }
  const data = json.data ?? json;
  return Array.isArray(data) ? data : [];
}

function pickTargetRow(rows: ChartRow[]): ChartRow | null {
  const candidates = rows.filter(
    (r) => r.scheduleId && r.scheduleType !== 'prn' && r.days?.length > 0,
  );
  const slotNeedle = timeSlotArg?.toLowerCase();
  if (slotNeedle) {
    const bySlot = candidates.find(
      (r) =>
        r.medicationName.toLowerCase().includes('atorvastatin') &&
        r.timeSlot.toLowerCase().includes(slotNeedle),
    );
    if (bySlot) return bySlot;
  }
  const atorMorning = candidates.find(
    (r) =>
      r.medicationName.toLowerCase().includes('atorvastatin') &&
      r.timeSlot.toLowerCase().includes('morning'),
  );
  if (atorMorning && !slotNeedle) return atorMorning;
  const morning = candidates.find((r) => r.timeSlot.toLowerCase().includes('morning'));
  return morning ?? candidates[0] ?? null;
}

function buildPayload(
  row: ChartRow,
  day: ChartCell,
  statusCode: string,
  roundId: string | undefined,
): Record<string, unknown> {
  const scheduled = scheduledIso(day.date, row.dueTime);
  const actual = new Date(scheduled);
  actual.setUTCMinutes(actual.getUTCMinutes() + 5);

  const body: Record<string, unknown> = {
    serviceUserMedicationId: row.medicationId,
    medicationScheduleId: row.scheduleId,
    scheduledDateTime: scheduled,
    statusCode,
  };
  if (roundId) body.roundId = roundId;

  if (GIVEN_LIKE.has(statusCode)) {
    body.actualDateTime = actual.toISOString();
    body.doseGiven = row.dose ?? '1 tablet';
  } else if (NEEDS_REASON.has(statusCode)) {
    body.actualDateTime = actual.toISOString();
    body.reason = `API seed — demo status ${statusCode}`;
  }

  return body;
}

async function createEvent(
  token: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(`${BASE}/service-users/${SERVICE_USER_ID}/medication-events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function main() {
  const month = monthArg ?? currentMonthKey();
  console.log('API base:', BASE);
  console.log('Service user:', SERVICE_USER_ID);
  console.log('Month:', month);
  if (DRY_RUN) console.log('DRY RUN — no POSTs');

  const token = await login();
  console.log('Login OK');

  const rows = await fetchChart(token, month);
  const row = pickTargetRow(rows);
  if (!row?.scheduleId) {
    console.error('No chart row with scheduleId. Run seed-mar-calendar-demo.ts first.');
    process.exit(1);
  }

  const schedules = await fetchSchedules(token, row.medicationId);
  const schedule = schedules.find((s) => s.id === row.scheduleId);
  const roundId = schedule?.roundId ?? undefined;

  console.log(`Target: ${row.medicationName} · ${row.timeSlot} · schedule ${row.scheduleId}`);

  const daysToFill = row.days
    .filter((d) => d.day >= 1 && d.day <= 30)
    .sort((a, b) => a.day - b.day);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const day of daysToFill) {
    const statusCode = STATUS_CODES_30[(day.day - 1) % STATUS_CODES_30.length];
    if (day.cellState === 'recorded' || day.recordId) {
      skipped++;
      continue;
    }
    if (day.cellState === 'na' || day.cellState === 'not_applicable') {
      skipped++;
      continue;
    }

    const body = buildPayload(row, day, statusCode, roundId);
    if (DRY_RUN) {
      console.log(`  [dry] day ${day.day} ${day.date} → ${statusCode}`);
      created++;
      continue;
    }

    const result = await createEvent(token, body);
    if (result.ok) {
      created++;
      console.log(`  + day ${day.day} ${day.date} → ${statusCode}`);
    } else {
      failed++;
      const msg =
        (result.json as { message?: string })?.message ??
        JSON.stringify(result.json).slice(0, 200);
      console.error(`  ! day ${day.day} ${statusCode} HTTP ${result.status}: ${msg}`);
    }
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped (already recorded / N/A), ${failed} failed`);
  console.log(
    `Calendar: http://localhost:5173/service-users/${SERVICE_USER_ID}/medication?view=calendar`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
