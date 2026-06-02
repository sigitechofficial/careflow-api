/**
 * Login + download MAR PDF export.
 * Usage: npx ts-node --transpile-only prisma/scripts/probe-mar-export-pdf.ts [serviceUserId] [YYYY-MM]
 */
const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const SU = process.argv[2] ?? 'ea274b6c-9a8a-4bc1-b6c5-27e7c4bd5fdd';
const MONTH = process.argv[3] ?? '2026-05';
const EMAIL = process.env.PROBE_EMAIL ?? 'admin@careadmin.local';
const PASS = process.env.PROBE_PASSWORD ?? 'Admin@12345';

async function main() {
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const loginJson = await loginRes.json();
  if (!loginRes.ok) {
    console.error('Login failed', loginRes.status, loginJson);
    process.exit(1);
  }
  const token = loginJson.data?.accessToken ?? loginJson.accessToken;
  const url = `${BASE}/service-users/${SU}/medication-chart/regular/export?month=${MONTH}&format=pdf`;
  console.log('GET', url);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') ?? '';
  console.log('status', res.status, 'content-type', ct, 'bytes', buf.length);
  if (!res.ok) {
    console.error(buf.toString('utf8').slice(0, 800));
    process.exit(1);
  }
  const magic = buf.subarray(0, 5).toString('ascii');
  if (!magic.startsWith('%PDF')) {
    console.error('Not a PDF. First 200 chars:', buf.toString('utf8').slice(0, 200));
    process.exit(1);
  }
  console.log('OK — valid PDF header', magic);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
