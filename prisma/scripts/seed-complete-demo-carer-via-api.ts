/**
 * Seed one fully-populated demo carer via API (personal, employment, pattern, skills,
 * reviews, holiday, compliance, emergency contact, non-core activities).
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/seed-complete-demo-carer-via-api.ts
 *
 * Env: API_BASE_URL, PROBE_EMAIL, PROBE_PASSWORD
 * Idempotent: username demo-carer-complete
 */
import { DayOfWeek, PrismaClient } from '@prisma/client';

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.PROBE_EMAIL ?? 'admin@careadmin.local';
const PASS = process.env.PROBE_PASSWORD ?? 'Admin@12345';
const USERNAME = 'demo-carer-complete';
const DEMO_NCA_NOTES_PREFIX = 'Demo complete carer';

const prisma = new PrismaClient();

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
    console.error('[demo-carer] Login failed — is API running?', json);
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
  const [
    roles,
    workAreas,
    locations,
    skills,
    reviewTypes,
    activeStatus,
    jobTitles,
    grades,
    contractTypes,
    titles,
    genders,
    nationalities,
    travelPaymentTypes,
    rbacLevels,
  ] = await Promise.all([
    prisma.employeeRoleLookup.findMany({ where: { deletedAt: null } }),
    prisma.workArea.findMany({ where: { deletedAt: null } }),
    prisma.location.findMany({ where: { deletedAt: null } }),
    prisma.skillType.findMany({ where: { deletedAt: null, isActive: true } }),
    prisma.reviewType.findMany({ where: { deletedAt: null, isActive: true } }),
    prisma.employeeStatus.findFirst({ where: { name: 'Active', deletedAt: null } }),
    prisma.jobTitle.findMany({ where: { deletedAt: null } }),
    prisma.grade.findMany({ where: { deletedAt: null } }),
    prisma.contractType.findMany({ where: { deletedAt: null } }),
    prisma.title.findMany({ where: { deletedAt: null } }),
    prisma.gender.findMany({ where: { deletedAt: null } }),
    prisma.nationality.findMany({ where: { deletedAt: null } }),
    prisma.travelPaymentType.findMany({ where: { deletedAt: null } }),
    prisma.rBACLevel.findMany({ where: { deletedAt: null } }),
  ]);

  const locationByName = Object.fromEntries(locations.map((l) => [l.name, l.id]));
  const pickLocation =
    locationByName['Croydon - Croydon 1'] ??
    locationByName['Merton - Merton 1'] ??
    locations[0]?.id;

  return {
    roleCarerId: roles.find((r) => r.name === 'Carer')?.id ?? roles[0]?.id,
    careWorkAreaId: workAreas.find((w) => w.name === 'Care')?.id ?? workAreas[0]?.id,
    locationId: pickLocation,
    floorLocationId:
      locationByName['Croydon - Croydon 2'] ?? locationByName['Merton - Merton 1'] ?? null,
    skillByName: Object.fromEntries(skills.map((s) => [s.name, s.id])),
    reviewByName: Object.fromEntries(reviewTypes.map((r) => [r.name, r])),
    activeStatusId: activeStatus?.id,
    jobTitleId: jobTitles.find((j) => j.name.toLowerCase() === 'carer')?.id ?? jobTitles[0]?.id,
    gradeId: grades.find((g) => g.name === 'Grade 2')?.id ?? grades[0]?.id,
    contractTypeId:
      contractTypes.find((c) => c.name === 'Salaried')?.id ?? contractTypes[0]?.id,
    titleId: titles[0]?.id,
    genderId: genders[0]?.id,
    nationalityId: nationalities[0]?.id,
    travelPaymentTypeId: travelPaymentTypes[0]?.id,
    rbacLevelId: rbacLevels[0]?.id,
  };
}

