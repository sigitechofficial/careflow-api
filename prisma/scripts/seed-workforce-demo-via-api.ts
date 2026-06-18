/**
 * Seed ~24 demo employees via authenticated API (workforce catalog P4).
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/seed-workforce-demo-via-api.ts
 *
 * Env: API_BASE_URL (default http://localhost:3000), PROBE_EMAIL, PROBE_PASSWORD
 * Idempotent: skips employees whose username already exists (prefix wf-demo-).
 */
import { DayOfWeek, PrismaClient } from '@prisma/client';

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.PROBE_EMAIL ?? 'admin@careadmin.local';
const PASS = process.env.PROBE_PASSWORD ?? 'Admin@12345';
const USERNAME_PREFIX = 'wf-demo-';

const prisma = new PrismaClient();

type Persona = {
  key: string;
  firstName: string;
  lastName: string;
  roleName: 'Carer' | 'Senior Carer';
  jobTitleName?: string;
  gradeName?: string;
  contractTypeName?: string;
  visaTypeId?: string;
  isInCountry?: boolean;
  locationName: string;
  accessAllZones?: boolean;
  floorLocationNames?: string[];
  isBankStaff?: boolean;
  isAgencyStaff?: boolean;
  contractedWeeklyHours: number;
  minimumWeeklyHours: number;
  maximumWeeklyHours: number;
  skillNames: string[];
  pattern: 'weekdays' | 'weekend' | 'part-time' | 'none-weekend';
  reviewOverdue?: boolean;
  addHoliday?: boolean;
  addSickness?: boolean;
};

