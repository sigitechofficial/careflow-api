const PAT = '28699cc0-b6eb-41e2-b806-ca216c34d485';
const AMARA = '70e5b38b-fd79-4d94-865c-f343b643de85';
const CASEY = 'cb88d07b-4980-4497-a2b4-f84c22cfc9fa';
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
  const plan = ((await active.json()) as {
    data?: {
      slots?: Array<{
        slotCode: string;
        assignedEmployeeIds?: string[];
        carerAssignments?: Array<{ employeeId: string }>;
      }>;
    };
  }).data;
  const morning = plan?.slots?.find((s) => s.slotCode === 'MORNING');
  console.log('Visit plan Morning carers:', morning?.assignedEmployeeIds);

  const wp = await fetch(`http://localhost:3000/employees/${AMARA}/working-patterns`, { headers });
  const wpData = ((await wp.json()) as { data?: unknown }).data;
  console.log('Amara working patterns count:', Array.isArray(wpData) ? wpData.length : wpData);

  const timeline = await fetch(
    `http://localhost:3000/schedule-timelines/employees/day?date=${DATE}&employeeIds=${AMARA},${CASEY}&limit=10`,
    { headers },
  );
  const tl = ((await timeline.json()) as {
    data?: Array<{
      employee: { id: string; firstName?: string; lastName?: string };
      dayPattern?: unknown;
      allocations?: unknown[];
    }>;
  }).data;
  for (const row of tl ?? []) {
    console.log(
      'Timeline row:',
      row.employee.firstName,
      row.employee.lastName,
      'dayPattern:',
      row.dayPattern ? JSON.stringify(row.dayPattern) : 'null',
      'allocations:',
      row.allocations?.length ?? 0,
    );
  }

  const jobsRes = await fetch(
    `http://localhost:3000/scheduled-jobs?serviceUserId=${PAT}&dateFrom=${DATE}T00:00:00.000Z&dateTo=${DATE}T23:59:59.999Z`,
    { headers },
  );
  const jobs = ((await jobsRes.json()) as { data: Array<{ id: string; status: string }> }).data ?? [];
  for (const job of jobs) {
    const allocs = await fetch(`http://localhost:3000/scheduled-jobs/${job.id}/allocations`, { headers });
    const allocData =
      ((await allocs.json()) as { data: Array<{ employeeId: string; status: string }> }).data ?? [];
    console.log('Pat job', job.status, 'allocations:', allocData.map((a) => a.employeeId));
  }
}

main();
