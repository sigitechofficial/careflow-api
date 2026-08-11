/**
 * Probe API-22 body-map on local/staging API.
 * Usage: node prisma/scripts/probe-body-map-api.mjs [--job=uuid]
 * Tests dedicated wizard API (GET wizard, POST wizard/records) + legacy routes.
 */
import { createHmac, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

function loadEnv() {
  try {
    const raw = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[m[1].trim()]) process.env[m[1].trim()] = val;
    }
  } catch {
    /* ignore */
  }
}

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${body}.${sig}`;
}

loadEnv();
const base = process.env.QA_API_BASE || 'http://127.0.0.1:3000';
const secret = process.env.JWT_ACCESS_TOKEN_SECRET;
if (!secret) {
  console.error('JWT_ACCESS_TOKEN_SECRET missing');
  process.exit(1);
}

const jobArg = process.argv.find((a) => a.startsWith('--job='));
const jobId =
  jobArg?.slice('--job='.length) ||
  '8d18d4f7-ff29-434f-8c40-0664bfeac574';

const prisma = new PrismaClient();
const portal = await prisma.employeePortalAccount.findFirst({
  where: { email: 'ema@gmail.com', deletedAt: null },
  select: { id: true, employeeId: true },
});
if (!portal) throw new Error('ema@gmail.com portal missing');

const now = Math.floor(Date.now() / 1000);
const token = signJwt(
  { sub: portal.id, typ: 'emp', employeeId: portal.employeeId, iat: now, exp: now + 3600 },
  secret,
);

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

async function get(path) {
  const res = await fetch(`${base}${path}`, { headers });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

const bm = await get(`/employee-app/visits/${jobId}/body-map`);
const wizard = await get(`/employee-app/visits/${jobId}/body-map/wizard`);
const det = await get(`/employee-app/visits/${jobId}/details`);

console.log(JSON.stringify({ apiBase: base, jobId, qaVisit: 'B (double-up)' }, null, 2));
console.log('GET body-map status', bm.status, bm.json?.error?.code ?? '');
console.log('GET body-map/wizard status', wizard.status, wizard.json?.error?.code ?? '');
console.log('GET wizard steps', wizard.json?.data?.wizard?.steps ?? null);
console.log('GET details embedded bodyMap', det.status, Boolean(det.json?.data?.bodyMap), Boolean(det.json?.data?.bodyMap?.wizard));

if (bm.status === 404 && wizard.status === 404) {
  console.log('Body map API not deployed on this base (404). Restart backend if you just added EmployeeAppBodyMapController.');
  await prisma.$disconnect();
  process.exit(0);
}

let canRecord = det.json?.data?.bodyMap?.canRecord;
if (!canRecord) {
  const ci = await post(`/employee-app/visits/${jobId}/check-in`, {
    method: 'MANUAL',
    identityConfirmed: true,
    deviceRecordedAt: new Date().toISOString(),
    idempotencyKey: `qa-bm-ci-${Date.now()}`,
  });
  console.log('check-in status', ci.status);
  const det2 = await get(`/employee-app/visits/${jobId}/details`);
  canRecord = det2.json?.data?.bodyMap?.canRecord;
}

const idem = `qa-bm-mobile-sample-${createHash('sha256').update(jobId).digest('hex').slice(0, 8)}`;
const postBody = {
  recordType: 'SKIN',
  bodyView: 'FRONT',
  side: 'LEFT',
  bodyPart: 'Left shoulder',
  xCoordinate: 38.5,
  yCoordinate: 22.1,
  description: 'QA mobile integration sample (safe to replay with same idempotencyKey)',
  riskLevel: 'MEDIUM',
  observationDetails: { recordView: 'front', canvasView: 'dual' },
  deviceRecordedAt: new Date().toISOString(),
  idempotencyKey: idem,
};

const wizardPost = {
  marker: {
    recordView: 'front',
    canvasView: 'dual',
    x: 13.7,
    y: 42.7,
    bodyPart: 'Forearm',
    side: 'Right',
    regionId: 'right-arm-lower-front',
    summaryLabel: 'Front · Forearm · Front (13.7%, 42.7%)',
  },
  type: {
    purpose: 'New observation',
    recordType: 'INJURY',
    subType: 'Bruise',
    firstNoticedAt: new Date().toISOString(),
    noticedDuring: 'Visit',
  },
  location: {
    bodyPart: 'Forearm',
    side: 'Right',
    specificLocation: 'Front · Forearm · Front (13.7%, 42.7%)',
  },
  observation: {
    description: 'QA wizard mobile sample bruise',
    painLevel: 7,
    skinIntact: 'Intact',
    riskLevel: 'MEDIUM',
  },
  cause: {
    causeKnown: 'yes',
    consistentWithInjury: 'yes',
    causeSummary: 'Knocked arm on door frame',
  },
  action: {
    managerInformed: 'Yes',
    reviewRequired: 'yes',
    nextReviewAt: new Date(Date.now() + 86400000).toISOString(),
    actionSummary: 'Cold compress applied; monitor next visit',
  },
  deviceRecordedAt: new Date().toISOString(),
  idempotencyKey: `bm-wizard-${createHash('sha256').update(jobId).digest('hex').slice(0, 8)}`,
};

const wizardRes = await post(`/employee-app/visits/${jobId}/body-map/wizard/records`, wizardPost);
console.log('POST wizard/records status', wizardRes.status);
console.log('SAMPLE_WIZARD_POST_RESPONSE', JSON.stringify(wizardRes.json, null, 2));

const postRes = await post(`/employee-app/visits/${jobId}/body-map/records`, postBody);
console.log('POST body-map/records status', postRes.status);

function redactGet(data) {
  if (!data) return null;
  return {
    serviceUserId: '00000000-0000-0000-0000-000000000001',
    scheduledJobId: data.scheduledJobId,
    scheduledVisitId: '00000000-0000-0000-0000-000000000002',
    canRecord: data.canRecord,
    progress: data.progress,
    handover: {
      activeCount: data.handover?.activeCount,
      highRiskCount: data.handover?.highRiskCount,
      concerns: (data.handover?.concerns ?? []).slice(0, 2),
    },
    lookups: {
      recordTypes: (data.lookups?.recordTypes ?? []).slice(0, 2),
      bodyViews: data.lookups?.bodyViews,
    },
    records: (data.records ?? []).slice(0, 1).map((r) => ({
      id: '00000000-0000-0000-0000-000000000099',
      recordType: r.recordType,
      riskLevel: r.riskLevel,
      markers: (r.markers ?? []).slice(0, 1),
    })),
    diagram: data.diagram,
  };
}

console.log('SAMPLE_GET_BODY_MAP', JSON.stringify(redactGet(bm.json?.data ?? det.json?.data?.bodyMap), null, 2));
console.log('SAMPLE_POST_REQUEST', JSON.stringify(postBody, null, 2));
console.log('SAMPLE_POST_RESPONSE', JSON.stringify(postRes.json, null, 2));

await prisma.$disconnect();