const PERSONAS: Persona[] = [
  { key: '01', firstName: 'Amara', lastName: 'Okonkwo', roleName: 'Carer', locationName: 'Croydon - Croydon 1', contractedWeeklyHours: 37.5, minimumWeeklyHours: 30, maximumWeeklyHours: 48, skillNames: ['Dementia Care', 'Manual Handling'], pattern: 'weekdays' },
  { key: '02', firstName: 'Ben', lastName: 'Hughes', roleName: 'Carer', locationName: 'Croydon - Croydon 2', contractedWeeklyHours: 37.5, minimumWeeklyHours: 30, maximumWeeklyHours: 48, skillNames: ['Medication Administration', 'Safeguarding Adults'], pattern: 'weekdays' },
  { key: '03', firstName: 'Chiara', lastName: 'Rossi', roleName: 'Carer', locationName: 'Croydon - Croydon 3', contractedWeeklyHours: 37.5, minimumWeeklyHours: 30, maximumWeeklyHours: 48, skillNames: ['Infection control', 'Food hygiene'], pattern: 'weekdays', reviewOverdue: true },
  { key: '04', firstName: 'David', lastName: 'Chen', roleName: 'Carer', locationName: 'Croydon - Croydon 4', contractedWeeklyHours: 37.5, minimumWeeklyHours: 30, maximumWeeklyHours: 48, skillNames: ['Epilepsy awareness', 'First Aid'], pattern: 'weekdays' },
  { key: '05', firstName: 'Elena', lastName: 'Popescu', roleName: 'Carer', locationName: 'Croydon - Croydon 5', contractedWeeklyHours: 37.5, minimumWeeklyHours: 30, maximumWeeklyHours: 48, skillNames: ['Dementia Care', 'Passenger assistance'], pattern: 'weekdays' },
  { key: '06', firstName: 'Fatima', lastName: 'Khan', roleName: 'Carer', locationName: 'Merton - Merton 1', contractedWeeklyHours: 37.5, minimumWeeklyHours: 30, maximumWeeklyHours: 48, skillNames: ['Urdu language', 'Manual Handling'], pattern: 'weekdays', visaTypeId: 'health_care_worker' },
  { key: '07', firstName: 'George', lastName: 'Williams', roleName: 'Carer', locationName: 'Haringey - Haringey 1', contractedWeeklyHours: 37.5, minimumWeeklyHours: 30, maximumWeeklyHours: 48, skillNames: ['Safeguarding Adults', 'Infection control'], pattern: 'weekdays', reviewOverdue: true },
  { key: '08', firstName: 'Hannah', lastName: 'Murphy', roleName: 'Carer', locationName: 'Bexley - Bexley 1', contractedWeeklyHours: 37.5, minimumWeeklyHours: 30, maximumWeeklyHours: 48, skillNames: ['Dementia Care', 'Medication Administration'], pattern: 'weekdays' },
  { key: '09', firstName: 'Ivan', lastName: 'Petrov', roleName: 'Senior Carer', locationName: 'Croydon - Croydon 1', accessAllZones: true, contractedWeeklyHours: 40, minimumWeeklyHours: 35, maximumWeeklyHours: 48, skillNames: ['Medication Administration', 'Safeguarding Adults', 'Dementia Care', 'Manual Handling'], pattern: 'weekdays' },
  { key: '10', firstName: 'Julia', lastName: 'Santos', roleName: 'Senior Carer', locationName: 'Croydon - Croydon 2', accessAllZones: true, contractedWeeklyHours: 40, minimumWeeklyHours: 35, maximumWeeklyHours: 48, skillNames: ['Medication Administration', 'Safeguarding Adults', 'Hoist operation'], pattern: 'weekdays', reviewOverdue: true },
  { key: '11', firstName: 'Kevin', lastName: 'Osei', roleName: 'Senior Carer', locationName: 'Croydon - Croydon 3', accessAllZones: true, contractedWeeklyHours: 40, minimumWeeklyHours: 35, maximumWeeklyHours: 48, skillNames: ['Medication Administration', 'Learning disability support', 'Autism support'], pattern: 'weekdays' },
  { key: '12', firstName: 'Lily', lastName: 'Nguyen', roleName: 'Carer', locationName: 'Croydon - Croydon 1', floorLocationNames: ['Croydon - Croydon 2', 'Merton - Merton 1'], contractedWeeklyHours: 37.5, minimumWeeklyHours: 30, maximumWeeklyHours: 48, skillNames: ['Manual Handling', 'Reablement'], pattern: 'weekdays' },
  { key: '13', firstName: 'Marcus', lastName: 'Johnson', roleName: 'Carer', locationName: 'Greenwich - Greenwich 1', floorLocationNames: ['Hackney - Hackney 1', 'Bexley - Bexley 1'], contractedWeeklyHours: 37.5, minimumWeeklyHours: 30, maximumWeeklyHours: 48, skillNames: ['Driver — own vehicle', 'Passenger assistance'], pattern: 'weekdays' },
  { key: '14', firstName: 'Nadia', lastName: 'Ahmed', roleName: 'Carer', locationName: 'Hackney - Hackney 1', floorLocationNames: ['Haringey - Haringey 1'], contractedWeeklyHours: 20, minimumWeeklyHours: 16, maximumWeeklyHours: 20, skillNames: ['Polish language', 'Food hygiene'], pattern: 'part-time', visaTypeId: 'student_visa', isInCountry: true },
  { key: '15', firstName: 'Oliver', lastName: 'Brown', roleName: 'Carer', locationName: 'Transport - Croydon Transport', contractedWeeklyHours: 37.5, minimumWeeklyHours: 30, maximumWeeklyHours: 48, skillNames: ['Driver — company vehicle', 'Wheelchair accessible vehicle'], pattern: 'weekdays', visaTypeId: 'settled_status' },
  { key: '16', firstName: 'Priya', lastName: 'Sharma', roleName: 'Carer', locationName: 'Croydon admin - Croydon office', contractedWeeklyHours: 20, minimumWeeklyHours: 16, maximumWeeklyHours: 24, skillNames: ['Record keeping'], pattern: 'part-time', visaTypeId: 'british_citizen' },
  { key: '17', firstName: 'Quinn', lastName: 'Taylor', roleName: 'Carer', locationName: 'Croydon - Croydon 4', isBankStaff: true, contractedWeeklyHours: 0, minimumWeeklyHours: 0, maximumWeeklyHours: 40, skillNames: ['Manual Handling', 'Safeguarding Adults'], pattern: 'none-weekend' },
  { key: '18', firstName: 'Rosa', lastName: 'Martinez', roleName: 'Carer', locationName: 'Croydon - Croydon 5', isAgencyStaff: true, contractedWeeklyHours: 0, minimumWeeklyHours: 0, maximumWeeklyHours: 40, skillNames: ['Infection control'], pattern: 'none-weekend', visaTypeId: 'skilled_worker', isInCountry: false },
  { key: '19', firstName: 'Sam', lastName: 'Patel', roleName: 'Carer', locationName: 'Merton - Merton 1', contractedWeeklyHours: 24, minimumWeeklyHours: 16, maximumWeeklyHours: 30, skillNames: ['Sleep-in care', 'Waking night care'], pattern: 'weekend' },
  { key: '20', firstName: 'Tara', lastName: 'Singh', roleName: 'Carer', locationName: 'Haringey - Haringey 1', contractedWeeklyHours: 20, minimumWeeklyHours: 16, maximumWeeklyHours: 24, skillNames: ['Live-in care', 'Palliative / end of life'], pattern: 'part-time' },
  { key: '21', firstName: 'Uma', lastName: 'Fernandez', roleName: 'Carer', locationName: 'Bexley - Bexley 1', contractedWeeklyHours: 37.5, minimumWeeklyHours: 30, maximumWeeklyHours: 48, skillNames: ['Catheter care', 'Stoma care'], pattern: 'weekdays', addHoliday: true },
  { key: '22', firstName: 'Victor', lastName: 'Ivanov', roleName: 'Carer', locationName: 'Greenwich - Greenwich 1', contractedWeeklyHours: 37.5, minimumWeeklyHours: 30, maximumWeeklyHours: 48, skillNames: ['PEG / RIG feeding', 'Dysphagia support'], pattern: 'weekdays', addSickness: true },
  { key: '23', firstName: 'Wendy', lastName: 'Clark', roleName: 'Carer', locationName: 'Croydon - Croydon 2', contractedWeeklyHours: 37.5, minimumWeeklyHours: 30, maximumWeeklyHours: 48, skillNames: ['Mental health support', 'Behaviour support'], pattern: 'weekdays', addSickness: true },
  { key: '24', firstName: 'Yusuf', lastName: 'Ali', roleName: 'Carer', locationName: 'Croydon - Croydon 3', contractedWeeklyHours: 37.5, minimumWeeklyHours: 30, maximumWeeklyHours: 48, skillNames: ['British Sign Language', 'Autism support'], pattern: 'weekdays', addHoliday: true },
];

