/**
 * Rehearses the payroll remediation migrations on a synthetic copy of an "old" database.
 *
 *   node scripts/payroll-migration-rehearsal.mjs [--keep]
 *
 * 1. Creates a scratch database on the LOCAL PostgreSQL server (refuses any other host).
 * 2. Builds it from the schema of the commit the remediation started from (BASE_COMMIT).
 * 3. Seeds synthetic history of the kinds the migrations have to cope with: a visit paid by two
 *    locked runs, a draft run, a closed and a cancelled UK payroll run, a salary taken by two UK
 *    runs for one period, paid and draft payout batches.
 * 4. Applies the remediation migrations in order, exactly as `prisma migrate deploy` would.
 * 5. Checks the resulting schema against prisma/schema.prisma, the backfills, that no row was
 *    removed, and that the new constraints and triggers hold.
 * 6. Prints the duplicate reconciliation report for the seeded history and drops the database.
 *
 * It never connects to any database other than the scratch one it creates. No real data is used.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
require('dotenv').config({ path: join(root, '.env') });

/** Last commit before the remediation programme changed the schema. */
const BASE_COMMIT = 'e163815';
/** First remediation migration; everything from here on is rehearsed. */
const FIRST_MIGRATION = '20261012100000';
const KEEP = process.argv.includes('--keep');

