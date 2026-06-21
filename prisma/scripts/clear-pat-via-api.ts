/**
 * Clear Pat's visit plans (end active/suspended) and delete all scheduled jobs via API.
 * Usage: npx ts-node --transpile-only prisma/scripts/clear-pat-via-api.ts
 */
const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.PROBE_EMAIL ?? 'admin@careadmin.local';
const PASS = process.env.PROBE_PASSWORD ?? 'Admin@12345';
const PAT_ID = '28699cc0-b6eb-41e2-b806-ca216c34d485';
const AMARA_ID = '70e5b38b-fd79-4d94-865c-f343b643de85';

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

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log('API base:', BASE);
  const login = await api<{ data?: { accessToken?: string } }>('/auth/login', '', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const token = login.json.data?.accessToken;
  if (!token) {
    console.error('Login failed', login.json);
    process.exit(1);
  }

  const plansRes = await api<{ data?: Array<{ id: string; status: string }> }>(
    `/service-users/${PAT_ID}/visit-plans`,
    token,
  );
  const plans = plansRes.json.data ?? [];
  console.log(
    'Visit plans:',
    plans.map((p) => `${p.status} (${p.id})`).join(', ') || 'none',
  );

  for (const plan of plans) {
    if (plan.status === 'ACTIVE' || plan.status === 'SUSPENDED') {
      const { ok, json } = await api(
        `/service-users/${PAT_ID}/visit-plans/${plan.id}/end`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            reason: 'Clearing test data — user will redo setup manually',
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
      else console.log('Failed to delete job', job.id, del.json);
    }
    if ((json.meta?.totalPages ?? 1) <= page) break;
    page += 1;
  }
  console.log(`Deleted ${deleted} scheduled job(s) for Pat`);

  const today = new Date().toISOString().slice(0, 10);
  const jobsCheck = await api<{ data?: unknown[] }>(
    `/scheduled-jobs?serviceUserId=${PAT_ID}&dateFrom=${today}T00:00:00.000Z&dateTo=${addDaysIso(today, 14)}T23:59:59.999Z&limit=5`,
    token,
  );
  const plansAfter = await api<{ data?: Array<{ id: string; status: string }> }>(
    `/service-users/${PAT_ID}/visit-plans`,
    token,
  );
  const active = (plansAfter.json.data ?? []).filter(
    (p) => p.status === 'ACTIVE' || p.status === 'SUSPENDED',
  );

  console.log('Active/suspended plans remaining:', active.length);
  console.log('Scheduled jobs in next 14 days:', jobsCheck.json.data?.length ?? 0);

  const patternsBefore = await api<{ data?: unknown[] }>(
    `/employees/${AMARA_ID}/working-patterns`,
    token,
  );
  console.log('Amara working patterns before clear:', patternsBefore.json.data?.length ?? 0);

  const cleared = await api(`/employees/${AMARA_ID}/working-patterns/bulk`, token, {
    method: 'PUT',
    body: JSON.stringify({ cycleWeeks: 1, weeks: [] }),
  });
  if (!cleared.ok) {
    console.error('Failed to clear Amara working pattern', cleared.json);
    process.exit(1);
  }

  const employment = await api(`/employees/${AMARA_ID}/employment`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      workingPatternCycleWeeks: 1,
      workingPatternCycleAnchorDate: null,
    }),
  });
  if (!employment.ok) {
    console.log('Employment cycle reset note:', employment.json);
  }

  const patternsAfter = await api<{ data?: unknown[]; meta?: { cycleWeeks?: number; cycleAnchorDate?: string | null } }>(
    `/employees/${AMARA_ID}/working-patterns`,
    token,
  );
  console.log('Amara working patterns after clear:', patternsAfter.json.data?.length ?? 0);
  console.log('Amara cycle meta:', patternsAfter.json.meta ?? {});

  console.log('Done — Pat visits and Amara working pattern cleared.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
