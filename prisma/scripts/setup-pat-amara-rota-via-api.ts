/**
 * End-to-end Pat + Amara rota test via HTTP API only (no direct DB writes).
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/setup-pat-amara-rota-via-api.ts
 */
const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.PROBE_EMAIL ?? 'admin@careadmin.local';
const PASS = process.env.PROBE_PASSWORD ?? 'Admin@12345';

const AMARA_ID = '70e5b38b-fd79-4d94-865c-f343b643de85';
const PAT_ID = '28699cc0-b6eb-41e2-b806-ca216c34d485';

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

function utcMondayIso(d = new Date()): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Next Mon–Fri on or after iso (visit plan is weekdays only). */
function nextWeekdayIso(iso: string): string {
  let d = iso;
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(`${d}T12:00:00.000Z`).getUTCDay();
    if (day >= 1 && day <= 5) return d;
    d = addDaysIso(d, 1);
  }
  return iso;
}

async function api<T = unknown>(
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

function dayRow(weekInCycle: number, dayOfWeek: (typeof DAYS)[number]) {
  const isWeekday = !['SATURDAY', 'SUNDAY'].includes(dayOfWeek);
  return {
    weekInCycle,
    dayOfWeek,
    startTime: isWeekday ? '09:00' : undefined,
    endTime: isWeekday ? '17:00' : undefined,
    isAvailable: isWeekday,
  };
}

async function setAmaraFortnightPattern(token: string) {
  const anchor = utcMondayIso();
  const weeks = [];
  for (const weekInCycle of [1, 2] as const) {
    for (const dayOfWeek of DAYS) {
      weeks.push(dayRow(weekInCycle, dayOfWeek));
    }
  }
  const { ok, json } = await api(
    `/employees/${AMARA_ID}/working-patterns/bulk`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify({ cycleWeeks: 2, cycleAnchorDate: anchor, weeks }),
    },
  );
  if (!ok) {
    console.error('Failed to set working pattern', json);
    process.exit(1);
  }
  console.log(`Amara fortnight pattern saved (Mon–Fri 09:00–17:00 both weeks, anchor ${anchor})`);
}

async function clearPatViaApi(token: string) {
  const plansRes = await api<{ data?: Array<{ id: string; status: string }> }>(
    `/service-users/${PAT_ID}/visit-plans`,
    token,
  );
  const plans = plansRes.json.data ?? [];

  for (const plan of plans) {
    if (plan.status === 'ACTIVE' || plan.status === 'SUSPENDED') {
      const { ok, json } = await api(
        `/service-users/${PAT_ID}/visit-plans/${plan.id}/end`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            reason: 'API test reset — clearing visits for rota verification',
            cancelFutureVisits: true,
          }),
        },
      );
      console.log(`Ended plan ${plan.id} (${plan.status}):`, ok ? 'ok' : json);
    }
  }

  let page = 1;
  let deleted = 0;
  for (;;) {
    const { json } = await api<{ data?: Array<{ id: string }>; meta?: { totalPages?: number } }>(
      `/scheduled-jobs?serviceUserId=${PAT_ID}&limit=100&page=${page}`,
      token,
    );
    const jobs = json.data ?? [];
    if (!jobs.length) break;
    for (const job of jobs) {
      const del = await api(`/scheduled-jobs/${job.id}`, token, { method: 'DELETE' });
      if (del.ok) deleted += 1;
    }
    if ((json.meta?.totalPages ?? 1) <= page) break;
    page += 1;
  }
  console.log(`Deleted ${deleted} scheduled job(s) for Pat via API`);
}

async function createActivateGenerate(token: string) {
  const today = new Date().toISOString().slice(0, 10);
  const toDate = addDaysIso(today, 13);

  const createBody = {
    effectiveFrom: today,
    weeklyContractedHours: '7',
    numberOfCarers: 1,
    slots: [
      {
        slotCode: 'MORNING',
        daysOfWeek: [1, 2, 3, 4, 5],
        plannedStartTime: '09:00',
        plannedEndTime: '10:00',
        requiredCarers: 1,
        isEnabled: true,
        assignedEmployeeIds: [AMARA_ID],
        scheduleFrequency: 'WEEKLY',
      },
    ],
  };

  const created = await api<{ data?: { id: string } }>(
    `/service-users/${PAT_ID}/visit-plans`,
    token,
    { method: 'POST', body: JSON.stringify(createBody) },
  );
  const planId = created.json.data?.id;
  if (!created.ok || !planId) {
    console.error('Create visit plan failed', created.json);
    process.exit(1);
  }
  console.log('Created draft plan:', planId);

  const activated = await api(
    `/service-users/${PAT_ID}/visit-plans/${planId}/activate`,
    token,
    { method: 'POST', body: JSON.stringify({ cancelEndedPlanJobs: true }) },
  );
  if (!activated.ok) {
    console.error('Activate failed', activated.json);
    process.exit(1);
  }
  console.log('Plan activated');

  const generated = await api<{ data?: { createdJobs?: number; jobs?: unknown[] } }>(
    `/service-users/${PAT_ID}/visit-plans/${planId}/generate-schedule`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ fromDate: today, toDate }),
    },
  );
  if (!generated.ok) {
    console.error('Generate schedule failed', generated.json);
    process.exit(1);
  }
  console.log('Generate schedule response:', JSON.stringify(generated.json, null, 2));

  return { planId, today, toDate };
}

async function verifyRota(token: string, sampleDate: string) {
  const jobsRes = await api<{ data?: Array<{ id: string; status: string; scheduledStartDateTime?: string; allocations?: unknown[] }> }>(
    `/scheduled-jobs?serviceUserId=${PAT_ID}&dateFrom=${sampleDate}T00:00:00.000Z&dateTo=${addDaysIso(sampleDate, 1)}T23:59:59.999Z&limit=20`,
    token,
  );
  console.log('\n--- Pat jobs on', sampleDate, '---');
  for (const job of jobsRes.json.data ?? []) {
    console.log(job.id, job.status, job.scheduledStartDateTime, 'allocations:', job.allocations?.length ?? 0);
  }

  const dayRes = await api<{
    data?: {
      date: string;
      employees: Array<{
        employee: { id: string; firstName?: string; lastName?: string };
        dayPattern?: { isAvailable: boolean; startTime: string | null; endTime: string | null; isPartial: boolean } | null;
        allocations: Array<{ status: string; job: { id: string; jobName?: string } }>;
      }>;
    };
  }>(
    `/schedule-timelines/employees/day?date=${sampleDate}&employeeIds=${AMARA_ID}&limit=10`,
    token,
  );

  const row = dayRes.json.data?.employees?.[0];
  console.log('\n--- Amara rota day row on', sampleDate, '---');
  console.log('dayPattern:', row?.dayPattern ?? null);
  console.log(
    'allocations:',
    row?.allocations?.map((a) => ({ status: a.status, jobId: a.job.id, jobName: a.job.jobName })) ?? [],
  );
}

async function main() {
  console.log('API base:', BASE);
  const token = await login();
  await setAmaraFortnightPattern(token);
  await clearPatViaApi(token);
  const { today } = await createActivateGenerate(token);
  const verifyDate = nextWeekdayIso(today);
  await verifyRota(token, verifyDate);
  console.log('\nDone. Open Schedule Jobs day view for', verifyDate, 'to confirm UI.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