function scratchUrl(baseUrl = process.env.DATABASE_URL) {
  if (!baseUrl) throw new Error('DATABASE_URL is not set');
  const url = new URL(baseUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('The migration rehearsal only runs on a local PostgreSQL server');
  }
  const base = url.pathname.replace(/^\//, '').replace(/_payroll_(test|migration_rehearsal)$/, '');
  url.pathname = `/${base}_payroll_migration_rehearsal`;
  return url.toString();
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const expectError = async (name, pattern, action) => {
  try {
    await action();
    check(name, false, 'statement was accepted');
  } catch (error) {
    const message = String(error?.message ?? error);
    check(name, pattern.test(message), pattern.test(message) ? '' : message.slice(0, 160));
  }
};

async function main() {
  const url = scratchUrl();
  const dbName = new URL(url).pathname.slice(1);
  const { PrismaClient } = require('@prisma/client');
  const prismaCli = join(root, 'node_modules', 'prisma', 'build', 'index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const prismaCmd = (args, options = {}) =>
    execFileSync(process.execPath, [prismaCli, ...args], { cwd: root, env, stdio: 'pipe', ...options });

  const admin = new PrismaClient();
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }
  console.log(`scratch database ${dbName} created on localhost`);

  const work = mkdtempSync(join(tmpdir(), 'payroll-rehearsal-'));
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    // --- 2. the database as it was before the remediation --------------------------------------
    const oldSchema = join(work, 'schema.prisma');
    writeFileSync(oldSchema, execFileSync('git', ['show', `${BASE_COMMIT}:prisma/schema.prisma`], { cwd: root }));
    prismaCmd(['db', 'push', '--skip-generate', '--schema', oldSchema]);
    console.log(`schema of ${BASE_COMMIT} pushed`);

    // --- 3. synthetic history -------------------------------------------------------------------
    const seed = await seedHistory(db);
    const tables = [
      ['billing', 'PayrollRun'],
      ['billing', 'PayrollRunLine'],
      ['billing', 'VisitReconciliation'],
      ['billing', 'EmployeePayItem'],
      ['billing', 'EmployeePayoutBatch'],
      ['payroll', 'UkPayrollRun'],
      ['payroll', 'UkPayrollRunEmployee'],
      ['payroll', 'UkPayrollInputLine'],
      ['lookups', 'BankHoliday'],
    ];
    const count = async () =>
      Object.fromEntries(
        await Promise.all(
          tables.map(async ([schema, table]) => {
            const rows = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${schema}"."${table}"`);
            return [`${schema}.${table}`, rows[0].n];
          }),
        ),
      );
    const before = await count();
    console.log('seeded rows', JSON.stringify(before));

    // --- 4. the migrations, in the order prisma applies them ------------------------------------
    const migrations = readdirSync(join(root, 'prisma', 'migrations'))
      .filter((name) => /^\d{14}_/.test(name) && name >= FIRST_MIGRATION)
      .sort();
    for (const name of migrations) {
      prismaCmd(['db', 'execute', '--url', url, '--file', join('prisma', 'migrations', name, 'migration.sql')]);
      console.log(`applied ${name}`);
    }
    check('migrations apply in order on the historical database', true, `${migrations.length} migrations`);

    // --- 5a. schema ------------------------------------------------------------------------------
    let diff = '';
    try {
      prismaCmd([
        'migrate', 'diff', '--from-url', url, '--to-schema-datamodel', join('prisma', 'schema.prisma'), '--exit-code',
      ]);
    } catch (error) {
      diff = String(error.stdout ?? '') || String(error.message);
    }
    check('migrated schema equals prisma/schema.prisma', diff === '', diff.trim().split('\n').slice(0, 6).join(' | '));

    // --- 5b. nothing removed ---------------------------------------------------------------------
    const after = await count();
    check('no row removed by the migrations', JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));

    // --- 5c. backfills ---------------------------------------------------------------------------
    const line = async (id) =>
      (await db.$queryRawUnsafe(`SELECT "claimKey" FROM "billing"."PayrollRunLine" WHERE "id" = $1::uuid`, id))[0];
    const key = (visit, type = 'VISIT_PAY') => `VISIT:${visit}:${type}`;
    check('locked visit pay line holds its claim', (await line(seed.L1)).claimKey === key(seed.V1));
    check(
      'visit paid by two locked runs: the older line keeps the claim, the other has none',
      (await line(seed.L3a)).claimKey === key(seed.V3) && (await line(seed.L3b)).claimKey === null,
    );
    check('visit only in a draft run: the draft line holds the claim', (await line(seed.L6)).claimKey === key(seed.V6));
    check(
      'visit in a locked and a draft run: the locked line holds the claim',
      (await line(seed.L7a)).claimKey === key(seed.V7) && (await line(seed.L7b)).claimKey === null,
    );
    check('minimum wage top-up line has no claim of its own', (await line(seed.LT)).claimKey === null);
    check('pay item line is claimed by its pay item', (await line(seed.LP)).claimKey === `PAY_ITEM:${seed.P1}`);

    const visit = async (id) =>
      (
        await db.$queryRawUnsafe(
          `SELECT "paidByUkPayrollRunId"::text AS uk, "includedInPayrollRunId"::text AS run FROM "billing"."VisitReconciliation" WHERE "id" = $1::uuid`,
          id,
        )
      )[0];
    check('visit taken provisionally by a closed UK run is marked as paid by it', (await visit(seed.V4)).uk === seed.ukClosed);
    check('visit taken provisionally by a cancelled UK run is not marked paid', (await visit(seed.V5)).uk === null);
    check('visit locked by a visit pay run is left to that run', (await visit(seed.V1)).uk === null && (await visit(seed.V1)).run === seed.runA);

    const input = async (id) =>
      (await db.$queryRawUnsafe(`SELECT "claimKey", "releasedAt" FROM "payroll"."UkPayrollInputLine" WHERE "id" = $1::uuid`, id))[0];
    check('closed UK run holds the claim on the pay line it collected', (await input(seed.inClosedLine)).claimKey === `LINE:${seed.L1}`);
    const cancelled = await input(seed.inCancelledLine);
    check('cancelled UK run: line kept as a snapshot, claim released', cancelled.claimKey === null && cancelled.releasedAt !== null);
    check('provisional visit input has no claim key (claimed on the visit at close)', (await input(seed.inClosedProvisional)).claimKey === null);
    check(
      'salary taken by two UK runs for one period: the closed run keeps the claim',
      (await input(seed.inClosedSalary)).claimKey === `SALARY:${seed.salaried}:${seed.period}` &&
        (await input(seed.inOpenSalary)).claimKey === null,
    );
    const batches = await db.$queryRawUnsafe(
      `SELECT "status"::text AS status, "settlementSource" AS source FROM "billing"."EmployeePayoutBatch" ORDER BY "status"`,
    );
    check(
      'paid payout batch is classed as manually recorded; draft batch has no settlement source',
      batches.find((b) => b.status === 'PAID')?.source === 'MANUAL_ENTRY' && batches.find((b) => b.status === 'DRAFT')?.source === null,
    );

    // --- 5d. constraints and triggers ------------------------------------------------------------
    const locked = /LOCKED_PAYROLL_HISTORY/;
    await expectError('a line of a locked run cannot be changed', locked, () =>
      db.$executeRawUnsafe(`UPDATE "billing"."PayrollRunLine" SET "amount" = 99 WHERE "id" = $1::uuid`, seed.L1),
    );
    await expectError('a line of a locked run cannot be deleted', locked, () =>
      db.$executeRawUnsafe(`DELETE FROM "billing"."PayrollRunLine" WHERE "id" = $1::uuid`, seed.L3b),
    );
    await expectError('a locked run cannot be reopened as a draft', locked, () =>
      db.$executeRawUnsafe(`UPDATE "billing"."PayrollRun" SET "status" = 'DRAFT' WHERE "id" = $1::uuid`, seed.runA),
    );
    await expectError('the pay of a visit in a locked run cannot be changed', locked, () =>
      db.$executeRawUnsafe(`UPDATE "billing"."VisitReconciliation" SET "payableAmount" = 99 WHERE "id" = $1::uuid`, seed.V1),
    );
    await expectError('the pay of a visit paid by a closed UK run cannot be changed', locked, () =>
      db.$executeRawUnsafe(`UPDATE "billing"."VisitReconciliation" SET "payableAmount" = 99 WHERE "id" = $1::uuid`, seed.V4),
    );
    const unique = /23505|unique|duplicate key|already exists/i;
    await expectError('a second original pay line for a claimed visit is refused', unique, () =>
      db.$executeRawUnsafe(
        `INSERT INTO "billing"."PayrollRunLine" ("id","payrollRunId","visitReconciliationId","lineType","description","amount","claimKey")
         VALUES ($1::uuid,$2::uuid,$3::uuid,'VISIT_PAY','rehearsal duplicate',14,$4)`,
        randomUUID(), seed.runDraft, seed.V1, key(seed.V1),
      ),
    );
    await expectError('a second UK claim on a collected pay line is refused', unique, () =>
      db.$executeRawUnsafe(
        `INSERT INTO "payroll"."UkPayrollInputLine" ("id","runId","runEmployeeId","employeeId","sourceType","sourcePayrollRunLineId","lineType","description","amount","claimKey")
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'BILLING_PAYROLL_LINE',$5::uuid,'VISIT_PAY','rehearsal duplicate',14,$6)`,
        randomUUID(), seed.ukOpen, seed.ukOpenEmployee, seed.carer, seed.L1, `LINE:${seed.L1}`,
      ),
    );
    // The earning stranded by the cancelled run before the migration can now be collected again.
    let recovered = true;
    try {
      await db.$executeRawUnsafe(
        `INSERT INTO "payroll"."UkPayrollInputLine" ("id","runId","runEmployeeId","employeeId","sourceType","sourcePayrollRunLineId","lineType","description","amount","claimKey")
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'BILLING_PAYROLL_LINE',$5::uuid,'VISIT_PAY','rehearsal replacement',14,$6)`,
        randomUUID(), seed.ukOpen, seed.ukOpenEmployee, seed.carer, seed.L2, `LINE:${seed.L2}`,
      );
    } catch (error) {
      recovered = false;
      console.log(String(error.message).slice(0, 200));
    }
    check('a pay line held only by a cancelled UK run can be collected by a replacement run', recovered);
    const enumOk = await db
      .$queryRawUnsafe(`SELECT 'UNVERIFIED_TIMES'::"billing"."FinanceExceptionCode"::text AS v`)
      .then((rows) => rows[0].v === 'UNVERIFIED_TIMES')
      .catch(() => false);
    check('finance exception code UNVERIFIED_TIMES exists', enumOk);

    // --- 5d. Gate B sprint: approval source, holiday calendar, mileage --------------------------
    const one = async (sql, ...args) => (await db.$queryRawUnsafe(sql, ...args))[0];
    const approval = (id) =>
      one(`SELECT "approvalSource", "approvedEvidence"::text AS evidence FROM "billing"."VisitReconciliation" WHERE "id" = $1::uuid`, id);
    check('visit approved by a person is recorded as MANAGER_APPROVED', (await approval(seed.V2)).approvalSource === 'MANAGER_APPROVED');
    check('visit approved without a person is recorded as AUTO_VERIFIED', (await approval(seed.V1)).approvalSource === 'AUTO_VERIFIED');
    check('no approval evidence is invented for old approvals', (await approval(seed.V1)).evidence === null && (await approval(seed.V2)).evidence === null);
    const empty = async (table) => (await one(`SELECT COUNT(*)::int AS n FROM ${table}`)).n === 0;
    check('attendance verification starts empty (old evidence is read from the visit as before)', await empty('"scheduling"."VisitAttendanceVerification"'));
    check('pay evaluation failures start empty', await empty('"billing"."PayEvaluationFailure"'));
    const evidenceEnum = await db
      .$queryRawUnsafe(`SELECT 'EVIDENCE_CHANGED'::"billing"."FinanceExceptionCode"::text AS v`)
      .then((rows) => rows[0].v === 'EVIDENCE_CHANGED')
      .catch(() => false);
    check('finance exception code EVIDENCE_CHANGED exists', evidenceEnum);

    const holiday = (id) =>
      one(`SELECT "name", "isActive", "isSubstitute", "substituteForDate"::text AS "for", "source" FROM "lookups"."BankHoliday" WHERE "id" = $1::uuid`, id);
    const christmasSubstitute = await holiday(seed.H1);
    check(
      'Christmas Day recorded on 27 December is marked as the substitute for 25 December',
      christmasSubstitute.isSubstitute === true && christmasSubstitute.for === '2027-12-25' && christmasSubstitute.name === 'Christmas Day',
    );
    check('a holiday on its own date is not a substitute day', (await holiday(seed.H2)).isSubstitute === false && (await holiday(seed.H3)).isSubstitute === false);
    const vague = await holiday(seed.H4);
    check('a row that only says "substitute day" is marked, with the date it stands for left empty', vague.isSubstitute === true && vague.for === null);
    check('a switched-off holiday stays switched off', (await holiday(seed.H5)).isActive === false);
    check('existing holiday rows are labelled as recorded before the source was kept', christmasSubstitute.source === 'LEGACY');
    const basis = await one(
      `SELECT column_default AS d FROM information_schema.columns WHERE table_schema = 'identity' AND table_name = 'OrganisationGeneralSettings' AND column_name = 'holidayPremiumBasis'`,
    );
    check('holiday pay basis defaults to BOTH (what was paid before the choice existed)', /BOTH/.test(String(basis?.d)));

    const mileage = await one(
      `SELECT "quantity"::text AS quantity, "description", "amount"::text AS amount, "taxTreatment" FROM "billing"."PayrollRunLine" WHERE "id" = $1::uuid`,
      seed.LM,
    );
    check(
      'a locked mileage line is not rewritten (its miles are read from its description)',
      mileage.quantity === null && mileage.taxTreatment === null && mileage.amount === '3.41' && mileage.description === 'Mileage — VIS-REHEARSAL-2 (6.20 mi)',
    );
    const rates = await db.$queryRawUnsafe(
      `SELECT "vehicleType"::text AS v, "rateFirst"::text AS f, "rateAfter"::text AS a, "thresholdMiles" AS t, "approvedVerifiedAt" AS verified FROM "billing"."MileageRate" ORDER BY "vehicleType"`,
    );
    const car = rates.find((r) => r.v === 'CAR_VAN');
    check('the mileage rates the application used are recorded as the first period', rates.length === 4 && Number(car.f) === 0.55 && Number(car.a) === 0.25 && car.t === 10000);
    check('no HMRC approved amount is recorded as verified by the migration', rates.every((r) => r.verified === null));
    const historic = await one(`SELECT COUNT(*)::int AS n FROM "payroll"."UkPayrollRunEmployee" WHERE "reimbursementPayable" <> 0 OR "expenseNotVerified" <> 0`);
    check('no historic UK run employee is given a reimbursement to pay', historic.n === 0);
    // Running the data migration a second time changes nothing.
    prismaCmd(['db', 'execute', '--url', url, '--file', join('prisma', 'migrations', '20261014104500_mileage_rate_defaults', 'migration.sql')]);
    check('the mileage rate defaults can be applied twice', (await one(`SELECT COUNT(*)::int AS n FROM "billing"."MileageRate"`)).n === 4);

    // --- 5b. Gate B2: mileage corrections and salary agreements ---------------------------------
    const payItem = await one(`SELECT "taxTreatment" AS t, "taxFreeAmount" AS f, "taxableAmount" AS x FROM "billing"."EmployeePayItem" WHERE id = $1::uuid`, seed.P1);
    check('an existing pay item is given no mileage tax treatment', payItem.t === null && payItem.f === null && payItem.x === null);
    const agreement = await one(
      `SELECT "annualSalary"::float AS salary, "salaryProrationMethod" AS method, "salaryCoverage" AS coverage, "salaryEntryPeriod" AS entry,
              "approvedById" AS approver, "approvedAt" AS approved, "termsChangedAt" AS changed, status::text AS status
         FROM "payroll"."EmployeePayAgreement" WHERE id = $1::uuid`,
      seed.A1,
    );
    check('an existing salary agreement keeps its salary and status', agreement.salary === 24000 && agreement.status === 'ACTIVE');
    check(
      'no proration method, salary cover or approval is invented for an existing agreement',
      agreement.method === null && agreement.coverage === null && agreement.entry === null && agreement.approver === null && agreement.approved === null,
    );
    check('an existing agreement is not marked as changed, so no salary adjustment can arise from it', agreement.changed === null);
    const unpaid = await one(`SELECT COUNT(*)::int AS n FROM "payroll"."UkPayrollInputLine" WHERE "unpaidAmount" IS NOT NULL OR "unpaidReason" IS NOT NULL`);
    check('no existing UK payroll line is marked as covered by salary or held', unpaid.n === 0);
    const guarantee = await one(
      `SELECT COUNT(*)::int AS n FROM "payroll"."EmployeePayAgreement"
        WHERE "guaranteedWeeklyHours" IS NOT NULL OR "guaranteeTopUp" IS NOT NULL OR "guaranteeQualifyingTime" IS NOT NULL OR "guaranteeLeaveTreatment" IS NOT NULL`,
    );
    check('no existing agreement is given guaranteed hours', guarantee.n === 0);
    const lineType = await one(
      `SELECT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'PayrollRunLineType' AND e.enumlabel = 'GUARANTEED_HOURS') AS ok`,
    );
    check('pay line type GUARANTEED_HOURS exists', lineType.ok === true);
    check('no travel-time interval is created by the migrations', await empty('"billing"."TravelTimeInterval"'));
    check('no rule for cancelled or disrupted visits is created (no policy is invented)', await empty('"billing"."VisitDisruptionPayRule"'));
    check('no pay decision for a disrupted visit is created', await empty('"billing"."VisitDisruptionPayDecision"'));
    check('minimum wage assessments start empty: earlier runs keep the lines they were paid with', await empty('"billing"."NmwPeriodAssessment"'));
    check('no leave terms or leave entries are created (no entitlement is invented)', (await empty('"payroll"."EmployeeLeaveTerms"')) && (await empty('"payroll"."EmployeeLeaveEntry"')));
    const apprentices = await one(`SELECT COUNT(*)::int AS n FROM "payroll"."EmployeePayrollProfile" WHERE "apprenticeshipStartDate" IS NOT NULL`);
    check('no payroll profile is given an apprenticeship start date', apprentices.n === 0);

    // --- 6. duplicate reconciliation report (nothing is deleted) --------------------------------
    const duplicateVisits = await db.$queryRawUnsafe(`
      SELECT l."visitReconciliationId"::text AS "visitReconciliationId", v."visitRef",
             COUNT(*)::int AS "lockedLines", SUM(l."amount")::text AS "totalPaid",
             STRING_AGG(r."periodLabel", ' + ' ORDER BY r."periodStart") AS "runs"
      FROM "billing"."PayrollRunLine" l
      JOIN "billing"."PayrollRun" r ON r."id" = l."payrollRunId"
      JOIN "billing"."VisitReconciliation" v ON v."id" = l."visitReconciliationId"
      WHERE l."lineType"::text = 'VISIT_PAY' AND r."status"::text IN ('LOCKED','EXPORTED')
      GROUP BY l."visitReconciliationId", v."visitRef"
      HAVING COUNT(*) > 1`);
    const unclaimedUk = await db.$queryRawUnsafe(`
      SELECT l."id"::text AS "inputLineId", l."sourceType"::text AS "sourceType", l."amount"::text AS amount, r."label" AS run, r."status"::text AS status
      FROM "payroll"."UkPayrollInputLine" l
      JOIN "payroll"."UkPayrollRun" r ON r."id" = l."runId"
      WHERE l."claimKey" IS NULL AND l."releasedAt" IS NULL AND l."isProvisional" = false
        AND r."status"::text <> 'CANCELLED' AND l."description" NOT LIKE 'rehearsal %'`);
    console.log('\nDUPLICATE RECONCILIATION REPORT (for finance review; no row is changed)');
    console.log('visits with more than one locked visit pay line:', JSON.stringify(duplicateVisits));
    console.log('live UK payroll inputs without a claim (a second run took the same source):', JSON.stringify(unclaimedUk));
    check('the visit paid twice is reported, with both runs', duplicateVisits.length === 1 && duplicateVisits[0].visitReconciliationId === seed.V3 && duplicateVisits[0].lockedLines === 2);
    check('the salary taken twice is reported', unclaimedUk.length === 1 && unclaimedUk[0].inputLineId === seed.inOpenSalary);
  } finally {
    await db.$disconnect();
    rmSync(work, { recursive: true, force: true });
    if (!KEEP) {
      const cleanup = new PrismaClient();
      try {
        await cleanup.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
        console.log(`\nscratch database ${dbName} dropped`);
      } finally {
        await cleanup.$disconnect();
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

/** Synthetic rows as an old database could hold them. Column lists are those of BASE_COMMIT. */
async function seedHistory(db) {
  const id = () => randomUUID();
  const now = new Date();
  const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
  const at = (iso) => new Date(iso);
  const carer = id();
  const salaried = id();
  const insert = async (table, row) => {
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = columns.map((column, i) => `$${i + 1}${row.__cast?.[column] ?? ''}`);
    await db.$executeRawUnsafe(
      `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${placeholders.join(',')})`,
      ...values,
    );
  };
  const cast = (row, casts) => {
    Object.defineProperty(row, '__cast', { value: casts, enumerable: false });
    return row;
  };
  const uuidCols = (row, extra = {}) => {
    const casts = { ...extra };
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v) && !casts[k]) casts[k] = '::uuid';
    }
    return cast(row, casts);
  };

  // Visit pay runs: two locked, one draft.
  const [runA, runB, runDraft] = [id(), id(), id()];
  const run = (rid, label, start, end, status) =>
    insert('"billing"."PayrollRun"', uuidCols(
      { id: rid, periodLabel: label, periodStart: day(start), periodEnd: day(end), status, lockedAt: status === 'LOCKED' ? now : null, updatedAt: now },
      { status: '::"billing"."PayrollRunStatus"' },
    ));
  await run(runA, 'Rehearsal wk 1', '2026-06-01', '2026-06-07', 'LOCKED');
  await run(runB, 'Rehearsal wk 2', '2026-06-08', '2026-06-14', 'LOCKED');
  await run(runDraft, 'Rehearsal wk 3', '2026-06-15', '2026-06-21', 'DRAFT');

  // Visits.
  const [V1, V2, V3, V4, V5, V6, V7] = [id(), id(), id(), id(), id(), id(), id()];
  const visit = (vid, n, included) =>
    insert('"billing"."VisitReconciliation"', uuidCols(
      {
        id: vid,
        scheduledVisitId: id(),
        scheduledJobId: id(),
        serviceUserId: id(),
        employeeId: carer,
        jobAllocationId: id(),
        visitRef: `VIS-REHEARSAL-${n}`,
        plannedStartDateTime: at(`2026-06-0${n}T09:00:00Z`),
        plannedEndDateTime: at(`2026-06-0${n}T10:00:00Z`),
        payableMinutes: 60,
        payableAmount: 14,
        status: 'APPROVED_FOR_BOTH',
        includedInPayrollRunId: included,
        updatedAt: now,
      },
      { status: '::"billing"."VisitReconciliationStatus"' },
    ));
  await visit(V1, 1, runA);
  await visit(V2, 2, runA);
  await visit(V3, 3, runA);
  await visit(V4, 4, null);
  await visit(V5, 5, null);
  await visit(V6, 6, null);
  await visit(V7, 7, runB);

  // A pay item already paid by run A.
  const P1 = id();
  await insert('"billing"."EmployeePayItem"', uuidCols({
    id: P1, employeeId: carer, wageTypeCode: 'BONUS', workDate: day('2026-06-02'), amount: 25, reason: 'Rehearsal bonus',
    status: 'APPROVED', includedInPayrollRunId: runA, updatedAt: now,
  }));

  // A salary agreement made before agreements recorded how a part period is paid or what the
  // salary pays for.
  const A1 = id();
  await insert('"payroll"."EmployeePayAgreement"', uuidCols(
    { id: A1, employeeId: salaried, basis: 'SALARIED', status: 'ACTIVE', effectiveFrom: day('2026-01-01'), annualSalary: 24000, updatedAt: now },
    { basis: '::"payroll"."EmployeePayAgreementBasis"', status: '::"payroll"."EmployeePayAgreementStatus"' },
  ));

  // Pay lines. createdAt orders the two lines of the visit paid twice.
  const [L1, L2, L3a, L3b, L6, L7a, L7b, LT, LP] = [id(), id(), id(), id(), id(), id(), id(), id(), id()];
  const payLine = (lid, runId, visitId, lineType, amount, createdAt, extra = {}) =>
    insert('"billing"."PayrollRunLine"', uuidCols(
      { id: lid, payrollRunId: runId, visitReconciliationId: visitId, employeeId: carer, lineType, description: 'Rehearsal line', amount, createdAt: at(createdAt), ...extra },
      { lineType: '::"billing"."PayrollRunLineType"' },
    ));
  await payLine(L1, runA, V1, 'VISIT_PAY', 14, '2026-06-08T08:00:00Z');
  await payLine(L2, runA, V2, 'VISIT_PAY', 14, '2026-06-08T08:00:00Z');
  await payLine(L3a, runA, V3, 'VISIT_PAY', 14, '2026-06-08T08:00:00Z');
  await payLine(L3b, runB, V3, 'VISIT_PAY', 14, '2026-06-15T08:00:00Z'); // the same visit, paid again
  await payLine(L6, runDraft, V6, 'VISIT_PAY', 14, '2026-06-22T08:00:00Z');
  await payLine(L7a, runB, V7, 'VISIT_PAY', 14, '2026-06-15T08:00:00Z');
  await payLine(L7b, runDraft, V7, 'VISIT_PAY', 14, '2026-06-22T08:00:00Z');
  await payLine(LT, runA, V1, 'NMW_TOP_UP', 2, '2026-06-08T08:00:00Z');
  await payLine(LP, runA, null, 'ALLOWANCE', 25, '2026-06-08T08:00:00Z', { employeePayItemId: P1 });
  // A locked mileage line as the old system wrote it: miles only in the description.
  const LM = id();
  await payLine(LM, runA, V2, 'MILEAGE', 3.41, '2026-06-08T08:00:00Z', { description: 'Mileage — VIS-REHEARSAL-2 (6.20 mi)' });
  // One visit approved by a person; the others were approved without one.
  await db.$executeRawUnsafe(`UPDATE "billing"."VisitReconciliation" SET "approvedById" = $1::uuid WHERE "id" = $2::uuid`, id(), V2);

  // Bank holidays as an old calendar could hold them.
  const [H1, H2, H3, H4, H5] = [id(), id(), id(), id(), id()];
  const bankHoliday = (hid, date, name, extra = {}) =>
    insert('"lookups"."BankHoliday"', uuidCols({ id: hid, holidayDate: day(date), name, region: 'UK', updatedAt: now, ...extra }));
  await bankHoliday(H1, '2027-12-27', 'Christmas Day'); // 25 December 2027 is a Saturday
  await bankHoliday(H2, '2026-12-25', 'Christmas Day');
  await bankHoliday(H3, '2026-04-03', 'Good Friday');
  await bankHoliday(H4, '2026-06-01', 'Extra day (substitute day)');
  await bankHoliday(H5, '2026-05-04', 'Early May bank holiday', { isActive: false });

  // UK payroll: one period, a closed run, a cancelled run and an open second run.
  const [taxYear, schedule, period] = [id(), id(), id()];
  await insert('"payroll"."PayrollTaxYear"', uuidCols({ id: taxYear, code: 'REHEARSAL-26', label: 'Rehearsal 2026/27', startDate: day('2026-04-06'), endDate: day('2027-04-05'), updatedAt: now }));
  await insert('"payroll"."PayrollSchedule"', uuidCols(
    { id: schedule, name: 'Rehearsal monthly', code: 'REHEARSAL-M', frequency: 'MONTHLY', updatedAt: now },
    { frequency: '::"payroll"."PayrollPayFrequency"' },
  ));
  await insert('"payroll"."PayrollPeriod"', uuidCols({
    id: period, scheduleId: schedule, taxYearId: taxYear, sequence: 3, label: 'Rehearsal June', periodStart: day('2026-06-01'),
    periodEnd: day('2026-06-30'), paymentDate: day('2026-06-30'), updatedAt: now,
  }));
  const [ukClosed, ukCancelled, ukOpen] = [id(), id(), id()];
  const ukRun = (rid, runNumber, label, status, stamps = {}) =>
    insert('"payroll"."UkPayrollRun"', uuidCols(
      { id: rid, periodId: period, taxYearId: taxYear, scheduleId: schedule, runNumber, label, status, updatedAt: now, ...stamps },
      { status: '::"payroll"."UkPayrollRunStatus"' },
    ));
  await ukRun(ukClosed, 1, 'Rehearsal June run 1', 'CLOSED', { closedAt: at('2026-07-01T10:00:00Z') });
  await ukRun(ukCancelled, 2, 'Rehearsal June run 2', 'CANCELLED', { cancelledAt: at('2026-07-02T10:00:00Z') });
  await ukRun(ukOpen, 3, 'Rehearsal June run 3', 'GROSS_CALCULATED');
  const runEmployee = async (runId, employeeId) => {
    const reId = id();
    await insert('"payroll"."UkPayrollRunEmployee"', uuidCols({ id: reId, runId, employeeId }));
    return reId;
  };
  const closedCarer = await runEmployee(ukClosed, carer);
  const closedSalaried = await runEmployee(ukClosed, salaried);
  const cancelledCarer = await runEmployee(ukCancelled, carer);
  const ukOpenEmployee = await runEmployee(ukOpen, carer);
  const openSalaried = await runEmployee(ukOpen, salaried);
  const [inClosedLine, inClosedProvisional, inClosedSalary, inCancelledLine, inCancelledProvisional, inOpenSalary] = [id(), id(), id(), id(), id(), id()];
  const inputLine = (lid, runId, runEmployeeId, employeeId, sourceType, extra, createdAt) =>
    insert('"payroll"."UkPayrollInputLine"', uuidCols(
      { id: lid, runId, runEmployeeId, employeeId, sourceType, lineType: 'VISIT_PAY', description: 'Rehearsal input', amount: 14, createdAt: at(createdAt), ...extra },
      { sourceType: '::"payroll"."UkPayrollInputSourceType"' },
    ));
  await inputLine(inClosedLine, ukClosed, closedCarer, carer, 'BILLING_PAYROLL_LINE', { sourcePayrollRunLineId: L1, sourcePayrollRunId: runA }, '2026-06-30T09:00:00Z');
  await inputLine(inClosedProvisional, ukClosed, closedCarer, carer, 'VISIT_RECONCILIATION', { sourceVisitReconciliationId: V4, isProvisional: true }, '2026-06-30T09:00:00Z');
  await inputLine(inClosedSalary, ukClosed, closedSalaried, salaried, 'PAY_AGREEMENT_SALARY', { lineType: 'SALARY', amount: 2000 }, '2026-06-30T09:00:00Z');
  // Before the migration this line alone stopped any other run from collecting pay line L2.
  await inputLine(inCancelledLine, ukCancelled, cancelledCarer, carer, 'BILLING_PAYROLL_LINE', { sourcePayrollRunLineId: L2, sourcePayrollRunId: runA }, '2026-07-01T09:00:00Z');
  await inputLine(inCancelledProvisional, ukCancelled, cancelledCarer, carer, 'VISIT_RECONCILIATION', { sourceVisitReconciliationId: V5, isProvisional: true }, '2026-07-01T09:00:00Z');
  await inputLine(inOpenSalary, ukOpen, openSalaried, salaried, 'PAY_AGREEMENT_SALARY', { lineType: 'SALARY', amount: 2000 }, '2026-07-03T09:00:00Z');

  // Payout batches as the old system left them: no settlement evidence at all.
  const batch = (status, extra = {}) =>
    insert('"billing"."EmployeePayoutBatch"', uuidCols(
      { id: id(), periodKey: '2026-06', periodStart: day('2026-06-01'), periodEnd: day('2026-06-30'), ukPayrollRunId: ukClosed, status, totalAmount: 14, updatedAt: now, ...extra },
      { status: '::"billing"."EmployeePayoutBatchStatus"' },
    ));
  await batch('PAID', { paidAt: at('2026-07-04T10:00:00Z') });
  await batch('DRAFT');

  return {
    A1, carer, salaried, period, runA, runB, runDraft, V1, V2, V3, V4, V5, V6, V7, P1, L1, L2, L3a, L3b, L6, L7a, L7b, LT, LP, LM,
    H1, H2, H3, H4, H5,
    ukClosed, ukCancelled, ukOpen, ukOpenEmployee, inClosedLine, inClosedProvisional, inClosedSalary, inCancelledLine, inOpenSalary,
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
