const PAT = '28699cc0-b6eb-41e2-b806-ca216c34d485';
const AMARA = '70e5b38b-fd79-4d94-865c-f343b643de85';
const DATE = '2026-06-24';

async function main() {
  const login = await fetch('http://localhost:3000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@careadmin.local', password: 'Admin@12345' }),
  });
  const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
  const headers = { Authorization: `Bearer ${token}` };

  const active = await fetch(`http://localhost:3000/service-users/${PAT}/visit-plans/active`, { headers });
  const plan = ((await active.json()) as { data?: { slots?: Array<{ slotCode: string; isEnabled: boolean; assignedEmployeeIds?: string[]; carerAssignments?: Array<{ employeeId: string }> }> } }).data;
  const morning = plan?.slots?.find((s) => s.slotCode === 'MORNING' && s.isEnabled);
  console.log('Plan carers (Morning):', morning?.assignedEmployeeIds);
  console.log('Carer assignments:', morning?.carerAssignments?.map((a) => a.employeeId));

  const jobsRes = await fetch(
    `http://localhost:3000/scheduled-jobs?serviceUserId=${PAT}&dateFrom=${DATE}T00:00:00.000Z&dateTo=${DATE}T23:59:59.999Z&limit=10`,
    { headers },
  );
  const jobs = ((await jobsRes.json()) as { data: Array<{ id: string; status: string; jobName: string; scheduledStartDateTime: string }> }).data ?? [];
  for (const job of jobs) {
    console.log('Job:', job.jobName, job.status, job.scheduledStartDateTime);
    const allocs = await fetch(`http://localhost:3000/scheduled-jobs/${job.id}/allocations`, { headers });
    const allocData = ((await allocs.json()) as { data: Array<{ employeeId: string; status: string; employee?: { personalDetail?: { firstName: string; lastName: string } } }> }).data ?? [];
    console.log('  Allocations:', allocData.length, allocData.map((a) => `${a.employee?.personalDetail?.firstName} ${a.employee?.personalDetail?.lastName} (${a.status})`));
  }
}

main();
