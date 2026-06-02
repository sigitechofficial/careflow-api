/**
 * 1) Remove all medication data for a service user (API + DB orphan cleanup)
 * 2) Re-seed realistic profile via HTTP APIs only (create path)
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/reset-and-seed-realistic-medication-via-api.ts [serviceUserId]
 *   npx ts-node --transpile-only prisma/scripts/reset-and-seed-realistic-medication-via-api.ts --dry-run [serviceUserId]
 *
 * Env: API_BASE_URL, PROBE_EMAIL, PROBE_PASSWORD
 */
import { PrismaClient } from '@prisma/client';

const cliArgs = process.argv.slice(2);
const DRY_RUN = cliArgs.includes('--dry-run');
const SERVICE_USER_ID =
  cliArgs.find((a) => !a.startsWith('--')) ?? 'ea274b6c-9a8a-4bc1-b6c5-27e7c4bd5fdd';

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.PROBE_EMAIL ?? 'admin@careadmin.local';
const PASS = process.env.PROBE_PASSWORD ?? 'Admin@12345';

const prisma = new PrismaClient();

const NEEDS_REASON = new Set(['R', 'N', 'U', 'H', 'A', 'O', 'P', 'PCI']);
const GIVEN_LIKE = new Set(['G', 'F', 'I', 'S', 'T']);

type CarerRef = { id: string; name: string };

/** How this MAR cell was recorded (carer vs admin vs admin-on-behalf). */
type RecordingMode = 'carer' | 'admin_direct' | 'admin_on_behalf';

type RecordedEventRef = {
  eventId: string;
  dateYmd: string;
  medicationName: string;
  statusCode: string;
};

type LookupItem = { id: string; code?: string; name: string };
type ChartCell = { day: number; date: string; cellState?: string; recordId?: string | null };
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

function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function lastDayOfMonth(d = new Date()): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

function todayDayOfMonth(d = new Date()): number {
  return d.getUTCDate();
}

function scheduledIso(dateYmd: string, dueTime: string | null): string {
  const [y, m, day] = dateYmd.split('-').map(Number);
  let hh = 8;
  let mm = 0;
  if (dueTime) {
    const [h, min] = dueTime.split(':').map(Number);
    if (!Number.isNaN(h)) hh = h;
    if (!Number.isNaN(min)) mm = min;
  }
  return new Date(Date.UTC(y, m - 1, day, hh, mm, 0)).toISOString();
}

/** Deterministic pseudo-random 0–1 from strings */
function hash01(...parts: string[]): number {
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function pickStatusCode(dateYmd: string, medName: string, timeSlot: string): string {
  const r = hash01(dateYmd, medName, timeSlot);
  if (r < 0.86) return 'G';
  if (r < 0.9) return 'R';
  if (r < 0.94) return 'N';
  if (r < 0.97) return 'H';
  if (r < 0.985) return 'U';
  return 'O';
}

function pickRecordingMode(dateYmd: string, medName: string, timeSlot: string): RecordingMode {
  const r = hash01('mode', dateYmd, medName, timeSlot);
  if (r < 0.68) return 'carer';
  if (r < 0.82) return 'admin_on_behalf';
  return 'admin_direct';
}

function pickCarer(carers: CarerRef[], dateYmd: string, medName: string, timeSlot: string): CarerRef {
  if (carers.length === 1) return carers[0];
  const idx = Math.floor(hash01('carer', dateYmd, medName, timeSlot) * carers.length);
  return carers[idx]!;
}

const REASONS: Record<string, string[]> = {
  R: ['Declined — felt nauseous', 'Refused after breakfast', 'Asked to take later'],
  N: ['Out on hospital visit', 'Carer off sick — cover missed round', 'Medication not available in blister'],
  U: ['Forgot to document until next shift', 'System offline during round'],
  H: ['BP low this morning — GP advised hold', 'Vomiting — withheld until reviewed'],
  O: ['Given by district nurse — to confirm dose', 'Family administered at visit'],
};

async function api<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, json };
}

