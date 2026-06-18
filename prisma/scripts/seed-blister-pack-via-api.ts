/**
 * Create a published blister pack with all 5 administration rounds and linked medicines.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/seed-blister-pack-via-api.ts [serviceUserId]
 *
 * Env: API_BASE_URL, PROBE_EMAIL, PROBE_PASSWORD
 */
import { PrismaClient } from '@prisma/client';

const cliArgs = process.argv.slice(2);
const SERVICE_USER_ID =
  cliArgs.find((a) => /^[0-9a-f-]{36}$/i.test(a)) ?? 'b6d36682-8e17-4aeb-9c3f-282ecaa3d8e8';

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.PROBE_EMAIL ?? 'admin@careadmin.local';
const PASS = process.env.PROBE_PASSWORD ?? 'Admin@12345';

const prisma = new PrismaClient();

const ADMINISTRATION_ROUNDS = [
  { code: 'MORNING', name: 'Morning', time: '08:00', windowStart: '07:00', windowEnd: '10:00' },
  { code: 'MIDDAY', name: 'Midday', time: '12:00', windowStart: '11:00', windowEnd: '14:00' },
  { code: 'AFTERNOON', name: 'Afternoon', time: '15:00', windowStart: '14:00', windowEnd: '17:00' },
  { code: 'EVENING', name: 'Evening', time: '18:00', windowStart: '17:00', windowEnd: '20:00' },
  { code: 'NIGHT', name: 'Night', time: '22:00', windowStart: '20:00', windowEnd: '23:59' },
] as const;

type LookupItem = { id: string; code?: string; name: string };

type MedRow = {
  id: string;
  medicationName: string;
  medicationKind?: string;
  isControlledMedication?: boolean;
  medicationPackId?: string | null;
  schedules?: { dueTime: string | null }[];
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

async function loadLookups(token: string) {
  const { ok, json } = await api<{
    data?: { routes?: LookupItem[]; types?: LookupItem[]; frequencies?: LookupItem[] };
  }>('/medication-lookups', token);
  if (!ok) {
    console.error('Lookups failed', json);
    process.exit(1);
  }
  const data = json.data ?? json;
  const routes = (data as { routes?: LookupItem[] }).routes ?? [];
  const types = (data as { types?: LookupItem[] }).types ?? [];
  const frequencies = (data as { frequencies?: LookupItem[] }).frequencies ?? [];
  const oral = routes.find((r) => r.name.toLowerCase().includes('oral')) ?? routes[0];
  const tablet = types.find((t) => t.name.toLowerCase().includes('tablet')) ?? types[0];
  const capsule = types.find((t) => t.name.toLowerCase().includes('capsule')) ?? tablet;
  const freqByCode = new Map(frequencies.map((f) => [f.code ?? '', f]));
  return { oral, tablet, capsule, freqByCode };
}

function cycleEnd(startDate: string, days: number): string {
  const d = new Date(`${startDate}T12:00:00`);
  d.setDate(d.getDate() + days - 1);
  return d.toISOString().slice(0, 10);
}

function dosesPerDay(times: string[]): number {
  return times.length;
}

async function ensureSchedule(
  token: string,
  medId: string,
  dueTime: string,
  startDate: string,
): Promise<void> {
  const { ok, json } = await api<{ data?: { id: string } }>(
    `/service-users/${SERVICE_USER_ID}/medications/${medId}/schedules`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ dueTime, startDate, frequencyText: 'As prescribed' }),
    },
  );
  if (!ok) {
    console.error(`  ! schedule ${dueTime} for ${medId}`, json);
    process.exit(1);
  }
  console.log(`  + schedule ${dueTime} on ${medId.slice(0, 8)}…`);
}

async function createMedication(
  token: string,
  plan: {
    medicationName: string;
    strength: string;
    dose: string;
    frequencyCode?: string;
    frequencyText: string;
    instructions: string;
    startDate: string;
    schedules: string[];
    type?: 'tablet' | 'capsule';
  },
  lookups: Awaited<ReturnType<typeof loadLookups>>,
): Promise<string> {
  const body: Record<string, unknown> = {
    medicationName: plan.medicationName,
    strength: plan.strength,
    dose: plan.dose,
    medicationKind: 'REGULAR',
    frequencyText: plan.frequencyText,
    instructions: plan.instructions,
    startDate: plan.startDate,
    routeId: lookups.oral?.id,
    medicationTypeId: plan.type === 'capsule' ? lookups.capsule?.id : lookups.tablet?.id,
    isControlledMedication: false,
    status: 'ACTIVE',
    schedules: plan.schedules.map((dueTime) => ({ dueTime, dose: plan.dose })),
  };
  if (plan.frequencyCode) {
    const f = lookups.freqByCode.get(plan.frequencyCode);
    if (f) body.frequencyId = f.id;
  }

  const { ok, json } = await api<{ data?: { id: string } }>(
    `/service-users/${SERVICE_USER_ID}/medications`,
    token,
    { method: 'POST', body: JSON.stringify(body) },
  );
  const id = json.data?.id ?? (json as { id?: string }).id;
  if (!ok || !id) {
    console.error(`  ! create ${plan.medicationName}`, json);
    process.exit(1);
  }
  console.log(`  + medication ${plan.medicationName} (${id.slice(0, 8)}…)`);
  return id;
}

