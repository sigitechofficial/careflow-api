/**
 * Resolve demo SU-1042 id and run careflow-admin API autofill (critical = full assessment).
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/fill-demo-initial-assessment.ts
 */
import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { INITIAL_ASSESSMENT_DEMO_SU_NUMBER } from '../seeds/initial-assessment-demo-service-user.seed';

const prisma = new PrismaClient();

function careflowAdminRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), '..', 'careflow-admin'),
    path.resolve(process.cwd(), '..', 'care-admin'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  }
  throw new Error('careflow-admin not found alongside careflow-api');
}

function loadEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function main() {
  const su = await prisma.serviceUser.findFirst({
    where: { serviceUserNumber: INITIAL_ASSESSMENT_DEMO_SU_NUMBER, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, serviceUserNumber: true },
  });
  if (!su) {
    throw new Error(`Demo service user ${INITIAL_ASSESSMENT_DEMO_SU_NUMBER} not found — run npm run seed first.`);
  }

  const adminRoot = careflowAdminRoot();
  const envFromFile = {
    ...loadEnvFile(path.join(adminRoot, '.env')),
    ...loadEnvFile(path.join(adminRoot, '.env.local')),
  };

  const apiBase = envFromFile.E2E_API_BASE_URL || 'http://localhost:3000';
  const email = envFromFile.E2E_LOGIN_EMAIL;
  const password = envFromFile.E2E_LOGIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      `Set E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD in ${adminRoot}/.env (see .env.example).`,
    );
  }

  const level = process.env.IA_FILL_LEVEL ?? 'critical';
  console.log(`Filling initial assessment (${level}) for ${su.firstName} ${su.lastName} (${su.serviceUserNumber})…`);

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...envFromFile,
    E2E_API_BASE_URL: apiBase,
    E2E_LOGIN_EMAIL: email,
    E2E_LOGIN_PASSWORD: password,
    E2E_IA_SERVICE_USER_ID: su.id,
    E2E_IA_FILL_LEVEL: level,
  };

  await new Promise<void>((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cmd.exe' : 'npx';
    const args = isWin
      ? ['/d', '/c', 'npm', 'run', 'test:e2e:ia-fill-api']
      : ['playwright', 'test', 'tests/e2e/service-users/fill-initial-assessment-api-only.spec.ts', '--project=chromium'];

    const child = spawn(cmd, args, {
      cwd: adminRoot,
      env: childEnv,
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Autofill exited with code ${code ?? 'unknown'}`));
    });
  });

  console.log(`Done — open Initial Assessment for service user ${su.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
