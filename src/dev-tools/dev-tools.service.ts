import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type IaAutofillLevel = 'low' | 'normal' | 'critical';

const IA_AUTOFILL_TIMEOUT_MS = 8 * 60 * 1000;

const IA_AUTOFILL_LEVEL_DETAIL: Record<IaAutofillLevel, string> = {
  low: ' Stable / normal condition — required fields, low-risk flags; submitted incomplete where allowed.',
  normal:
    ' Moderate condition — required fields and hubs; submitted incomplete where allowed.',
  critical:
    ' Very critical condition — all 14 sections with elevated safeguarding, falls, wounds, and scores.',
};

/** Windows cannot spawn `npx.cmd` directly (EINVAL); run via `cmd.exe /c`. */
function spawnNpxPlaywright(
  cwd: string,
  env: NodeJS.ProcessEnv,
  playwrightArgs: string[],
): ChildProcess {
  const stdio: StdioOptions = ['ignore', 'pipe', 'pipe'];
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/c', 'npx', ...playwrightArgs], {
      cwd,
      env,
      shell: false,
      stdio,
    });
  }
  return spawn('npx', playwrightArgs, { cwd, env, shell: false, stdio });
}

@Injectable()
export class DevToolsService {
  private readonly logger = new Logger(DevToolsService.name);

  private careAdminRoot(): string {
    const candidates = [
      path.resolve(process.cwd(), '..', 'care-admin'),
      path.resolve(process.cwd(), 'care-admin'),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    }
    throw new BadRequestException(
      'care-admin folder not found. Run the API from the monorepo with care-admin alongside careadmin-backend.',
    );
  }

  private loadCareAdminEnv(careAdminRoot: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of ['.env', '.env.local']) {
      const file = path.join(careAdminRoot, name);
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
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
        if (!env[key]) env[key] = value;
      }
    }
    return env;
  }

  async runIaPlaywrightAutofill(
    serviceUserId: string,
    level: IaAutofillLevel,
  ): Promise<{ message: string }> {
    if (!['low', 'normal', 'critical'].includes(level)) {
      throw new BadRequestException('level must be low, normal, or critical');
    }
    if (!serviceUserId?.trim()) {
      throw new BadRequestException('serviceUserId is required');
    }

    const careAdminRoot = this.careAdminRoot();
    const env = this.loadCareAdminEnv(careAdminRoot);

    if (!env.E2E_API_BASE_URL?.trim() || !env.E2E_LOGIN_EMAIL?.trim()) {
      throw new BadRequestException(
        'Set E2E_API_BASE_URL, E2E_LOGIN_EMAIL, and E2E_LOGIN_PASSWORD in care-admin/.env',
      );
    }

    if (!env.E2E_API_BASE_URL.includes('localhost') && env.E2E_API_BASE_URL !== '/api') {
      this.logger.warn(
        `E2E_API_BASE_URL=${env.E2E_API_BASE_URL} — use http://localhost:3000 for Playwright API calls`,
      );
    }

    const apiBase =
      env.E2E_API_BASE_URL === '/api' || !env.E2E_API_BASE_URL.startsWith('http')
        ? 'http://localhost:3000'
        : env.E2E_API_BASE_URL.replace(/\/$/, '');

    const playwrightArgs = [
      'playwright',
      'test',
      'tests/e2e/service-users/fill-initial-assessment.spec.ts',
      '--project=chromium',
    ];

    const childEnv: NodeJS.ProcessEnv = {
      ...env,
      E2E_API_BASE_URL: apiBase,
      E2E_IA_SERVICE_USER_ID: serviceUserId.trim(),
      E2E_IA_FILL_LEVEL: level,
    };

    return new Promise((resolve, reject) => {
      const child = spawnNpxPlaywright(careAdminRoot, childEnv, playwrightArgs);

      let logTail = '';
      child.stdout?.on('data', (chunk) => {
        logTail = (logTail + chunk.toString()).slice(-4000);
      });
      child.stderr?.on('data', (chunk) => {
        logTail = (logTail + chunk.toString()).slice(-4000);
      });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(
          new InternalServerErrorException(
            `Playwright autofill (${level}) timed out after ${IA_AUTOFILL_TIMEOUT_MS / 60_000} minutes`,
          ),
        );
      }, IA_AUTOFILL_TIMEOUT_MS);

      child.on('error', (err) => {
        clearTimeout(timeout);
        this.logger.error(`IA autofill spawn error: ${err.message}`);
        reject(new InternalServerErrorException(`Failed to start Playwright: ${err.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          this.logger.log(`IA autofill (${level}) finished for ${serviceUserId}`);
          resolve({
            message: `Playwright autofill (${level}) completed for this service user.${IA_AUTOFILL_LEVEL_DETAIL[level]}`,
          });
          return;
        }
        this.logger.error(
          `IA autofill (${level}) failed (code ${code}) for ${serviceUserId}\n${logTail}`,
        );
        const tail = logTail.trim().split('\n').slice(-8).join('\n');
        reject(
          new InternalServerErrorException(
            tail || `Playwright autofill (${level}) failed (exit code ${code ?? 'unknown'})`,
          ),
        );
      });
    });
  }
}
