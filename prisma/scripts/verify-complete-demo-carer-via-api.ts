/**
 * Verify demo carer APIs used by the employee UI.
 *
 * Usage (after seed-complete-demo-carer-via-api.ts):
 *   npx ts-node --transpile-only prisma/scripts/verify-complete-demo-carer-via-api.ts
 */
import { PrismaClient } from '@prisma/client';

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.PROBE_EMAIL ?? 'admin@careadmin.local';
const PASS = process.env.PROBE_PASSWORD ?? 'Admin@12345';
const USERNAME = 'demo-carer-complete';

const prisma = new PrismaClient();

type Result = { name: string; ok: boolean; detail?: string };

async function api(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function login(): Promise<string> {
  const { ok, json } = await api('/auth/login', '', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const token = (json as { data?: { accessToken?: string } }).data?.accessToken;
  if (!ok || !token) throw new Error('Login failed');
  return token;
}

async function main() {
  const token = await login();
  const row = await prisma.employeePersonalDetail.findFirst({
    where: { username: USERNAME, deletedAt: null },
    select: { employeeId: true },
  });
  if (!row) {
    console.error(`No employee with username ${USERNAME}. Run seed-complete-demo-carer-via-api.ts first.`);
    process.exit(1);
  }
  const id = row.employeeId;
  const results: Result[] = [];

  const activeStatus = await prisma.employeeStatus.findFirst({
    where: { name: 'Active', deletedAt: null },
    select: { id: true },
  });
  const statusQuery = activeStatus ? `?statusId=${activeStatus.id}` : '';

  const { ok: detailOk, json: detailJson } = await api(`/employees/${id}`, token);
  const detail = (detailJson as { data?: Record<string, unknown> }).data;
  results.push({
    name: 'Employee detail',
    ok: detailOk && Boolean(detail?.id),
    detail: detailOk ? undefined : 'GET failed',
  });

  const { ok: listOk, json: listJson } = await api('/employees?search=Casey&limit=5', token);
  const listRow = ((listJson as { data?: Array<Record<string, unknown>> }).data ?? []).find(
    (row) => row.id === id,
  );
  results.push({
    name: 'Staff list row',
    ok: listOk && Boolean(listRow),
    detail: listRow ? undefined : 'Casey not in list',
  });
  results.push({
    name: 'Staff list on-leave badge',
    ok: Boolean(listRow?.onHolidayToday),
    detail: listRow?.onHolidayToday ? undefined : 'onHolidayToday false',
  });

  const remainingChecks: Array<{ name: string; path: string; minItems?: number }> = [
    { name: 'List facets', path: `/employees/list-facets${statusQuery}` },
    { name: 'Chart summary', path: '/employees/chart-summary' },
    { name: 'Skills', path: `/employees/${id}/skills`, minItems: 1 },
    { name: 'Reviews', path: `/employees/${id}/reviews`, minItems: 1 },
    { name: 'Holidays', path: `/employees/${id}/holidays`, minItems: 1 },
    { name: 'Working patterns', path: `/employees/${id}/working-patterns`, minItems: 6 },
    { name: 'Non-core activities', path: `/employees/${id}/non-core-activities`, minItems: 3 },
    { name: 'Non-core registry', path: '/employees/non-core-activities-registry', minItems: 1 },
    { name: 'Emergency contacts', path: `/employees/${id}/emergency-contacts`, minItems: 1 },
    { name: 'Compliance checklist', path: `/employees/${id}/compliance/checklist` },
    { name: 'Skills overview', path: '/employees/skills-overview' },
    { name: 'Employee lookups', path: '/lookups/employee' },
  ];

  for (const check of remainingChecks) {
    const { ok, status, json } = await api(check.path, token);
    const items = (json as { data?: unknown[] }).data;
    const countOk = check.minItems == null || (Array.isArray(items) && items.length >= check.minItems);
    results.push({
      name: check.name,
      ok: ok && countOk,
      detail: ok
        ? countOk
          ? undefined
          : `expected >= ${check.minItems} items`
        : `HTTP ${status} ${JSON.stringify(json).slice(0, 120)}`,
    });
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(r.ok ? '✓' : '✗', r.name, r.detail ?? '');
  }
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll API checks passed for demo carer.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
