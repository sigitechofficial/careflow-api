const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
const SU = process.argv[2] ?? 'ea274b6c-9a8a-4bc1-b6c5-27e7c4bd5fdd';

async function main() {
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@careadmin.local', password: 'Admin@12345' }),
  });
  const loginJson = await loginRes.json();
  const token = loginJson.data?.accessToken;
  if (!token) {
    console.error('Login failed', loginRes.status, loginJson);
    process.exit(1);
  }

  const month = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);
  const chartRes = await fetch(
    `${BASE}/service-users/${SU}/medication-chart/regular?month=${month}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const chartJson = await chartRes.json();
  if (!chartRes.ok) {
    console.error('Chart failed', chartRes.status, chartJson);
    process.exit(1);
  }

  const data = chartJson.data;
  console.log('month:', month, 'today (UTC):', today);
  console.log('summary:', JSON.stringify(data.summary));
  console.log('todayDay from chart:', data.dayDates?.indexOf(today) + 1);

  const rows = data.medications ?? [];
  for (const m of rows) {
    if (!String(m.medicationName).includes('Amlodipine')) continue;
    const todayCell = m.days?.find((c: { date: string }) => c.date === today);
    console.log('\nAmlodipine row:', {
      medicationId: m.medicationId,
      timeSlot: m.timeSlot,
      dueTime: m.dueTime,
      scheduleType: m.scheduleType,
      todayCell,
    });
  }

  const dueToday = rows.filter((m: { days: { date: string; cellState: string }[] }) => {
    const c = m.days?.find(d => d.date === today);
    return c?.cellState === 'due';
  });
  console.log('\nAll due today (' + dueToday.length + '):');
  for (const m of dueToday) {
    console.log(' -', m.medicationName, m.timeSlot, m.dueTime);
  }

  const recordedToday = rows.filter((m: { days: { date: string; cellState: string }[] }) => {
    const c = m.days?.find(d => d.date === today);
    return c?.cellState === 'recorded';
  });
  const amloRecorded = recordedToday.filter((m: { medicationName: string }) =>
    m.medicationName.includes('Amlodipine'),
  );
  if (amloRecorded.length) {
    console.log('\nAmlodipine RECORDED today (not in due count):');
    for (const m of amloRecorded) {
      const c = m.days.find((d: { date: string }) => d.date === today);
      console.log(' -', m.timeSlot, c?.statusCode, c?.statusLabel);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
