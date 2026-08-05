/**
 * Smoke-verify employee-app QA seed against local API.
 * Usage: node prisma/scripts/verify-employee-app-qa.mjs
 */
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

function loadEnv() {
  try {
    const raw = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
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

const prisma = new PrismaClient();
const portal = await prisma.employeePortalAccount.findFirst({
  where: { email: 'ema@gmail.com', deletedAt: null },
  select: { id: true, employeeId: true },
});
if (!portal) throw new Error('ema@gmail.com portal missing');

const jobs = await prisma.scheduledJob.findMany({
  where: { deletedAt: null, metadata: { path: ['qaEmployeeAppSeed'], equals: true } },
  select: {
    id: true,
    jobName: true,
    scheduledStartDateTime: true,
    metadata: true,
    visits: { where: { deletedAt: null }, select: { id: true }, take: 1 },
  },
  orderBy: { scheduledStartDateTime: 'asc' },
});

const now = Math.floor(Date.now() / 1000);
const token = signJwt(
  { sub: portal.id, typ: 'emp', employeeId: portal.employeeId, iat: now, exp: now + 60 * 60 * 8 },
  secret,
);

async function get(path) {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

const home = await get(`/employee-app/home?date=${today}`);
const schedToday = await get(`/employee-app/schedule?date=${today}`);
const schedTomorrow = await get(`/employee-app/schedule?date=${tomorrow}`);

function summarizeHome(h) {
  const visits = h?.data?.visits ?? h?.visits ?? [];
  return {
    status: home.status,
    visitCount: Array.isArray(visits) ? visits.length : null,
    jobIds: Array.isArray(visits) ? visits.map((v) => v.jobId ?? v.id) : [],
    names: Array.isArray(visits)
      ? visits.map((v) => v.clientName ?? v.serviceUserName ?? v.visitName)
      : [],
  };
}

function summarizeSchedule(label, res) {
  const days = res.json?.data?.days ?? res.json?.days ?? null;
  const visits =
    res.json?.data?.visits ??
    res.json?.visits ??
    (Array.isArray(days) ? days.flatMap((d) => d.visits ?? []) : []);
  return {
    label,
    status: res.status,
    visitCount: Array.isArray(visits) ? visits.length : null,
    jobIds: Array.isArray(visits) ? visits.map((v) => v.jobId ?? v.id) : [],
  };
}

console.log('HOME', JSON.stringify(summarizeHome(home.json), null, 2));
console.log('SCHEDULE_TODAY', JSON.stringify(summarizeSchedule('today', schedToday), null, 2));
console.log(
  'SCHEDULE_TOMORROW',
  JSON.stringify(summarizeSchedule('tomorrow', schedTomorrow), null, 2),
);

const details = [];
for (const job of jobs) {
  const letter =
    typeof job.metadata === 'object' && job.metadata && !Array.isArray(job.metadata)
      ? job.metadata.qaVisitLetter
      : '?';
  const d = await get(`/employee-app/visits/${job.id}/details`);
  const data = d.json?.data ?? d.json;
  const shell = data?.shell ?? {};
  const tasks = data?.tasks ?? {};
  const med = data?.medication ?? data?.mar ?? {};
  const obs = data?.observations ?? {};
  details.push({
    letter,
    status: d.status,
    jobId: job.id,
    visitId: shell.visitId ?? job.visits[0]?.id,
    clientId: shell.clientId ?? shell.serviceUserId,
    clientName: shell.clientName ?? shell.client?.name,
    visitWindow: shell.visitWindow,
    location: shell.location,
    clockInSettings: data?.clockInSettings ?? shell.clockInSettings,
    requiredCarers: shell.requiredCarers,
    coCarers: shell.coCarers,
    progress: shell.progress ?? tasks?.progress,
    taskRequired: (tasks?.requiredTasks ?? tasks?.data?.requiredTasks)?.length,
    taskOptional: (tasks?.optionalTasks ?? tasks?.data?.optionalTasks)?.length,
    medSections: (med?.sections ?? med?.data?.sections)?.map((s) => ({
      id: s.id,
      count: (s.medicines ?? s.items)?.length,
    })),
    obsRequired: (obs?.required ?? obs?.data?.required)?.length,
    obsOptional: (obs?.optional ?? obs?.data?.optional)?.length,
    unableReasons: (obs?.unableReasons ?? obs?.data?.unableReasons)?.length,
    hasCatalog: Boolean(obs?.catalog ?? obs?.data?.catalog),
    flashMessage: Boolean(data?.overview?.flashMessage),
    keySafe: Boolean(data?.overview?.keySafe?.code),
    lastHandover: Boolean(data?.overview?.lastHandover),
    flags: data?.overview?.flags ?? data?.shell?.flags,
    allergies: data?.overview?.allergies?.items ?? data?.shell?.allergies?.items,
    isCheckedIn: shell.isCheckedIn,
    statusUi: shell.status,
  });
}

console.log('DETAILS', JSON.stringify(details, null, 2));

// Write full payloads for agent delivery (trimmed)
const out = {
  tokenHint: `Bearer <emp JWT sub=${portal.id}>`,
  curls: {
    home: `curl -s -H "Authorization: Bearer $TOKEN" "${base}/employee-app/home?date=${today}"`,
    scheduleToday: `curl -s -H "Authorization: Bearer $TOKEN" "${base}/employee-app/schedule?date=${today}"`,
    scheduleTomorrow: `curl -s -H "Authorization: Bearer $TOKEN" "${base}/employee-app/schedule?date=${tomorrow}"`,
    details: jobs.map(
      (j) =>
        `curl -s -H "Authorization: Bearer $TOKEN" "${base}/employee-app/visits/${j.id}/details"`,
    ),
  },
  homeRawKeys: Object.keys(home.json?.data ?? home.json ?? {}),
  scheduleTodaySample: (() => {
    const visits =
      schedToday.json?.data?.visits ??
      schedToday.json?.visits ??
      schedToday.json?.data?.days?.[0]?.visits ??
      [];
    return Array.isArray(visits)
      ? visits
          .filter((v) => String(v.jobId ?? '').length)
          .map((v) => ({
            jobId: v.jobId,
            visitId: v.visitId,
            name: v.clientName ?? v.serviceUserName,
            start: v.scheduledStartIso ?? v.scheduledStart,
            status: v.status,
          }))
      : schedToday.json;
  })(),
  details,
};
console.log('VERIFY_BUNDLE', JSON.stringify(out, null, 2));

await prisma.$disconnect();
