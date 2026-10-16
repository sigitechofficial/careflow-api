/**
 * Creates / refreshes the isolated database used by the payroll integration tests.
 *
 *   node scripts/payroll-test-db.mjs
 *
 * - Same local PostgreSQL server as DATABASE_URL, different database: <name>_payroll_test.
 * - Refuses to run unless the server is localhost, so it can never touch a shared or live database.
 * - Schema comes from prisma/schema.prisma (db push); the trigger migrations are applied on top.
 * - Holds synthetic test rows only. Safe to drop at any time.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
require('dotenv').config({ path: join(root, '.env') });

/** SQL-only migrations Prisma cannot express in the schema (triggers, and data the application needs). */
const SQL_MIGRATIONS = [
  '20261012101000_locked_payroll_history_triggers',
  '20261012103000_paid_visit_trigger_uk_runs',
  '20261014104500_mileage_rate_defaults',
];

export function payrollTestDatabaseUrl(baseUrl = process.env.DATABASE_URL) {
  if (!baseUrl) throw new Error('DATABASE_URL is not set');
  const url = new URL(baseUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('Payroll test database is only created on a local PostgreSQL server');
  }
  const base = url.pathname.replace(/^\//, '').replace(/_payroll_test$/, '');
  url.pathname = `/${base}_payroll_test`;
  return url.toString();
}

async function main() {
  const testUrl = payrollTestDatabaseUrl();
  const dbName = new URL(testUrl).pathname.slice(1);
  const { PrismaClient } = require('@prisma/client');

  const admin = new PrismaClient();
  try {
    const exists = await admin.$queryRawUnsafe('SELECT 1 FROM pg_database WHERE datname = $1', dbName);
    if (!exists.length) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
      console.log(`created database ${dbName}`);
    } else {
      console.log(`database ${dbName} already exists`);
    }
  } finally {
    await admin.$disconnect();
  }

  const env = { ...process.env, DATABASE_URL: testUrl };
  const prismaCli = join(root, 'node_modules', 'prisma', 'build', 'index.js');
  execFileSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: root,
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  console.log('schema pushed');

  const test = new PrismaClient({ datasources: { db: { url: testUrl } } });
  try {
    for (const name of SQL_MIGRATIONS) {
      const sql = readFileSync(join(root, 'prisma', 'migrations', name, 'migration.sql'), 'utf8');
      // Split on statement ends that sit outside $$ function bodies.
      const statements = [];
      let current = '';
      let inBody = false;
      for (const line of sql.split('\n')) {
        if (line.trim().startsWith('--')) continue;
        current += line + '\n';
        if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inBody = !inBody;
        if (!inBody && line.trim().endsWith(';')) {
          statements.push(current.trim());
          current = '';
        }
      }
      for (const statement of statements) await test.$executeRawUnsafe(statement);
      console.log(`applied ${name} (${statements.length} statements)`);
    }
  } finally {
    await test.$disconnect();
  }
  console.log(`payroll test database ready: ${dbName} on localhost`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
