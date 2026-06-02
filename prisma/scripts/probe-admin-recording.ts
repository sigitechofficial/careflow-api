/**
 * Verify admin user can record MAR (direct, on-behalf), PRN, correct, and log delivery.
 */
const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
const SU = process.argv[2] ?? 'ea274b6c-9a8a-4bc1-b6c5-27e7c4bd5fdd';
const EMAIL = process.env.PROBE_EMAIL ?? 'admin@careadmin.local';
const PASS = process.env.PROBE_PASSWORD ?? 'Admin@12345';

async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login ${r.status} ${JSON.stringify(j)}`);
  const token = j.data?.accessToken as string;
  const meRes = await fetch(`${BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meJson = await meRes.json();
  const perms: string[] =
    meJson.data?.permissions ?? meJson.data?.user?.permissions ?? meJson.permissions ?? [];
  return { token, perms };
}

async function api(token: string, path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const j = await r.json();
  return { ok: r.ok, status: r.status, j };
}

type ChartMed = {
  medicationId: string;
  medicationName: string;
  medicationKind: string;
  scheduleId?: string;
  dueTime?: string | null;
  cells?: { day: number; date: string; cellState: string; recordId: string | null }[];
};

function findDueCell(meds: ChartMed[], excludeMedId?: string) {
  for (const m of meds) {
    if (m.medicationKind === 'PRN') continue;
    if (excludeMedId && m.medicationId === excludeMedId) continue;
    for (const cell of m.cells ?? []) {
      if (cell.cellState === 'due' && !cell.recordId) {
        return { med: m, cell };
      }
    }
  }
  return null;
}