async function login(): Promise<string> {
  const { ok, json } = await api<{ data?: { accessToken?: string }; accessToken?: string }>(
    '/auth/login',
    '',
    { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASS }) },
  );
  const token = json.data?.accessToken ?? json.accessToken;
  if (!ok || !token) {
    console.error('Login failed', json);
    process.exit(1);
  }
  return token;
}

async function wipeViaApi(token: string): Promise<number> {
  const { ok, json } = await api<{ data?: { id: string; medicationName: string }[] }>(
    `/service-users/${SERVICE_USER_ID}/medications?limit=100`,
    token,
  );
  if (!ok) {
    console.error('List medications failed', json);
    process.exit(1);
  }
  const rows = Array.isArray(json.data) ? json.data : [];
  let deleted = 0;
  for (const row of rows) {
    if (DRY_RUN) {
      console.log(`  [dry] DELETE med ${row.medicationName}`);
      deleted++;
      continue;
    }
    const del = await api(`/service-users/${SERVICE_USER_ID}/medications/${row.id}`, token, {
      method: 'DELETE',
    });
    if (del.ok) {
      console.log(`  − deleted ${row.medicationName}`);
      deleted++;
    } else {
      console.error(`  ! delete failed ${row.medicationName}`, del.json);
    }
  }
  return deleted;
}

