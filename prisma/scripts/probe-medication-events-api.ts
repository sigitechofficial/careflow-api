/**
 * Probe medication-events list API (medicationIds query param).
 */
const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const SU = process.argv[2] ?? 'ea274b6c-9a8a-4bc1-b6c5-27e7c4bd5fdd';
const EMAIL = process.env.PROBE_EMAIL ?? 'admin@careadmin.local';
const PASS = process.env.PROBE_PASSWORD ?? 'Admin@12345';

async function main() {
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const loginJson = await loginRes.json();
  const token = loginJson.data?.accessToken;
  if (!token) {
    console.error('Login failed', loginRes.status, loginJson);
    process.exit(1);
  }

  const supplyRes = await fetch(`${BASE}/service-users/${SU}/medication-supply`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const supplyJson = await supplyRes.json();
  const meds = supplyJson.data?.medications ?? supplyJson.medications ?? [];
  const ator = meds.find((m: { medicationName: string }) => m.medicationName.includes('Atorvastatin'));
  console.log('Ator card:', ator?.medicationId, 'related:', ator?.relatedMedicationIds);

  const id1 = ator?.medicationId ?? 'fed52e0a-8585-44a2-8c31-a69248c5bc45';
  const related: string[] = ator?.relatedMedicationIds ?? [id1];
  const qs = new URLSearchParams({
    page: '1',
    limit: '30',
    medicationIds: related.join(','),
  });

  const url = `${BASE}/service-users/${SU}/medication-events?${qs}`;
  console.log('GET', url);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  console.log('Status:', res.status);
  console.log('Message:', json.message);
  console.log('Errors:', json.errors);
  console.log('Count:', json.data?.length ?? json.meta?.total);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
