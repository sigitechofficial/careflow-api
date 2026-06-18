/**
 * Verify immigration status catalog, hour-cap validation, per-employee override, and roster warnings.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/probe-immigration-hours-via-api.ts
 *
 * Env: API_BASE_URL (default http://localhost:3000), PROBE_EMAIL, PROBE_PASSWORD
 * Swagger: http://localhost:3000/api/docs
 */
import { PrismaClient } from '@prisma/client';

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.PROBE_EMAIL ?? 'admin@careadmin.local';
const PASS = process.env.PROBE_PASSWORD ?? 'Admin@12345';
const DEMO_USERNAME = 'wf-demo-14';

const prisma = new PrismaClient();

type ApiResult = { ok: boolean; status: number; json: unknown };

async function api(path: string, token: string, init?: RequestInit): Promise<ApiResult> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function dataOf(json: unknown): Record<string, unknown> {
  const root = asRecord(json);
  const data = root.data;
  if (Array.isArray(data)) return { rows: data };
  return asRecord(data);
}

function messageOf(json: unknown): string {
  const root = asRecord(json);
  return typeof root.message === 'string' ? root.message : JSON.stringify(json);
}

async function login(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASS }),
    });
  } catch {
    console.error(`Cannot reach ${BASE} — start API: npm run start:dev`);
    process.exit(1);
  }
  const json = await res.json();
  const token = asRecord(json).data
    ? asRecord(asRecord(json).data).accessToken
    : asRecord(json).accessToken;
  if (!res.ok || typeof token !== 'string') {
    console.error('Login failed', json);
    process.exit(1);
  }
  return token;
}

