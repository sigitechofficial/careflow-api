const PAT = '28699cc0-b6eb-41e2-b806-ca216c34d485';
const AMARA = '70e5b38b-fd79-4d94-865c-f343b643de85';

async function main() {
  const login = await fetch('http://localhost:3000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@careadmin.local', password: 'Admin@12345' }),
  });
  const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
  const headers = { Authorization: `Bearer ${token}` };

  const active = await fetch(`http://localhost:3000/service-users/${PAT}/visit-plans/active`, { headers });
  const plan = ((await active.json()) as { data?: { id: string; status: string; slots?: unknown[] } }).data;
  if (!plan) {
    console.log('No active plan');
    return;
  }
  const morning = (plan.slots as Array<{ slotCode: string; isEnabled: boolean; assignedEmployeeIds?: string[] }>)?.find(
    (s) => s.slotCode === 'MORNING' && s.isEnabled,
  );
  const jobs = await fetch(`http://localhost:3000/scheduled-jobs?serviceUserId=${PAT}&limit=1`, { headers });
  const jobsMeta = ((await jobs.json()) as { meta?: { total?: number } }).meta;

  console.log('Active plan:', plan.id, plan.status);
  console.log('Amara on enabled Morning slot:', morning?.assignedEmployeeIds?.includes(AMARA) ?? false);
  console.log('Pat scheduled jobs in system:', jobsMeta?.total ?? 0);
}

main();