async function createDelivery(
  token: string,
  medId: string,
  name: string,
  deliveredAt: string,
  quantity: number,
  dosesPerDay: number,
  pharmacyName: string,
): Promise<void> {
  const end = cycleEnd(deliveredAt, Math.max(28, Math.ceil(quantity / Math.max(1, dosesPerDay))));
  const body = {
    serviceUserMedicationId: medId,
    deliveredAt,
    quantity,
    pharmacyName,
    cycleEndDate: end,
    runsOutDate: end,
    notes: 'Blister pack cycle delivery — seeded via API',
  };
  const { ok, json } = await api<{ data?: { id: string } }>(
    `/service-users/${SERVICE_USER_ID}/medication-supply/deliveries`,
    token,
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!ok) {
    console.error(`  ! delivery for ${name}`, json);
    return;
  }
  console.log(`  + delivery ${name} ×${quantity}`);
}

async function main() {
  console.log(`\nSeeding blister pack for service user ${SERVICE_USER_ID}\n`);

  const su = await prisma.serviceUser.findUnique({
    where: { id: SERVICE_USER_ID },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      nhsNumber: true,
    },
  });
  if (!su) {
    console.error('Service user not found in database');
    process.exit(1);
  }
  console.log(`Service user: ${su.firstName} ${su.lastName} (NHS ${su.nhsNumber ?? '—'})`);

  const token = await login();
  const lookups = await loadLookups(token);

  const packsRes = await api<{ data?: { id: string; name: string; status: string }[] }>(
    `/service-users/${SERVICE_USER_ID}/medication-packs`,
    token,
  );
  const existingPacks = packsRes.json.data ?? [];
  const activePack = existingPacks.find((p) => p.status === 'ACTIVE' || p.status === 'DRAFT');
  if (activePack) {
    console.log(`\nExisting pack found: ${activePack.name} (${activePack.id}) — skipping create`);
    process.exit(0);
  }

  const medsRes = await api<{ data?: MedRow[] }>(
    `/service-users/${SERVICE_USER_ID}/medications?limit=100`,
    token,
  );
  const existing = medsRes.json.data ?? [];
  const byName = new Map(existing.map((m) => [m.medicationName.toLowerCase(), m]));

  const startDate = '2026-06-01';
  const cycleDurationDays = 28;
  const endDate = cycleEnd(startDate, cycleDurationDays);
  const deliveredAt = '2026-06-01';
  const pharmacyName = 'Day Lewis Pharmacy — Margaret Hughes';

  /** Existing chart meds to reuse + schedule times (HH:mm) */
  const existingSchedulePlan: { name: string; times: string[] }[] = [
    { name: 'Amlodipine', times: ['08:00'] },
    { name: 'Metformin', times: ['08:00', '18:00'] },
    { name: 'Atorvastatin', times: ['22:00'] },
    { name: 'Aspirin', times: ['08:00'] },
    { name: 'Paracetamol', times: ['12:00'] },
  ];

  const newMedPlans = [
    {
      medicationName: 'Lansoprazole',
      strength: '15mg',
      dose: '1 capsule',
      frequencyCode: 'ONCE_DAILY',
      frequencyText: 'Once daily before breakfast',
      instructions: 'Take 30 minutes before food.',
      schedules: ['08:00'],
      type: 'capsule' as const,
    },
    {
      medicationName: 'Bisoprolol',
      strength: '2.5mg',
      dose: '1 tablet',
      frequencyCode: 'ONCE_DAILY',
      frequencyText: 'Once daily in the afternoon',
      instructions: 'For heart rate / blood pressure.',
      schedules: ['15:00'],
      type: 'tablet' as const,
    },
    {
      medicationName: 'Ramipril',
      strength: '2.5mg',
      dose: '1 tablet',
      frequencyCode: 'ONCE_DAILY',
      frequencyText: 'Once daily in the evening',
      instructions: 'Take with evening meal.',
      schedules: ['18:00'],
      type: 'tablet' as const,
    },
  ];

  console.log('\n1) Ensuring medication schedules…');
  const memberIds: { id: string; name: string; times: string[] }[] = [];

  for (const plan of existingSchedulePlan) {
    const med = byName.get(plan.name.toLowerCase());
    if (!med) {
      console.error(`  ! existing med not found: ${plan.name}`);
      process.exit(1);
    }
    if (med.medicationKind === 'PRN' || med.isControlledMedication) {
      console.error(`  ! ${plan.name} is not blister-eligible`);
      process.exit(1);
    }
    const existingTimes = new Set(
      (med.schedules ?? []).map((s) => (s.dueTime ?? '').slice(0, 5)).filter(Boolean),
    );
    for (const t of plan.times) {
      if (!existingTimes.has(t)) {
        await ensureSchedule(token, med.id, t, startDate);
      } else {
        console.log(`  · schedule ${t} already on ${plan.name}`);
      }
    }
    memberIds.push({ id: med.id, name: plan.name, times: plan.times });
  }

  for (const plan of newMedPlans) {
    const existingMed = byName.get(plan.medicationName.toLowerCase());
    if (existingMed) {
      console.log(`  · ${plan.medicationName} already exists — adding schedules only`);
      const existingTimes = new Set(
        (existingMed.schedules ?? []).map((s) => (s.dueTime ?? '').slice(0, 5)).filter(Boolean),
      );
      for (const t of plan.schedules) {
        if (!existingTimes.has(t)) await ensureSchedule(token, existingMed.id, t, startDate);
      }
      memberIds.push({ id: existingMed.id, name: plan.medicationName, times: plan.schedules });
    } else {
      const id = await createMedication(token, { ...plan, startDate }, lookups);
      memberIds.push({ id, name: plan.medicationName, times: plan.schedules });
    }
  }

  console.log('\n2) Creating blister pack…');
  const roundLabel = ADMINISTRATION_ROUNDS.map((r) => r.name).join(' & ');
  const packBody = {
    name: 'Pharmacy Prepared Blister Pack — Full Rounds',
    description: '28-day MCA blister with Morning, Midday, Afternoon, Evening and Night compartments.',
    packType: 'BLISTER',
    roundLabel,
    pharmacyName,
    pharmacyPhone: '01234 567890',
    gpName: 'Dr Smith',
    gpSurgery: 'Riverside Medical Centre',
    nhsNumber: su.nhsNumber ?? undefined,
    startDate,
    endDate,
    cycleDurationDays,
    reviewDate: cycleEnd(startDate, 84),
    prescriptionChecked: true,
    prescriptionCheckedBy: 'Care Admin',
    prescriptionCheckedAt: startDate,
    generateAheadDays: 28,
    adminRules: {
      mcaCapacity: true,
      mcaBestInterests: true,
      mcaPrescriberList: true,
      covert: 'no',
      prnOverride: 'no',
      lateAllowed: 'yes',
      lateHours: 4,
      reviewMode: 'exceptions',
    },
  };

  const packRes = await api<{ data?: { id: string } }>(
    `/service-users/${SERVICE_USER_ID}/medication-packs`,
    token,
    { method: 'POST', body: JSON.stringify(packBody) },
  );
  const packId = packRes.json.data?.id ?? (packRes.json as { id?: string }).id;
  if (!packRes.ok || !packId) {
    console.error('Create pack failed', packRes.json);
    process.exit(1);
  }
  console.log(`  + pack ${packId}`);

  console.log('\n3) Adding all 5 compartments…');
  let sortOrder = 0;
  for (const round of ADMINISTRATION_ROUNDS) {
    const compRes = await api(
      `/service-users/${SERVICE_USER_ID}/medication-packs/${packId}/compartments`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          label: round.name,
          dueTime: round.time,
          windowStart: round.windowStart,
          windowEnd: round.windowEnd,
          sortOrder: sortOrder++,
        }),
      },
    );
    if (!compRes.ok) {
      console.error(`  ! compartment ${round.name}`, compRes.json);
      process.exit(1);
    }
    console.log(`  + compartment ${round.name} (${round.time})`);
  }

  console.log('\n4) Linking pack members…');
  for (const member of memberIds) {
    const memberRes = await api(
      `/service-users/${SERVICE_USER_ID}/medication-packs/${packId}/members`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({ serviceUserMedicationId: member.id }),
      },
    );
    if (!memberRes.ok) {
      console.error(`  ! link ${member.name}`, memberRes.json);
      process.exit(1);
    }
    console.log(`  + member ${member.name}`);
  }

  console.log('\n5) Publishing pack…');
  const pubRes = await api(
    `/service-users/${SERVICE_USER_ID}/medication-packs/${packId}/publish`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ confirmAccurate: true, notes: 'Seeded via API for administration testing' }),
    },
  );
  if (!pubRes.ok) {
    console.error('Publish failed', pubRes.json);
    process.exit(1);
  }
  console.log('  + published');

  console.log('\n6) Booking in blister cycle deliveries…');
  for (const member of memberIds) {
    const qty = Math.max(28, dosesPerDay(member.times) * cycleDurationDays);
    await createDelivery(token, member.id, member.name, deliveredAt, qty, dosesPerDay(member.times), pharmacyName);
  }

  console.log('\nDone.');
  console.log(`  Pack ID:     ${packId}`);
  console.log(`  Members:     ${memberIds.length}`);
  console.log(`  Compartments: ${ADMINISTRATION_ROUNDS.length} (Morning → Night)`);
  console.log(`  Cycle:       ${startDate} → ${endDate}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
