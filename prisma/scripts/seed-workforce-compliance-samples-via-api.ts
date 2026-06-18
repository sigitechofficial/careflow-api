/**
 * Seed realistic EmployeeCompliance samples on wf-demo-* staff (VALID / EXPIRING_SOON / EXPIRED / MISSING).
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/seed-workforce-compliance-samples-via-api.ts
 */
import { PrismaClient } from '@prisma/client';

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.PROBE_EMAIL ?? 'admin@careadmin.local';
const PASS = process.env.PROBE_PASSWORD ?? 'Admin@12345';
const USERNAME_PREFIX = 'wf-demo-';

const prisma = new PrismaClient();

type ChecklistItem = {
  complianceTypeId: string;
  code: string | null;
  record: { id: string } | null;
};

async function api<T>(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, json };
}

async function login(): Promise<string> {
  const { ok, json } = await api<{ data?: { accessToken?: string }; accessToken?: string }>(
    '/auth/login',
    '',
    { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASS }) },
  );
  const token = json.data?.accessToken ?? json.accessToken;
  if (!ok || !token) {
    console.error('Login failed', json);
    process.exit(1);
  }
  return token;
}

function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

async function ensureAndLoadChecklist(token: string, employeeId: string) {
  await api(`/employees/${employeeId}/compliance/ensure-checklist`, token, { method: 'POST' });
  const { ok, json } = await api<{ data?: { items: ChecklistItem[] } }>(
    `/employees/${employeeId}/compliance/checklist`,
    token,
  );
  if (!ok) throw new Error(`checklist failed for ${employeeId}`);
  return json.data?.items ?? [];
}

async function upsertComplianceSample(
  token: string,
  employeeId: string,
  item: ChecklistItem,
  issueDate: Date,
  expiryDate: Date | null,
  verify: boolean,
) {
  let complianceId = item.record?.id;
  if (!complianceId) {
    const created = await api<{ data?: { id: string } }>(`/employees/${employeeId}/compliance`, token, {
      method: 'POST',
      body: JSON.stringify({
        complianceTypeId: item.complianceTypeId,
        issueDate: issueDate.toISOString(),
        expiryDate: expiryDate?.toISOString() ?? undefined,
        notes: 'Demo workforce compliance sample',
      }),
    });
    complianceId = created.json.data?.id ?? (created.json as { data?: { id: string } }).data?.id;
  } else {
    await api(`/employees/${employeeId}/compliance/${complianceId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        issueDate: issueDate.toISOString(),
        expiryDate: expiryDate?.toISOString() ?? null,
        notes: 'Demo workforce compliance sample',
      }),
    });
  }
  if (!complianceId) return;
  if (verify) {
    await api(`/employees/${employeeId}/compliance/${complianceId}/verify`, token, {
      method: 'PATCH',
      body: JSON.stringify({ notes: 'Demo verify' }),
    });
  }
}

async function deleteCompliance(token: string, employeeId: string, complianceId: string) {
  await api(`/employees/${employeeId}/compliance/${complianceId}`, token, { method: 'DELETE' });
}

function findByCode(items: ChecklistItem[], code: string) {
  return items.find((i) => i.code === code);
}

async function seedEmployeeCompliance(token: string, employeeId: string, index: number) {
  const today = new Date();
  const items = await ensureAndLoadChecklist(token, employeeId);

  const dbs = findByCode(items, 'DBS');
  const fire = findByCode(items, 'FIRE_SAFETY');
  const safeguarding = findByCode(items, 'SAFEGUARDING_ADULTS');
  const moving = findByCode(items, 'MOVING_HANDLING_PEOPLE');

  if (dbs) {
    await upsertComplianceSample(
      token,
      employeeId,
      dbs,
      addMonths(today, -6),
      addMonths(today, 30),
      true,
    );
  }

  const variant = index % 4;
  if (fire) {
    if (variant === 0 || variant === 1) {
      await upsertComplianceSample(
        token,
        employeeId,
        fire,
        addMonths(today, -11),
        addDays(today, variant === 0 ? 15 : 45),
        true,
      );
    } else if (fire.record) {
      await deleteCompliance(token, employeeId, fire.record.id);
    }
  }

  if (safeguarding && (variant === 0 || variant === 2)) {
    await upsertComplianceSample(
      token,
      employeeId,
      safeguarding,
      addMonths(today, -14),
      addDays(today, variant === 2 ? -30 : -5),
      true,
    );
  }

  if (moving && variant === 3 && moving.record) {
    await deleteCompliance(token, employeeId, moving.record.id);
  }
}

async function main() {
  console.log('[compliance-samples] Logging in…');
  const token = await login();

  const employees = await prisma.employeePersonalDetail.findMany({
    where: {
      username: { startsWith: USERNAME_PREFIX },
      deletedAt: null,
    },
    orderBy: { username: 'asc' },
    select: { employeeId: true, username: true },
  });

  if (employees.length === 0) {
    console.log('[compliance-samples] No wf-demo-* employees — run seed-workforce-demo-via-api.ts first.');
    return;
  }

  let n = 0;
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    try {
      await seedEmployeeCompliance(token, emp.employeeId, i);
      console.log(`  + ${emp.username}`);
      n += 1;
    } catch (e) {
      console.error(`  ! ${emp.username}`, e);
    }
  }
  console.log(`[compliance-samples] Done: ${n} employees updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
