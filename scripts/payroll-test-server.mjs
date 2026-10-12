/**
 * Starts the built API against the payroll TEST database, on its own port, for checking payroll
 * screens in a browser with synthetic data only.
 *
 *   npm run build            (or keep `npm run start:dev` running: it keeps dist up to date)
 *   node scripts/payroll-test-server.mjs
 *
 * - Database: <name>_payroll_test on the local PostgreSQL server (see payroll-test-db.mjs).
 *   Refuses any host other than localhost. The development database is not touched.
 * - Port: 3101 (PAYROLL_TEST_API_PORT to change it).
 * - Fill the database first, for example by running the end-to-end spec:
 *     npx jest --config test/jest-payroll-int.json test/payroll-int/e2e-gate-a.int-spec.ts
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { payrollTestDatabaseUrl } from './payroll-test-db.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
createRequire(import.meta.url)('dotenv').config({ path: join(root, '.env') });

const url = payrollTestDatabaseUrl();
if (!new URL(url).pathname.endsWith('_payroll_test')) {
  throw new Error('Refusing to start outside the payroll test database');
}
// Set before the application loads: it does not override variables that already exist.
process.env.DATABASE_URL = url;
process.env.PORT = process.env.PAYROLL_TEST_API_PORT ?? '3101';
process.env.ALLOW_FINANCIAL_TEST_RESET = 'false';

console.log(`payroll test API: database ${new URL(url).pathname.slice(1)} on localhost, port ${process.env.PORT}`);
await import(pathToFileURL(join(root, 'dist', 'src', 'main.js')).href);
