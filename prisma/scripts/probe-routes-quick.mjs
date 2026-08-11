import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

function loadEnv() {
  try {
    const raw = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[m[1].trim()]) process.env[m[1].trim()] = val;
    }
  } catch {
    /* ignore */
  }
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
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
const base = 'http://127.0.0.1:3000';
const secret = process.env.JWT_ACCESS_TOKEN_SECRET;
const prisma = new PrismaClient();
const portal = await prisma.employeePortalAccount.findFirst({
  where: { email: 'ema@gmail.com', deletedAt: null },
  select: { id: true, employeeId: true },
});
const now = Math.floor(Date.now() / 1000);
const token = signJwt(
  { sub: portal.id, typ: 'emp', employeeId: portal.employeeId, iat: now, exp: now + 3600 },
  secret,
);
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
const jobId = '8d18d4f7-ff29-434f-8c40-0664bfeac574';

for (const path of [
  '/employee-app/home',
  `/employee-app/visits/${jobId}/details`,
  `/employee-app/visits/${jobId}/body-map`,
  `/employee-app/visits/${jobId}/body-map/wizard`,
]) {
  const res = await fetch(`${base}${path}`, { headers });
  const text = await res.text();
  console.log(path, res.status, text.slice(0, 250));
}

await prisma.$disconnect();