async function ensureEmployee(token: string, lookups: Awaited<ReturnType<typeof loadLookups>>) {
  const existing = await prisma.employeePersonalDetail.findFirst({
    where: { username: USERNAME, deletedAt: null },
    include: { employee: true },
  });
  if (existing?.employee && !existing.employee.deletedAt) {
    return { employeeId: existing.employeeId, created: false };
  }

  const { ok, json } = await api<{ data?: { id: string } }>('/employees', token, {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Casey',
      lastName: 'Demo-Carer',
      username: USERNAME,
      email: `${USERNAME}@demo.careflow.local`,
      statusId: lookups.activeStatusId,
      titleId: lookups.titleId,
      genderId: lookups.genderId,
      nationalityId: lookups.nationalityId,
    }),
  });
  const employeeId = json.data?.id ?? (json as { id?: string }).id;
  if (!ok || !employeeId) {
    console.error('[demo-carer] Create failed', json);
    process.exit(1);
  }
  return { employeeId, created: true };
}

async function seedPersonal(token: string, employeeId: string) {
  const dob = addDays(new Date(), -365 * 28);
  const { ok, json } = await api(`/employees/${employeeId}/personal-details`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      dateOfBirth: dob.toISOString(),
      addressLine1: '42 Demo Street',
      town: 'Croydon',
      country: 'United Kingdom',
      postcode: 'CR0 1AA',
      homeTelephone: '+442071234567',
      mobileTelephone: '+447700900123',
    }),
  });
  if (!ok) console.error('[demo-carer] personal-details', json);
}

async function seedEmployment(
  token: string,
  employeeId: string,
  lookups: Awaited<ReturnType<typeof loadLookups>>,
) {
  const { ok, json } = await api(`/employees/${employeeId}/employment`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      workAreaId: lookups.careWorkAreaId,
      roleId: lookups.roleCarerId,
      jobTitleId: lookups.jobTitleId,
      gradeId: lookups.gradeId,
      contractTypeId: lookups.contractTypeId,
      rbacLevelId: lookups.rbacLevelId,
      travelPaymentTypeId: lookups.travelPaymentTypeId,
      locationId: lookups.locationId,
      baseLocationId: lookups.locationId,
      visaTypeId: 'british_citizen',
      isInCountry: true,
      accessAllZones: false,
      contractedWeeklyHours: 37.5,
      minimumWeeklyHours: 30,
      maximumWeeklyHours: 48,
      nationalInsuranceNo: 'AB123456C',
      employeeNumber: 'EMP-DEMO-001',
      payrollNumber: 'PAY-DEMO-001',
      nmcPinNumber: '12A1234E',
      startDate: isoDate(addDays(new Date(), -200)),
      optedOutOf48Hours: false,
      isAgencyStaff: false,
      isBankStaff: false,
    }),
  });
  if (!ok) console.error('[demo-carer] employment', json);

  if (lookups.locationId) {
    await api(`/location-management/employees/${employeeId}/location`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        locationId: lookups.locationId,
        accessAllZones: false,
        floorLocationIds: lookups.floorLocationId ? [lookups.floorLocationId] : undefined,
      }),
    });
  }
}

async function seedEmergencyContact(token: string, employeeId: string) {
  const { ok, json } = await api(`/employees/${employeeId}/emergency-contacts`, token, {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Jane',
      lastName: 'Demo-Carer',
      relationship: 'Spouse',
      phone: '+447700900456',
    }),
  });
  if (!ok && json) console.error('[demo-carer] emergency contact (may exist)', json);
}

async function seedSkills(token: string, employeeId: string, lookups: Awaited<ReturnType<typeof loadLookups>>) {
  const names = ['Manual Handling', 'Medication Administration', 'Safeguarding Adults', 'Dementia Care'];
  for (const name of names) {
    const skillTypeId = lookups.skillByName[name];
    if (!skillTypeId) continue;
    await api(`/employees/${employeeId}/skills`, token, {
      method: 'POST',
      body: JSON.stringify({
        skillTypeId,
        expiryDate: addDays(new Date(), 365).toISOString(),
        notes: 'Demo complete carer seed',
      }),
    });
  }
}