async function api<T>(path: string, token: string, init?: RequestInit) {
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
    console.error('Login failed — is API running?', json);
    process.exit(1);
  }
  return token;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function loadLookups() {
  const [roles, workAreas, locations, skills, reviewTypes, activeStatus, jobTitles, grades, contractTypes] =
    await Promise.all([
    prisma.employeeRoleLookup.findMany({ where: { deletedAt: null } }),
    prisma.workArea.findMany({ where: { deletedAt: null } }),
    prisma.location.findMany({ where: { deletedAt: null } }),
    prisma.skillType.findMany({ where: { deletedAt: null, isActive: true } }),
    prisma.reviewType.findMany({ where: { deletedAt: null, isActive: true } }),
    prisma.employeeStatus.findFirst({ where: { name: 'Active', deletedAt: null } }),
    prisma.jobTitle.findMany({ where: { deletedAt: null } }),
    prisma.grade.findMany({ where: { deletedAt: null } }),
    prisma.contractType.findMany({ where: { deletedAt: null } }),
  ]);
  return {
    roleByName: Object.fromEntries(roles.map((r) => [r.name, r.id])),
    careWorkAreaId: workAreas.find((w) => w.name === 'Care')?.id,
    locationByName: Object.fromEntries(locations.map((l) => [l.name, l.id])),
    skillByName: Object.fromEntries(skills.map((s) => [s.name, s.id])),
    reviewByCode: Object.fromEntries(reviewTypes.filter((r) => r.code).map((r) => [r.code!, r])),
    activeStatusId: activeStatus?.id,
    jobTitleByName: Object.fromEntries(jobTitles.map((j) => [j.name, j.id])),
    gradeByName: Object.fromEntries(grades.map((g) => [g.name, g.id])),
    contractTypeByName: Object.fromEntries(contractTypes.map((c) => [c.name, c.id])),
  };
}