function assertStep(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function createProbeJob(weekStart: Date) {
  const template = await prisma.scheduledJob.findFirst({
    where: { deletedAt: null, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!template) return null;

  const start = new Date(weekStart);
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 3 * 3_600_000);

  return prisma.scheduledJob.create({
    data: {
      scheduleBatchId: template.scheduleBatchId,
      scheduleAreaId: template.scheduleAreaId,
      serviceUserId: template.serviceUserId,
      jobName: `PROBE immigration hours ${Date.now()}`,
      scheduledStartDateTime: start,
      scheduledEndDateTime: end,
      estimatedDurationMinutes: 180,
      requiredCarers: 2,
      status: 'UNALLOCATED',
      isActive: true,
    },
    include: { allocations: true },
  });
}

async function main() {
  console.log(`Immigration / hours API probe → ${BASE}/api/docs\n`);
  const token = await login();
  console.log('Login OK\n');

  // 1. Settings immigration catalog
  const settings = await api('/settings/general', token);
  const visaTypes = dataOf(settings.json).employeeVisaTypes as unknown[] | undefined;
  const student = Array.isArray(visaTypes)
    ? (visaTypes as Array<{ id?: string; maxWeeklyHours?: number }>).find((v) => v.id === 'student_visa')
    : undefined;
  assertStep(
    'GET /settings/general — employeeVisaTypes catalog',
    settings.ok && Array.isArray(visaTypes) && visaTypes.length >= 10,
    `${visaTypes?.length ?? 0} statuses`,
  );
  assertStep(
    'student_visa maxWeeklyHours = 20',
    student?.maxWeeklyHours === 20,
    `got ${student?.maxWeeklyHours ?? 'missing'}`,
  );

  // 2. Employee list immigration label
  const list = await api('/employees?limit=100', token);
  const rows = (dataOf(list.json).rows ?? dataOf(list.json)) as unknown;
  const employees = Array.isArray(rows) ? rows : (Array.isArray(list.json) ? list.json : []);
  const withLabel = (employees as Array<{ visaTypeLabel?: string | null }>).filter((e) => e.visaTypeLabel);
  assertStep(
    'GET /employees — visaTypeLabel resolved',
    list.ok && withLabel.length > 0,
    `${withLabel.length} employees with label`,
  );

  const demoPd = await prisma.employeePersonalDetail.findFirst({
    where: { username: DEMO_USERNAME, deletedAt: null },
    include: { employee: { include: { employment: true } } },
  });
  const empId = demoPd?.employeeId;
  if (!empId) {
    console.error(`Demo employee ${DEMO_USERNAME} not found — run workforce demo seed first.`);
    process.exit(1);
  }
  console.log(`\nTest employee: ${DEMO_USERNAME} (${empId})\n`);

  await api(`/employees/${empId}/employment`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      visaTypeId: 'student_visa',
      weeklyHoursCapOverride: null,
      weeklyHoursCapOverrideReason: null,
      weeklyHoursCapOverrideExpiresAt: null,
      contractedWeeklyHours: 20,
      maximumWeeklyHours: 20,
      minimumWeeklyHours: 16,
    }),
  });

  const employmentGet = await api(`/employees/${empId}/employment`, token);
  assertStep('GET /employees/{id}/employment', employmentGet.ok);

  // 3. Reject hours above status cap (no override)
  const rejectHours = await api(`/employees/${empId}/employment`, token, {
    method: 'PATCH',
    body: JSON.stringify({ contractedWeeklyHours: 25, maximumWeeklyHours: 25 }),
  });
  assertStep(
    'PATCH employment — 25h without override blocked (400)',
    !rejectHours.ok && rejectHours.status === 400,
    messageOf(rejectHours.json),
  );

  // 4. Reject override without reason
  const rejectReason = await api(`/employees/${empId}/employment`, token, {
    method: 'PATCH',
    body: JSON.stringify({ weeklyHoursCapOverride: 30 }),
  });
  assertStep(
    'PATCH employment — override without reason blocked (400)',
    !rejectReason.ok && rejectReason.status === 400,
    messageOf(rejectReason.json),
  );

  // 5. Approve override + higher contracted hours
  const approve = await api(`/employees/${empId}/employment`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      visaTypeId: 'student_visa',
      weeklyHoursCapOverride: 30,
      weeklyHoursCapOverrideReason: 'Probe script — approved holiday cover',
      contractedWeeklyHours: 28,
      maximumWeeklyHours: 30,
    }),
  });
  assertStep(
    'PATCH employment — override 30h + reason + 28h contracted',
    approve.ok,
    messageOf(approve.json),
  );

  const afterOverride = await api(`/employees/${empId}/employment`, token);
  const empData = dataOf(afterOverride.json);
  assertStep(
    'GET employment — override persisted',
    empData.weeklyHoursCapOverride === 30 &&
      empData.contractedWeeklyHours === 28 &&
      typeof empData.weeklyHoursCapOverrideReason === 'string',
    `override=${empData.weeklyHoursCapOverride} contracted=${empData.contractedWeeklyHours}`,
  );

  // 6. Roster immigration warning (low cap + allocate job with spare capacity)
  const weekStart = new Date();
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
  weekStart.setUTCHours(0, 0, 0, 0);

  await api(`/employees/${empId}/employment`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      weeklyHoursCapOverride: 1,
      weeklyHoursCapOverrideReason: 'Probe script — temporary low cap for roster warning test',
      weeklyHoursCapOverrideExpiresAt: null,
      contractedWeeklyHours: 1,
      maximumWeeklyHours: 1,
    }),
  });

  const activeStatuses = ['PENDING_CONFIRMATION', 'ALLOCATED', 'CONFIRMED'] as const;
  const rangeStart = new Date(weekStart);
  const rangeEnd = new Date(weekStart);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 28);

  const rangeJobs = await prisma.scheduledJob.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      scheduledStartDateTime: { gte: rangeStart, lt: rangeEnd },
    },
    include: {
      allocations: {
        where: {
          deletedAt: null,
          isActive: true,
          status: { in: [...activeStatuses] },
        },
      },
    },
    orderBy: { scheduledStartDateTime: 'asc' },
    take: 500,
  });

  const job =
    rangeJobs.find((j) => {
      if (j.allocations.some((a) => a.employeeId === empId)) return false;
      if (j.allocations.length >= j.requiredCarers) return false;
      const start = j.scheduledStartDateTime;
      const end =
        j.scheduledEndDateTime ??
        new Date(start.getTime() + (j.estimatedDurationMinutes ?? 60) * 60_000);
      const hours = (end.getTime() - start.getTime()) / 3_600_000;
      return hours >= 2;
    }) ?? (await createProbeJob(weekStart));

  let probeJobCreated = false;
  if (job && job.jobName.startsWith('PROBE immigration hours')) {
    probeJobCreated = true;
  }

  if (job) {
    const allocate = await api(`/scheduled-jobs/${job.id}/allocate`, token, {
      method: 'POST',
      body: JSON.stringify({ employeeId: empId }),
    });
    const allocRoot = asRecord(allocate.json);
    const warnings = (
      Array.isArray(allocRoot.warnings)
        ? allocRoot.warnings
        : Array.isArray(asRecord(allocRoot.data).warnings)
          ? asRecord(allocRoot.data).warnings
          : []
    ) as Array<{ type?: string; message?: string }>;
    const immigrationWarn = warnings?.some((w) => w.type === 'IMMIGRATION_HOURS_EXCEEDED');
    assertStep(
      'POST /scheduled-jobs/{id}/allocate — IMMIGRATION_HOURS_EXCEEDED warning',
      allocate.ok && immigrationWarn === true,
      warnings?.map((w) => w.type).join(', ') ?? messageOf(allocate.json),
    );

    if (allocate.ok) {
      await api(`/scheduled-jobs/${job.id}/unallocate`, token, {
        method: 'POST',
        body: JSON.stringify({ employeeId: empId }),
      });
    }
    if (probeJobCreated) {
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: { deletedAt: new Date(), isActive: false },
      });
    }
  } else {
    console.log(
      'SKIP  POST allocate — no open scheduled job (2h+, spare capacity) in next 28 days',
    );
  }

  // 7. Restore demo defaults
  const restore = await api(`/employees/${empId}/employment`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      visaTypeId: 'student_visa',
      weeklyHoursCapOverride: null,
      weeklyHoursCapOverrideReason: null,
      weeklyHoursCapOverrideExpiresAt: null,
      contractedWeeklyHours: 20,
      maximumWeeklyHours: 20,
      minimumWeeklyHours: 16,
    }),
  });
  assertStep('PATCH employment — restore student defaults', restore.ok, messageOf(restore.json));

  console.log('\nDone. Swagger UI:', `${BASE}/api/docs`);
  console.log('Export OpenAPI: npm run openapi:export');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