async function replaceWorkingPattern(token: string, employeeId: string) {
  const weeks = [
    { day: 'MONDAY' as DayOfWeek, weekInCycle: 1, startTime: '07:00', endTime: '13:00', notes: 'Early shift' },
    { day: 'TUESDAY' as DayOfWeek, weekInCycle: 1, startTime: '14:00', endTime: '22:00', notes: 'Late shift' },
    { day: 'WEDNESDAY' as DayOfWeek, weekInCycle: 1, startTime: '07:00', endTime: '15:00', notes: 'Early shift' },
    { day: 'THURSDAY' as DayOfWeek, weekInCycle: 1, startTime: '14:00', endTime: '22:00', notes: 'Late shift' },
    { day: 'FRIDAY' as DayOfWeek, weekInCycle: 1, startTime: '09:00', endTime: '13:00', notes: 'Half day' },
    { day: 'SATURDAY' as DayOfWeek, weekInCycle: 1, startTime: '08:00', endTime: '16:00', notes: 'Weekend cover' },
    { day: 'MONDAY' as DayOfWeek, weekInCycle: 2, startTime: '09:00', endTime: '17:00', notes: 'Week 2 standard' },
    { day: 'TUESDAY' as DayOfWeek, weekInCycle: 2, startTime: '09:00', endTime: '17:00', notes: 'Week 2 standard' },
  ];

  const { ok, json } = await api(`/employees/${employeeId}/working-patterns/bulk`, token, {
    method: 'PUT',
    body: JSON.stringify({
      cycleWeeks: 2,
      weeks: weeks.map((slot) => ({
        weekInCycle: slot.weekInCycle,
        dayOfWeek: slot.day,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isAvailable: true,
        notes: slot.notes,
      })),
    }),
  });
  if (!ok) console.error('[demo-carer] working-pattern bulk', json);
}

async function seedNonCoreActivities(token: string, employeeId: string) {
  const reasons = await prisma.nonCoreActivityReason.findMany({ where: { deletedAt: null } });
  const reasonByName = Object.fromEntries(reasons.map((row) => [row.name, row.id]));

  const prior = await prisma.employeeNonCoreActivity.findMany({
    where: {
      employeeId,
      deletedAt: null,
      notes: { contains: DEMO_NCA_NOTES_PREFIX },
    },
    select: { id: true },
  });
  for (const row of prior) {
    await api(`/employees/${employeeId}/non-core-activities/${row.id}`, token, { method: 'DELETE' });
  }

  const today = new Date();
  const activities: Array<{
    reasonName: string;
    dateFrom: Date;
    dateTo: Date;
    notes: string;
    includeInPayroll?: boolean;
    onCallForPeriod?: boolean;
  }> = [
    {
      reasonName: 'Non working time',
      dateFrom: addDays(today, -60),
      dateTo: addDays(today, -58),
      notes: `${DEMO_NCA_NOTES_PREFIX} — mandatory training (Care Certificate day 1)`,
      includeInPayroll: true,
    },
    {
      reasonName: 'Sickness',
      dateFrom: addDays(today, -10),
      dateTo: addDays(today, -7),
      notes: `${DEMO_NCA_NOTES_PREFIX} — short sickness absence (resolved)`,
    },
    {
      reasonName: 'Self Isolation',
      dateFrom: addDays(today, 14),
      dateTo: addDays(today, 21),
      notes: `${DEMO_NCA_NOTES_PREFIX} — planned isolation period`,
      onCallForPeriod: false,
    },
  ];

  for (const activity of activities) {
    const reasonId = reasonByName[activity.reasonName];
    if (!reasonId) {
      console.error('[demo-carer] missing NCA reason', activity.reasonName);
      continue;
    }
    const { ok, json } = await api(`/employees/${employeeId}/non-core-activities`, token, {
      method: 'POST',
      body: JSON.stringify({
        reasonId,
        dateFrom: activity.dateFrom.toISOString(),
        dateTo: activity.dateTo.toISOString(),
        notes: activity.notes,
        includeInPayroll: activity.includeInPayroll,
        onCallForPeriod: activity.onCallForPeriod,
        applyToSchedule: false,
      }),
    });
    if (!ok) console.error('[demo-carer] non-core activity', activity.reasonName, json);
  }
}