function personaEmploymentLookups(p: Persona, lookups: Awaited<ReturnType<typeof loadLookups>>) {
  const jobTitleName =
    p.jobTitleName ?? (p.roleName === 'Senior Carer' ? 'senior carer' : 'Carer');
  const gradeName =
    p.gradeName ?? (p.roleName === 'Senior Carer' ? 'Grade 3' : p.pattern === 'part-time' ? 'Grade 1' : 'Grade 2');
  const contractTypeName =
    p.contractTypeName ??
    (p.isAgencyStaff ? 'Agency' : p.isBankStaff ? 'Bank staff' : p.pattern === 'part-time' ? 'Hourly paid' : 'Salaried');

  return {
    jobTitleId: lookups.jobTitleByName[jobTitleName],
    gradeId: lookups.gradeByName[gradeName],
    contractTypeId: lookups.contractTypeByName[contractTypeName],
  };
}

function personaVisaDefaults(p: Persona) {
  if (p.visaTypeId) {
    return { visaTypeId: p.visaTypeId, isInCountry: p.isInCountry ?? true };
  }
  if (p.isAgencyStaff) {
    return { visaTypeId: 'other_time_limited', isInCountry: p.isInCountry ?? true };
  }
  if (p.pattern === 'part-time' && p.contractedWeeklyHours <= 20) {
    return { visaTypeId: 'pre_settled_euss', isInCountry: true };
  }
  return { visaTypeId: 'british_citizen', isInCountry: true };
}

async function patchEmployment(
  token: string,
  employeeId: string,
  p: Persona,
  lookups: Awaited<ReturnType<typeof loadLookups>>,
) {
  const locationId = lookups.locationByName[p.locationName];
  const { jobTitleId, gradeId, contractTypeId } = personaEmploymentLookups(p, lookups);
  const { visaTypeId, isInCountry } = personaVisaDefaults(p);

  const { ok, json } = await api(`/employees/${employeeId}/employment`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      roleId: lookups.roleByName[p.roleName],
      workAreaId: lookups.careWorkAreaId,
      jobTitleId,
      gradeId,
      contractTypeId,
      visaTypeId,
      isInCountry,
      locationId,
      baseLocationId: locationId,
      accessAllZones: p.accessAllZones ?? false,
      contractedWeeklyHours: p.contractedWeeklyHours,
      minimumWeeklyHours: p.minimumWeeklyHours,
      maximumWeeklyHours: p.maximumWeeklyHours,
      isBankStaff: p.isBankStaff ?? false,
      isAgencyStaff: p.isAgencyStaff ?? false,
      agencyName: p.isAgencyStaff ? 'Demo Agency Ltd' : undefined,
      startDate: isoDate(addDays(new Date(), -180)),
    }),
  });
  if (!ok) {
    console.error(`  ! employment patch ${p.key}`, json);
  }
  return ok;
}

function patternDays(kind: Persona['pattern']): Array<{ day: DayOfWeek; start?: string; end?: string; notes?: string }> {
  const weekdays: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
  const weekend: DayOfWeek[] = ['SATURDAY', 'SUNDAY'];
  if (kind === 'weekdays') {
    return weekdays.map((day) => ({ day, start: '09:00', end: '17:00' }));
  }
  if (kind === 'weekend') {
    return weekend.map((day) => ({ day, start: '08:00', end: '20:00' }));
  }
  if (kind === 'part-time') {
    return [
      { day: 'MONDAY', start: '09:00', end: '13:00', notes: 'partial' },
      { day: 'WEDNESDAY', start: '09:00', end: '13:00', notes: 'partial' },
      { day: 'FRIDAY', start: '09:00', end: '13:00', notes: 'partial' },
    ];
  }
  return weekdays.map((day) => ({ day, start: '09:00', end: '17:00' }));
}