async function loadCarers(): Promise<CarerRef[]> {
  const rows = await prisma.employee.findMany({
    where: { deletedAt: null, isActive: true, personalDetail: { deletedAt: null } },
    include: {
      personalDetail: true,
      employment: { include: { role: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 24,
  });
  const withRole = rows.filter((e) => {
    const role = e.employment?.role?.name?.toLowerCase() ?? '';
    return role.includes('carer') || role.includes('nurse');
  });
  const pool = withRole.length >= 2 ? withRole : rows;
  return pool.slice(0, 4).map((e) => {
    const pd = e.personalDetail!;
    const name = [pd.firstName, pd.lastName].filter(Boolean).join(' ').trim() || 'Carer';
    return { id: e.id, name };
  });
}

async function wipeOrphansDb(): Promise<void> {
  const now = new Date();
  const su = SERVICE_USER_ID;
  const [ev, sch, del, prof, rev, alg] = await Promise.all([
    prisma.medicationAdministrationEvent.updateMany({
      where: { serviceUserId: su, deletedAt: null },
      data: { deletedAt: now, isActive: false },
    }),
    prisma.medicationSchedule.updateMany({
      where: { serviceUserMedication: { serviceUserId: su }, deletedAt: null },
      data: { deletedAt: now, isActive: false },
    }),
    prisma.medicationSupplyDelivery.updateMany({
      where: { serviceUserId: su, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.medicationSupplyProfile.updateMany({
      where: { serviceUserMedication: { serviceUserId: su }, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.medicationReview.updateMany({
      where: { serviceUserId: su, deletedAt: null },
      data: { deletedAt: now, isActive: false },
    }),
    prisma.medicationAllergy.updateMany({
      where: { serviceUserId: su, deletedAt: null },
      data: { deletedAt: now, isActive: false },
    }),
  ]);
  // Support profile: unique per service user — leave active (service restores if archived)
  console.log(
    `  DB cleanup: ${ev.count} events, ${sch.count} schedules, ${del.count} deliveries, ${prof.count} supply profiles, ${rev.count} reviews, ${alg.count} allergies`,
  );
}

type MedPlan = {
  medicationName: string;
  strength: string;
  dose: string;
  medicationKind: 'REGULAR' | 'PRN';
  frequencyCode?: string;
  frequencyText: string;
  instructions: string;
  isControlled?: boolean;
  startDate: string;
  schedules?: { dueTime: string; dose?: string; daysOfWeek?: string[] }[];
  supply?: {
    deliveredAt: string;
    quantity: number;
    pharmacyName: string;
    dosesPerDay?: number;
    cycleDays?: number;
    notes?: string;
    /** Align system entry time with receipt (avoids misleading “entered later” in UI). */
    alignEntryTimestamp?: boolean;
  };
  prnEvents?: { day: number; doseGiven: string; reason: string }[];
};

const MED_PLANS: MedPlan[] = [
  {
    medicationName: 'Amlodipine',
    strength: '5mg',
    dose: '1 tablet',
    medicationKind: 'REGULAR',
    frequencyCode: 'ONCE_DAILY',
    frequencyText: 'Once daily',
    instructions: 'For blood pressure. Check BP before administration if unwell.',
    startDate: '2025-11-01',
    schedules: [{ dueTime: '08:00' }],
    supply: {
      deliveredAt: '2026-05-01',
      quantity: 28,
      pharmacyName: 'Boots Pharmacy — High Street',
      cycleDays: 28,
      notes: 'Monthly blister — checked against prescription chart',
      dosesPerDay: 1,
      alignEntryTimestamp: true,
    },
  },
  {
    medicationName: 'Metformin',
    strength: '500mg',
    dose: '1 tablet',
    medicationKind: 'REGULAR',
    frequencyCode: 'TWICE_DAILY',
    frequencyText: 'Twice daily with meals',
    instructions: 'Take with breakfast and evening meal.',
    startDate: '2025-11-01',
    schedules: [
      { dueTime: '08:00', dose: '1 tablet' },
      { dueTime: '18:00', dose: '1 tablet' },
    ],
    supply: {
      deliveredAt: '2026-05-01',
      quantity: 56,
      pharmacyName: 'Boots Pharmacy — High Street',
      cycleDays: 28,
      notes: '56 tabs — twice daily (May cycle)',
      dosesPerDay: 2,
      alignEntryTimestamp: true,
    },
  },
  {
    medicationName: 'Lansoprazole',
    strength: '15mg',
    dose: '1 capsule',
    medicationKind: 'REGULAR',
    frequencyCode: 'ONCE_DAILY',
    frequencyText: 'Once daily before breakfast',
    instructions: 'Take 30 minutes before food.',
    startDate: '2026-02-01',
    schedules: [{ dueTime: '07:00' }],
    supply: {
      deliveredAt: '2026-05-15',
      quantity: 28,
      pharmacyName: 'Day Lewis Pharmacy',
      cycleDays: 28,
      notes: 'Mid-month top-up — GP repeat prescription',
      dosesPerDay: 1,
      alignEntryTimestamp: true,
    },
  },
  {
    medicationName: 'Furosemide',
    strength: '40mg',
    dose: '1 tablet',
    medicationKind: 'REGULAR',
    frequencyCode: 'WEEKLY',
    frequencyText: 'Monday, Wednesday, Friday',
    instructions: 'Monitor fluid balance. Weigh weekly.',
    startDate: '2025-11-01',
    schedules: [{ dueTime: '08:00', daysOfWeek: ['MONDAY', 'WEDNESDAY', 'FRIDAY'] }],
    supply: {
      deliveredAt: '2026-05-01',
      quantity: 12,
      pharmacyName: 'Boots Pharmacy — High Street',
      cycleDays: 28,
      notes: 'Mon / Wed / Fri pack — 12 tablets',
      dosesPerDay: 3 / 7,
      alignEntryTimestamp: true,
    },
  },
  {
    medicationName: 'Atorvastatin',
    strength: '20mg',
    dose: '1 tablet',
    medicationKind: 'REGULAR',
    frequencyCode: 'ONCE_DAILY',
    frequencyText: 'Once daily at night',
    instructions: 'Take at bedtime.',
    startDate: '2025-11-01',
    schedules: [{ dueTime: '21:00' }],
    supply: {
      deliveredAt: '2026-05-01',
      quantity: 28,
      pharmacyName: 'Boots Pharmacy — High Street',
      cycleDays: 28,
      notes: 'Evening statin — 28-day supply',
      dosesPerDay: 1,
      alignEntryTimestamp: true,
    },
  },
  {
    medicationName: 'Gaviscon Advance',
    strength: '10ml sachet',
    dose: '10–20ml',
    medicationKind: 'PRN',
    frequencyText: 'As required',
    instructions: 'For heartburn or reflux. Max 4 doses in 24 hours.',
    startDate: '2025-11-01',
    prnEvents: [
      { day: 4, doseGiven: '10ml', reason: 'Complained of heartburn after lunch' },
      { day: 12, doseGiven: '15ml', reason: 'Reflux overnight — poor sleep' },
      { day: 22, doseGiven: '10ml', reason: 'Asked for relief after evening meal' },
    ],
  },
];

async function loadLookups(token: string) {
  const { ok, json } = await api<{
    data?: {
      routes?: LookupItem[];
      types?: LookupItem[];
      frequencies?: LookupItem[];
    };
  }>('/medication-lookups', token);
  if (!ok) {
    console.error('Lookups failed', json);
    process.exit(1);
  }
  const data = json.data ?? json;
  const routes = (data as { routes?: LookupItem[] }).routes ?? [];
  const types = (data as { types?: LookupItem[] }).types ?? [];
  const frequencies = (data as { frequencies?: LookupItem[] }).frequencies ?? [];
  const oral =
    routes.find((r) => r.name.toLowerCase().includes('oral')) ?? routes[0];
  const tablet = types.find((t) => t.name.toLowerCase().includes('tablet')) ?? types[0];
  const freqByCode = new Map(frequencies.map((f) => [f.code ?? '', f]));
  return { oral, tablet, freqByCode };
}

async function createMedication(
  token: string,
  plan: MedPlan,
  lookups: Awaited<ReturnType<typeof loadLookups>>,
): Promise<string | null> {
  const body: Record<string, unknown> = {
    medicationName: plan.medicationName,
    strength: plan.strength,
    dose: plan.dose,
    medicationKind: plan.medicationKind,
    frequencyText: plan.frequencyText,
    instructions: plan.instructions,
    startDate: plan.startDate,
    routeId: lookups.oral?.id,
    medicationTypeId: lookups.tablet?.id,
    isControlledMedication: plan.isControlled ?? false,
    status: 'ACTIVE',
  };
  if (plan.frequencyCode) {
    const f = lookups.freqByCode.get(plan.frequencyCode);
    if (f) body.frequencyId = f.id;
  }
  if (plan.schedules?.length) body.schedules = plan.schedules;

  if (DRY_RUN) {
    console.log(`  [dry] POST medication ${plan.medicationName}`);
    return 'dry-run-id';
  }

  const { ok, json } = await api<{ data?: { id: string } }>(
    `/service-users/${SERVICE_USER_ID}/medications`,
    token,
    { method: 'POST', body: JSON.stringify(body) },
  );
  const id = json.data?.id ?? (json as { id?: string }).id;
  if (!ok || !id) {
    console.error(`  ! create ${plan.medicationName}`, json);
    return null;
  }
  console.log(`  + medication ${plan.medicationName} (${id.slice(0, 8)}…)`);
  return id;
}

function cycleEndFromQuantity(
  deliveredAt: string,
  quantity: number,
  dosesPerDay: number,
  fallbackCycleDays = 28,
): string {
  if (dosesPerDay > 0 && quantity > 0) {
    const days = Math.max(1, Math.ceil(quantity / dosesPerDay));
    const end = new Date(`${deliveredAt}T12:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + days - 1);
    return end.toISOString().slice(0, 10);
  }
  const end = new Date(`${deliveredAt}T12:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + fallbackCycleDays - 1);
  return end.toISOString().slice(0, 10);
}

async function createDelivery(
  token: string,
  medId: string,
  supply: NonNullable<MedPlan['supply']>,
): Promise<void> {
  const delivered = supply.deliveredAt;
  const dosesPerDay = supply.dosesPerDay ?? 1;
  const cycleEnd = cycleEndFromQuantity(delivered, supply.quantity, dosesPerDay, supply.cycleDays ?? 28);

  const body = {
    serviceUserMedicationId: medId,
    deliveredAt: delivered,
    quantity: supply.quantity,
    pharmacyName: supply.pharmacyName,
    cycleEndDate: cycleEnd,
    runsOutDate: cycleEnd,
    notes: supply.notes ?? 'Monthly pharmacy delivery',
  };

  if (DRY_RUN) {
    console.log(`  [dry] POST delivery ${delivered} ×${supply.quantity}`);
    return;
  }

  const { ok, json } = await api<{ data?: { id: string } }>(
    `/service-users/${SERVICE_USER_ID}/medication-supply/deliveries`,
    token,
    { method: 'POST', body: JSON.stringify(body) },
  );
  const deliveryId = json.data?.id ?? (json as { id?: string }).id;
  if (!ok || !deliveryId) {
    console.error('  ! delivery failed', json);
    return;
  }

  if (supply.alignEntryTimestamp !== false) {
    const entryAt = new Date(`${delivered}T10:15:00.000Z`);
    await prisma.medicationSupplyDelivery.update({
      where: { id: deliveryId },
      data: { createdAt: entryAt, updatedAt: entryAt },
    });
  }

  console.log(`  + delivery ${delivered} (${supply.pharmacyName})`);
}

async function fetchChart(token: string, month: string): Promise<ChartRow[]> {
  const { ok, json } = await api<{ data?: { medications?: ChartRow[] } }>(
    `/service-users/${SERVICE_USER_ID}/medication-chart/regular?month=${month}`,
    token,
  );
  if (!ok) {
    console.error('Chart failed', json);
    return [];
  }
  return json.data?.medications ?? [];
}

async function fetchSchedules(token: string, medId: string) {
  const { ok, json } = await api<{ data?: { id: string; roundId?: string }[] }>(
    `/service-users/${SERVICE_USER_ID}/medications/${medId}/schedules`,
    token,
  );
  if (!ok) return [];
  const data = json.data ?? json;
  return Array.isArray(data) ? data : [];
}

function buildEventBody(
  row: ChartRow,
  day: ChartCell,
  statusCode: string,
  carers: CarerRef[],
  roundId?: string,
): Record<string, unknown> {
  const scheduled = scheduledIso(day.date, row.dueTime);
  const actual = new Date(scheduled);
  actual.setUTCMinutes(actual.getUTCMinutes() + 7 + Math.floor(hash01(day.date, row.medicationId) * 20));

  const mode = pickRecordingMode(day.date, row.medicationName, row.timeSlot);
  const carer = pickCarer(carers, day.date, row.medicationName, row.timeSlot);

  const body: Record<string, unknown> = {
    serviceUserMedicationId: row.medicationId,
    medicationScheduleId: row.scheduleId,
    scheduledDateTime: scheduled,
    statusCode,
  };
  if (roundId) body.roundId = roundId;

  if (mode === 'carer') {
    body.administeredById = carer.id;
    body.notes = `Recorded by ${carer.name} on round`;
  } else if (mode === 'admin_on_behalf') {
    body.administeredById = carer.id;
    body.recordOnBehalfOfCarer = true;
    body.notes = `Office entry on behalf of ${carer.name} — carer confirmed verbally`;
  } else {
    body.notes = 'Recorded by care coordinator (admin) during medication audit';
  }

  if (GIVEN_LIKE.has(statusCode)) {
    body.actualDateTime = actual.toISOString();
    body.doseGiven = row.dose ?? '1 tablet';
  } else if (NEEDS_REASON.has(statusCode)) {
    body.actualDateTime = actual.toISOString();
    const pool = REASONS[statusCode] ?? REASONS.N;
    body.reason = pool[Math.floor(hash01(day.date, statusCode) * pool.length)];
  }
  return body;
}

async function seedMarForMonth(
  token: string,
  month: string,
  maxDay: number,
  carers: CarerRef[],
): Promise<{ created: number; correctionCandidates: RecordedEventRef[] }> {
  const rows = (await fetchChart(token, month)).filter(
    (r) => r.scheduleId && r.scheduleType !== 'prn',
  );
  let created = 0;
  const correctionCandidates: RecordedEventRef[] = [];

  for (const row of rows) {
    const schedules = await fetchSchedules(token, row.medicationId);
    const schedule = schedules.find((s) => s.id === row.scheduleId);
    const roundId = schedule?.roundId ?? undefined;

    for (const day of row.days) {
      if (day.day < 1 || day.day > maxDay) continue;
      if (day.cellState === 'recorded' || day.recordId) continue;
      if (day.cellState === 'na' || day.cellState === 'not_applicable') continue;
      if (day.cellState === 'due' && day.day === maxDay && hash01(day.date, 'today') > 0.35) {
        continue;
      }

      const statusCode = pickStatusCode(day.date, row.medicationName, row.timeSlot);
      const body = buildEventBody(row, day, statusCode, carers, roundId);

      if (DRY_RUN) {
        created++;
        continue;
      }

      const res = await api<{ data?: { id: string; statusCode?: string } }>(
        `/service-users/${SERVICE_USER_ID}/medication-events`,
        token,
        { method: 'POST', body: JSON.stringify(body) },
      );
      if (res.ok) {
        created++;
        const eventId = res.json.data?.id ?? (res.json as { id?: string }).id;
        if (eventId && correctionCandidates.length < 40) {
          correctionCandidates.push({
            eventId,
            dateYmd: day.date,
            medicationName: row.medicationName,
            statusCode,
          });
        }
      }
    }
  }
  return { created, correctionCandidates };
}

/** Admin corrections (PATCH) — status overridden with audit reason. */
async function applyAdminCorrections(
  token: string,
  candidates: RecordedEventRef[],
): Promise<number> {
  const picks = candidates
    .filter((c) => c.statusCode === 'G' || c.statusCode === 'R' || c.statusCode === 'N')
    .filter((c) => hash01('correct', c.eventId) < 0.22)
    .slice(0, 12);

  const corrections: {
    from: string;
    to: string;
    reason: string;
    correctionNotes: string;
  }[] = [
    {
      from: 'G',
      to: 'R',
      reason: 'Service user declined after tasting — documented on paper round sheet',
      correctionNotes:
        'Manager reviewed paper MAR; original Given entry was incorrect. Updated to Refused with reason.',
    },
    {
      from: 'G',
      to: 'N',
      reason: 'Carer called in sick — morning round not completed',
      correctionNotes: 'Admin correction: visit missed; status changed from Given to Not Given.',
    },
    {
      from: 'R',
      to: 'G',
      reason: 'Service user agreed to take medication after discussion with nurse',
      correctionNotes:
        'Admin override: refusal overturned after clinical review — given 20 minutes later.',
    },
    {
      from: 'N',
      to: 'G',
      reason: 'Late administration documented on handover — given at 09:45',
      correctionNotes: 'Admin correction: dose was given but logged as missed in error.',
    },
    {
      from: 'G',
      to: 'U',
      reason: 'Blister pack for this slot was empty — pharmacy contacted',
      correctionNotes: 'Admin override: unavailable stock; corrected from Given after stock check.',
    },
  ];

  let corrected = 0;
  for (const ev of picks) {
    const matching = corrections.filter((c) => c.from === ev.statusCode);
    if (!matching.length) continue;
    const template = matching[Math.floor(hash01(ev.eventId, 'tpl') * matching.length)]!;

    const body = {
      statusCode: template.to,
      reason: template.reason,
      correctionReason: 'Manager / admin correction',
      correctionNotes: template.correctionNotes,
      notes: `Corrected by admin (${new Date().toISOString().slice(0, 10)})`,
    };

    if (DRY_RUN) {
      console.log(`  [dry] PATCH correct ${ev.medicationName} ${ev.dateYmd} ${template.from}→${template.to}`);
      corrected++;
      continue;
    }

    const res = await api(
      `/service-users/${SERVICE_USER_ID}/medication-events/${ev.eventId}`,
      token,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
    if (res.ok) {
      corrected++;
      console.log(
        `  ↻ corrected ${ev.medicationName} (${ev.dateYmd}) ${template.from} → ${template.to}`,
      );
    } else {
      console.error(`  ! correction failed ${ev.eventId}`, res.json);
    }
  }
  return corrected;
}

async function seedPrnEvents(
  token: string,
  medId: string,
  plan: MedPlan,
  month: string,
  carers: CarerRef[],
): Promise<void> {
  if (!plan.prnEvents?.length) return;
  const [y, m] = month.split('-').map(Number);
  for (const ev of plan.prnEvents) {
    const scheduled = new Date(Date.UTC(y, m - 1, ev.day, 14, 30, 0)).toISOString();
    const carer = pickCarer(carers, `prn-${ev.day}`, plan.medicationName, 'prn');
    const onBehalf = hash01('prn-mode', String(ev.day)) < 0.33;
    const body: Record<string, unknown> = {
      serviceUserMedicationId: medId,
      isPrn: true,
      statusCode: 'G',
      scheduledDateTime: scheduled,
      actualDateTime: scheduled,
      doseGiven: ev.doseGiven,
      prnReason: ev.reason,
      administeredById: carer.id,
      notes: onBehalf
        ? `PRN — admin recorded on behalf of ${carer.name}`
        : `PRN — administered by ${carer.name}`,
    };
    if (onBehalf) body.recordOnBehalfOfCarer = true;
    if (DRY_RUN) {
      console.log(`  [dry] PRN day ${ev.day}`);
      continue;
    }
    const res = await api(
      `/service-users/${SERVICE_USER_ID}/medication-events`,
      token,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (res.ok) console.log(`  + PRN ${plan.medicationName} day ${ev.day}`);
    else console.error('  ! PRN failed', res.json);
  }
}

async function main() {
  const month = monthKey();
  const maxDay = todayDayOfMonth();
  console.log('══ Medication reset + realistic API seed ══');
  console.log('Service user:', SERVICE_USER_ID);
  console.log('Month:', month, `· recording days 1–${maxDay} only`);
  if (DRY_RUN) console.log('DRY RUN\n');

  const token = await login();
  console.log('Login OK\n');

  console.log('Phase 1 — Remove existing medication data');
  const medCount = await wipeViaApi(token);
  console.log(`  API: ${medCount} medication(s) deleted`);
  if (!DRY_RUN) await wipeOrphansDb();
  console.log('');

  console.log('Phase 2 — Lookups + carers');
  const lookups = await loadLookups(token);
  const carers = await loadCarers();
  if (carers.length === 0) {
    console.error('No active employees found for administeredById — seed at least one carer employee.');
    process.exit(1);
  }
  console.log(`  Route: ${lookups.oral?.name}, Type: ${lookups.tablet?.name}`);
  console.log(`  Carers: ${carers.map((c) => c.name).join(', ')}\n`);

  console.log('Phase 3 — Create medications + schedules (POST /medications)');
  const medIds = new Map<string, string>();
  for (const plan of MED_PLANS) {
    const id = await createMedication(token, plan, lookups);
    if (id) medIds.set(plan.medicationName, id);
  }
  console.log('');

  console.log('Phase 4 — Log supply deliveries (POST /medication-supply/deliveries)');
  for (const plan of MED_PLANS) {
    const id = medIds.get(plan.medicationName);
    if (id && plan.supply) await createDelivery(token, id, plan.supply);
  }
  console.log('');

  console.log('Phase 5 — MAR administration (POST /medication-events)');
  console.log('  Mix: ~68% carer · ~14% admin on behalf · ~18% admin direct · reasons on exceptions');
  const { created: marCount, correctionCandidates } = await seedMarForMonth(
    token,
    month,
    maxDay,
    carers,
  );
  console.log(`  Regular MAR cells recorded: ${marCount}`);
  for (const plan of MED_PLANS) {
    const id = medIds.get(plan.medicationName);
    if (id && plan.medicationKind === 'PRN') {
      await seedPrnEvents(token, id, plan, month, carers);
    }
  }

  console.log('\nPhase 6 — Admin corrections (PATCH /medication-events/:id)');
  const corrected = await applyAdminCorrections(token, correctionCandidates);
  console.log(`  Admin overrides applied: ${corrected}`);

  console.log('\nDone.');
  console.log(
    `View: http://localhost:5173/service-users/${SERVICE_USER_ID}/medication?view=calendar`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
