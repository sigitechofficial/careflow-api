const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const PAT_ID = '28699cc0-b6eb-41e2-b806-ca216c34d485';
const AMARA_ID = '70e5b38b-fd79-4d94-865c-f343b643de85';
const DATE = '2026-06-24';

async function main() {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@careadmin.local', password: 'Admin@12345' }),
  });
  const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
  const headers = { Authorization: `Bearer ${token}` };

  const plansRes = await fetch(`${BASE}/service-users/${PAT_ID}/visit-plans`, { headers });
  const plans = ((await plansRes.json()) as { data: unknown[] }).data;
  console.log('Visit plans count:', plans.length);
  console.log(JSON.stringify(plans, null, 2));

  const activeRes = await fetch(`${BASE}/service-users/${PAT_ID}/visit-plans/active`, { headers });
  console.log('Active plan:', JSON.stringify(await activeRes.json(), null, 2));

  const jobsRes = await fetch(
    `${BASE}/scheduled-jobs?serviceUserId=${PAT_ID}&dateFrom=${DATE}T00:00:00.000Z&dateTo=${DATE}T23:59:59.999Z&limit=10`,
    { headers },
  );
  const jobsJson = await jobsRes.json();
  console.log('Jobs on', DATE, ':', JSON.stringify(jobsJson, null, 2));

  for (const job of (jobsJson as { data: { id: string }[] }).data ?? []) {
    const allocs = await fetch(`${BASE}/scheduled-jobs/${job.id}/allocations`, { headers });
    console.log('Allocations for', job.id, ':', JSON.stringify(await allocs.json(), null, 2));
  }

  const wp = await fetch(`${BASE}/employees/${AMARA_ID}/working-patterns`, { headers });
  console.log('Amara patterns:', JSON.stringify(await wp.json(), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