async function seedPersona(token: string, p: Persona, lookups: Awaited<ReturnType<typeof loadLookups>>) {
  const username = `${USERNAME_PREFIX}${p.key}`;
  const existing = await prisma.employeePersonalDetail.findFirst({
    where: { username, deletedAt: null },
    include: { employee: true },
  });
  if (existing?.employee && !existing.employee.deletedAt) {
    await patchEmployment(token, existing.employeeId, p, lookups);
    console.log(`  refresh ${username} (employment backfill)`);
    return { skipped: true, id: existing.employeeId };
  }

  const { ok, json } = await api<{ data?: { id: string } }>('/employees', token, {
    method: 'POST',
    body: JSON.stringify({
      firstName: p.firstName,
      lastName: p.lastName,
      username,
      email: `${username}@demo.careflow.local`,
      statusId: lookups.activeStatusId,
    }),
  });
  const employeeId = json.data?.id ?? (json as { id?: string }).id;
  if (!ok || !employeeId) {
    console.error(`  ! create ${username}`, json);
    return { skipped: false, error: true };
  }

  const locationId = lookups.locationByName[p.locationName];
  const floorLocationIds = (p.floorLocationNames ?? [])
    .map((n) => lookups.locationByName[n])
    .filter(Boolean);

  await patchEmployment(token, employeeId, p, lookups);

  if (locationId) {
    await api(`/location-management/employees/${employeeId}/location`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        locationId,
        accessAllZones: p.accessAllZones ?? false,
        floorLocationIds: floorLocationIds.length ? floorLocationIds : undefined,
      }),
    });
  }

  for (const skillName of p.skillNames) {
    const skillTypeId = lookups.skillByName[skillName];
    if (!skillTypeId) continue;
    await api(`/employees/${employeeId}/skills`, token, {
      method: 'POST',
      body: JSON.stringify({ skillTypeId, notes: 'Demo workforce seed' }),
    });
  }

  for (const row of patternDays(p.pattern)) {
    await api(`/employees/${employeeId}/working-patterns`, token, {
      method: 'POST',
      body: JSON.stringify({
        dayOfWeek: row.day,
        startTime: row.start,
        endTime: row.end,
        isAvailable: true,
        notes: row.notes,
      }),
    });
  }

  const supervision = lookups.reviewByCode['SUPERVISION'];
  const appraisal = lookups.reviewByCode['ANNUAL_APPRAISAL'];
  const today = new Date();
  if (supervision) {
    const lastDone = addDays(today, p.reviewOverdue ? -120 : -30);
    const nextDue = addDays(lastDone, supervision.defaultIntervalDays ?? 90);
    await api(`/employees/${employeeId}/reviews`, token, {
      method: 'POST',
      body: JSON.stringify({
        reviewTypeId: supervision.id,
        status: p.reviewOverdue ? 'OVERDUE' : 'SCHEDULED',
        lastDone: lastDone.toISOString(),
        nextDue: nextDue.toISOString(),
        notes: p.reviewOverdue ? 'Demo overdue supervision' : 'Demo supervision on track',
      }),
    });
  }
  if (appraisal) {
    const lastDone = addDays(today, -300);
    const nextDue = addDays(lastDone, appraisal.defaultIntervalDays ?? 365);
    await api(`/employees/${employeeId}/reviews`, token, {
      method: 'POST',
      body: JSON.stringify({
        reviewTypeId: appraisal.id,
        status: 'SCHEDULED',
        lastDone: lastDone.toISOString(),
        nextDue: nextDue.toISOString(),
      }),
    });
  }

  if (p.addHoliday) {
    const from = addDays(today, 14);
    const to = addDays(today, 21);
    await api(`/employees/${employeeId}/holidays`, token, {
      method: 'POST',
      body: JSON.stringify({ dateFrom: from.toISOString(), dateTo: to.toISOString(), notes: 'Demo annual leave' }),
    });
  }

  if (p.addSickness) {
    const reason = await prisma.nonCoreActivityReason.findFirst({ where: { name: { contains: 'Sick', mode: 'insensitive' }, deletedAt: null } });
    const from = addDays(today, -3);
    const to = addDays(today, 4);
    await api(`/employees/${employeeId}/non-core-activities`, token, {
      method: 'POST',
      body: JSON.stringify({
        reasonId: reason?.id,
        dateFrom: from.toISOString(),
        dateTo: to.toISOString(),
        notes: 'Demo sickness absence',
      }),
    });
  }

  console.log(`  + ${username} (${p.firstName} ${p.lastName})`);
  return { skipped: false, id: employeeId };
}

async function main() {
  console.log('[workforce-demo] Logging in…');
  const token = await login();
  const lookups = await loadLookups();
  if (!lookups.careWorkAreaId) {
    console.error('Care work area missing — run prisma db seed first');
    process.exit(1);
  }

  let created = 0;
  let skipped = 0;
  for (const persona of PERSONAS) {
    const result = await seedPersona(token, persona, lookups);
    if (result.skipped) skipped += 1;
    else if (!result.error) created += 1;
  }

  const total = await prisma.employee.count({ where: { deletedAt: null } });
  console.log(`[workforce-demo] Done: ${created} created, ${skipped} skipped, ${total} employees total.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