async function seedReviews(token: string, employeeId: string, lookups: Awaited<ReturnType<typeof loadLookups>>) {
  const today = new Date();
  const supervision = lookups.reviewByName['Supervision'];
  const appraisal = lookups.reviewByName['Annual Appraisal'];
  if (supervision) {
    const lastDone = addDays(today, -45);
    const nextDue = addDays(lastDone, supervision.defaultIntervalDays ?? 90);
    await api(`/employees/${employeeId}/reviews`, token, {
      method: 'POST',
      body: JSON.stringify({
        reviewTypeId: supervision.id,
        status: 'SCHEDULED',
        lastDone: lastDone.toISOString(),
        nextDue: nextDue.toISOString(),
        notes: 'Demo supervision — on track',
      }),
    });
  }
  if (appraisal) {
    const lastDone = addDays(today, -200);
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
}

async function seedHoliday(token: string, employeeId: string) {
  const today = new Date();
  const from = addDays(today, -2);
  const to = addDays(today, 5);
  const { ok, json } = await api(`/employees/${employeeId}/holidays`, token, {
    method: 'POST',
    body: JSON.stringify({
      startDate: from.toISOString(),
      endDate: to.toISOString(),
      notes: 'Demo annual leave — staff list on-leave badge',
    }),
  });
  if (!ok) console.error('[demo-carer] holiday', json);
}

async function seedCompliance(token: string, employeeId: string) {
  await api(`/employees/${employeeId}/compliance/ensure-checklist`, token, { method: 'POST' });
  const { ok, json } = await api<{ data?: { items: Array<{ complianceTypeId: string; code: string | null; record: { id: string } | null }> } }>(
    `/employees/${employeeId}/compliance/checklist`,
    token,
  );
  if (!ok) {
    console.error('[demo-carer] compliance checklist', json);
    return;
  }
  const items = json.data?.items ?? [];
  const today = new Date();
  for (const item of items.slice(0, 4)) {
    const issueDate = addDays(today, -120);
    const expiryDate = addDays(today, 180);
    let complianceId = item.record?.id;
    if (!complianceId) {
      const created = await api<{ data?: { id: string } }>(`/employees/${employeeId}/compliance`, token, {
        method: 'POST',
        body: JSON.stringify({
          complianceTypeId: item.complianceTypeId,
          issueDate: issueDate.toISOString(),
          expiryDate: expiryDate.toISOString(),
          notes: 'Demo complete carer compliance',
        }),
      });
      complianceId = created.json.data?.id;
    } else {
      await api(`/employees/${employeeId}/compliance/${complianceId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          issueDate: issueDate.toISOString(),
          expiryDate: expiryDate.toISOString(),
        }),
      });
    }
    if (complianceId) {
      await api(`/employees/${employeeId}/compliance/${complianceId}/verify`, token, {
        method: 'PATCH',
        body: JSON.stringify({ notes: 'Demo verify' }),
      });
    }
  }
}

async function main() {
  console.log('[demo-carer] Logging in…');
  const token = await login();
  const lookups = await loadLookups();
  if (!lookups.careWorkAreaId || !lookups.locationId) {
    console.error('[demo-carer] Missing lookups — run prisma db seed first');
    process.exit(1);
  }

  const { employeeId, created } = await ensureEmployee(token, lookups);
  console.log(`[demo-carer] Employee ${employeeId} (${created ? 'created' : 'existing'})`);

  await seedPersonal(token, employeeId);
  await seedEmployment(token, employeeId, lookups);
  await seedEmergencyContact(token, employeeId);
  await seedSkills(token, employeeId, lookups);
  await replaceWorkingPattern(token, employeeId);
  await seedReviews(token, employeeId, lookups);
  await seedHoliday(token, employeeId);
  await seedNonCoreActivities(token, employeeId);
  await seedCompliance(token, employeeId);

  const { ok, json } = await api<{ data?: unknown }>(`/employees/${employeeId}`, token);
  console.log('[demo-carer] GET /employees/:id', ok ? 'ok' : json);
  console.log(`[demo-carer] Done. Username: ${USERNAME}, id: ${employeeId}`);
  console.log('[demo-carer] Open staff list and search "Casey" or filter by branch.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