async function main() {
  const { token, perms } = await login();
  const medPerms = perms.filter(
    k => k.includes('medication') || k === 'service_users.update' || k.includes('service_users.medications'),
  );
  console.log('Admin medication-related permissions:', medPerms.sort().join(', ') || '(none listed)');

  const canPost =
    perms.includes('service_users.medications.administer') ||
    perms.includes('service_users.medications.update') ||
    perms.includes('service_users.update');
  console.log('Can POST administration (by permission):', canPost);

  const chart = await api(token, `/service-users/${SU}/medication-chart/regular?month=2026-05`);
  if (!chart.ok) {
    console.error('Chart failed', chart.status, chart.j);
    process.exit(1);
  }
  const meds: ChartMed[] = chart.j.data?.medications ?? [];
  let dueCount = 0;
  for (const m of meds) {
    for (const cell of m.cells ?? []) {
      if (cell.cellState === 'due' && !cell.recordId) dueCount++;
    }
  }
  console.log(`Chart: ${meds.length} rows, ${dueCount} empty due cells`);

  const target = findDueCell(meds);
  if (!target) {
    console.log('No empty due cell — trying spare schedule slots on last chart days');
    const regMed = meds.find(m => m.medicationKind !== 'PRN' && m.scheduleId);
    if (regMed) {
      const lastCell = regMed.cells?.[regMed.cells.length - 1];
      if (lastCell) {
        for (const dayOffset of [26, 25, 24]) {
          const d = `2026-05-${String(dayOffset).padStart(2, '0')}`;
          const schedDt = `${d}T${regMed.dueTime ?? '12:00'}:00.000Z`;
          const direct = await api(token, `/service-users/${SU}/medication-events`, {
            method: 'POST',
            body: JSON.stringify({
              serviceUserMedicationId: regMed.medicationId,
              medicationScheduleId: regMed.scheduleId,
              statusCode: 'G',
              scheduledDateTime: schedDt,
              actualDateTime: new Date().toISOString(),
              notes: `probe admin direct ${d}`,
            }),
          });
          console.log(`1 Admin direct (${d}):`, direct.status, direct.j.message ?? direct.j.data?.id);
          if (direct.ok) break;
        }
        const emps = await api(token, '/employees?page=1&limit=1');
        const empId = emps.j.data?.rows?.[0]?.id;
        if (empId) {
          const d = '2026-05-23';
          const onBehalf = await api(token, `/service-users/${SU}/medication-events`, {
            method: 'POST',
            body: JSON.stringify({
              serviceUserMedicationId: regMed.medicationId,
              medicationScheduleId: regMed.scheduleId,
              statusCode: 'R',
              scheduledDateTime: `${d}T${regMed.dueTime ?? '12:00'}:00.000Z`,
              actualDateTime: new Date().toISOString(),
              reason: 'probe refused',
              recordOnBehalfOfCarer: true,
              administeredById: empId,
            }),
          });
          console.log('2 On behalf (2026-05-23):', onBehalf.status, onBehalf.j.message ?? onBehalf.j.data?.id);
          if (onBehalf.ok) {
            const ev = onBehalf.j.data;
            console.log(
              `   administeredBy=${ev?.administeredBy?.id} enteredBy=${ev?.enteredBy?.id} createdBy=${ev?.createdById}`,
            );
          }
        }
      }
      const prnMed = meds.find(m => m.medicationKind === 'PRN');
      if (prnMed) {
        const prn = await api(token, `/service-users/${SU}/medication-events`, {
          method: 'POST',
          body: JSON.stringify({
            serviceUserMedicationId: prnMed.medicationId,
            statusCode: 'G',
            scheduledDateTime: '2026-05-22T14:00:00.000Z',
            actualDateTime: new Date().toISOString(),
            isPrn: true,
            prnReason: 'probe pain',
            doseGiven: '1 tab',
          }),
        });
        console.log('3 PRN:', prn.status, prn.j.message ?? prn.j.data?.id);
      }
    }
    console.log('— also testing correct + delivery on existing data');
    const events = await api(token, `/service-users/${SU}/medication-events?page=1&limit=3`);
    const evId = events.j.data?.[0]?.id;
    if (evId) {
      const patch = await api(token, `/service-users/${SU}/medication-events/${evId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          correctionNotes: 'probe admin patch only',
        }),
      });
      console.log('4 Correct (existing):', patch.status, patch.j.message ?? patch.j.data?.correctionNotes);
    }
    const supply = await api(token, `/service-users/${SU}/medication-supply`);
    const card = supply.j.data?.medications?.[0];
    if (card) {
      const del = await api(token, `/service-users/${SU}/medication-supply/deliveries`, {
        method: 'POST',
        body: JSON.stringify({
          serviceUserMedicationId: card.medicationId,
          quantity: 7,
          deliveredAt: new Date().toISOString(),
          notes: 'probe delivery',
        }),
      });
      console.log('5 Log delivery:', del.status, del.j.message ?? del.j.data?.id);
    }
    return;
  }

  const schedDt = `${target.cell.date}T${target.med.dueTime ?? '12:00'}:00.000Z`;
  console.log(`\nTarget: ${target.med.medicationName} day ${target.cell.day}`);

  const adminDirect = await api(token, `/service-users/${SU}/medication-events`, {
    method: 'POST',
    body: JSON.stringify({
      serviceUserMedicationId: target.med.medicationId,
      medicationScheduleId: target.med.scheduleId,
      statusCode: 'G',
      scheduledDateTime: schedDt,
      actualDateTime: new Date().toISOString(),
      notes: 'probe admin direct',
    }),
  });
  console.log('1 Admin direct:', adminDirect.status, adminDirect.j.message ?? adminDirect.j.data?.id);
  if (!adminDirect.ok) console.log('   ', JSON.stringify(adminDirect.j.errors ?? adminDirect.j));

  const emps = await api(token, '/employees?page=1&limit=5');
  const empId = emps.j.data?.rows?.[0]?.id;
  const target2 = findDueCell(meds, target.med.medicationId);
  if (target2 && empId) {
    const schedDt2 = `${target2.cell.date}T${target2.med.dueTime ?? '12:00'}:00.000Z`;
    const onBehalf = await api(token, `/service-users/${SU}/medication-events`, {
      method: 'POST',
      body: JSON.stringify({
        serviceUserMedicationId: target2.med.medicationId,
        medicationScheduleId: target2.med.scheduleId,
        statusCode: 'R',
        scheduledDateTime: schedDt2,
        actualDateTime: new Date().toISOString(),
        reason: 'probe refused',
        recordOnBehalfOfCarer: true,
        administeredById: empId,
      }),
    });
    console.log('2 On behalf:', onBehalf.status, onBehalf.j.message ?? onBehalf.j.data?.id);
    if (onBehalf.ok) {
      const ev = onBehalf.j.data;
      console.log(
        `   administeredBy=${ev?.administeredBy?.id ?? ev?.administeredById} enteredBy=${ev?.enteredBy?.id ?? ev?.enteredById}`,
      );
    }
  } else {
    console.log('2 On behalf: skipped (no second cell or employee)');
  }

  const prnMed = meds.find(m => m.medicationKind === 'PRN');
  if (prnMed) {
    const prnCell = prnMed.cells?.find(c => c.cellState === 'due') ?? prnMed.cells?.[0];
    const prnDate = prnCell?.date ?? target.cell.date;
    const prn = await api(token, `/service-users/${SU}/medication-events`, {
      method: 'POST',
      body: JSON.stringify({
        serviceUserMedicationId: prnMed.medicationId,
        statusCode: 'G',
        scheduledDateTime: `${prnDate}T12:00:00.000Z`,
        actualDateTime: new Date().toISOString(),
        isPrn: true,
        prnReason: 'probe pain',
        doseGiven: '1 tab',
      }),
    });
    console.log('3 PRN:', prn.status, prn.j.message ?? prn.j.data?.id);
  }

  if (adminDirect.ok && adminDirect.j.data?.id) {
    const patch = await api(token, `/service-users/${SU}/medication-events/${adminDirect.j.data.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        statusCode: 'N',
        reason: 'probe correction',
        correctionNotes: 'admin corrected',
      }),
    });
    console.log(
      '4 Correct:',
      patch.status,
      patch.j.data?.statusCode,
      patch.j.data?.correctionNotes?.slice(0, 40),
    );
  }

  const supply = await api(token, `/service-users/${SU}/medication-supply`);
  const card = supply.j.data?.medications?.[0];
  if (card) {
    const del = await api(token, `/service-users/${SU}/medication-supply/deliveries`, {
      method: 'POST',
      body: JSON.stringify({
        serviceUserMedicationId: card.medicationId,
        quantity: 7,
        deliveredAt: new Date().toISOString(),
        notes: 'probe delivery',
      }),
    });
    console.log('5 Log delivery:', del.status, del.j.message ?? del.j.data?.id);
  }

  console.log('\nDone — admin recording paths exercised.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
