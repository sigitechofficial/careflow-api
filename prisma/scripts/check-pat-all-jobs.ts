const PAT = '28699cc0-b6eb-41e2-b806-ca216c34d485';
const AMARA = '70e5b38b-fd79-4d94-865c-f343b643de85';
const CASEY = 'cb88d07b-4980-4497-a2b4-f84c22cfc9fa';

async function main() {
  const login = await fetch('http://localhost:3000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@careadmin.local', password: 'Admin@12345' }),
  });
  const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
  const headers = { Authorization: `Bearer ${token}` };

  const active = await fetch(`http://localhost:3000/service-users/${PAT}/visit-plans/active`, { headers });
  const plan = ((await active.json()) as {
    data?: {
      slots?: Array<{
        slotCode: string;
        isEnabled: boolean;
        assignedEmployeeIds?: string[];
        carerAssignments?: Array<{ employeeId: string; dayOfWeek: number | null }>;
      }>;
    };
  }).data;
  const morning = plan?.slots?.find((s) => s.slotCode === 'MORNING' && s.isEnabled);
  console.log('Plan Morning assignedEmployeeIds:', morning?.assignedEmployeeIds);
  console.log(
    'Plan carerAssignments:',
    morning?.carerAssignments?.map((a) => ({ employeeId: a.employeeId, dayOfWeek: a.dayOfWeek })),
  );

  const jobsRes = await fetch(`http://localhost:3000/scheduled-jobs?serviceUserId=${PAT}&limit=50`, { headers });
  const jobs =
    ((await jobsRes.json()) as {
      data: Array<{ id: string; status: string; scheduledStartDateTime: string }>;
    }).data ?? [];

  let allocated = 0;
  let unallocated = 0;
  let amaraCount = 0;
  let caseyCount = 0;

  for (const job of jobs) {
    const allocs = await fetch(`http://localhost:3000/scheduled-jobs/${job.id}/allocations`, { headers });
    const allocData =
      ((await allocs.json()) as { data: Array<{ employeeId: string; status: string; isActive?: boolean }> }).data ??
      [];
    const active = allocData.filter((a) => a.isActive !== false);
    if (job.status === 'ALLOCATED' || active.length >= 1) allocated += 1;
    else unallocated += 1;
    for (const a of active) {
      if (a.employeeId === AMARA) amaraCount += 1;
      if (a.employeeId === CASEY) caseyCount += 1;
    }
    const date = job.scheduledStartDateTime.slice(0, 10);
    console.log(`${date} ${job.status} alloc=${active.length} carers=${active.map((a) => a.employeeId).join(',')}`);
  }

  console.log('---');
  console.log(`Total jobs: ${jobs.length}, allocated-ish: ${allocated}, unallocated-ish: ${unallocated}`);
  console.log(`Amara allocations: ${amaraCount}, Casey allocations: ${caseyCount}`);
}

main();
