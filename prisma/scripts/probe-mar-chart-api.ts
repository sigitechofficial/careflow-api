/**
 * Login + fetch MAR chart API and print supplyByMedicationId.
 * Usage: npx ts-node --transpile-only prisma/scripts/probe-mar-chart-api.ts [serviceUserId]
 */
const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const SU = process.argv[2] ?? 'ea274b6c-9a8a-4bc1-b6c5-27e7c4bd5fdd';
const EMAIL = process.env.PROBE_EMAIL ?? 'admin@careadmin.local';
const PASS = process.env.PROBE_PASSWORD ?? 'Admin@12345';

function monthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  console.log('API base:', BASE);
  console.log('Service user:', SU);

  let loginRes: Response;
  try {
    loginRes = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASS }),
    });
  } catch (e) {
    console.error('Cannot reach backend at', BASE, '- is npm run start running?');
    console.error(e);
    process.exit(1);
  }

  const loginJson = await loginRes.json();
  if (!loginRes.ok) {
    console.error('Login failed', loginRes.status, JSON.stringify(loginJson, null, 2));
    process.exit(1);
  }

  const token = loginJson.data?.accessToken ?? loginJson.accessToken;
  if (!token) {
    console.error('No accessToken in login response', loginJson);
    process.exit(1);
  }
  console.log('Login OK');

  const month = monthKey();
  const url = `${BASE}/service-users/${SU}/medication-chart/regular?month=${month}`;
  console.log('GET', url);

  const chartRes = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const chartJson = await chartRes.json();
  if (!chartRes.ok) {
    console.error('Chart failed', chartRes.status, JSON.stringify(chartJson, null, 2));
    process.exit(1);
  }

  const data = chartJson.data ?? chartJson;
  console.log('\n--- Chart keys ---');
  console.log(Object.keys(data));

  const supply = data.supplyByMedicationId;
  console.log('\n--- supplyByMedicationId ---');
  if (!supply) {
    console.log('MISSING — backend may be running old code (restart required)');
  } else if (Object.keys(supply).length === 0) {
    console.log('EMPTY object {} — no deliveries or summaries computed');
  } else {
    console.log(JSON.stringify(supply, null, 2));
  }

  const atorRow = data.medications?.find((m: { medicationName: string }) =>
    m.medicationName?.includes('Atorvastatin'),
  );
  if (atorRow) {
    console.log('\nAtorvastatin medicationId:', atorRow.medicationId);
    console.log('Supply for that id:', JSON.stringify(supply?.[atorRow.medicationId] ?? null, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
