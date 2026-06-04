import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readEnvVarPreferDotenvFile } from './read-env-var.util';

describe('readEnvVarPreferDotenvFile', () => {
  const key = 'OPENDFDA_API_KEY_TEST';
  let cwd: string;
  let envPath: string;

  beforeEach(() => {
    cwd = join(tmpdir(), `care-env-test-${Date.now()}`);
    require('fs').mkdirSync(cwd, { recursive: true });
    envPath = join(cwd, '.env');
    delete process.env[key];
  });

  afterEach(() => {
    if (existsSync(envPath)) unlinkSync(envPath);
    delete process.env[key];
  });

  it('uses .env when process.env is empty string', () => {
    process.env[key] = '';
    writeFileSync(envPath, `${key}=from-file\r\n`, 'utf8');
    expect(readEnvVarPreferDotenvFile(key, cwd)).toBe('from-file');
  });

  it('prefers non-empty process.env', () => {
    process.env[key] = 'from-process';
    writeFileSync(envPath, `${key}=from-file\n`, 'utf8');
    expect(readEnvVarPreferDotenvFile(key, cwd)).toBe('from-process');
  });

  it('parses a line wrapped in double quotes', () => {
    writeFileSync(envPath, `"${key}=from-quoted"\r\n`, 'utf8');
    expect(readEnvVarPreferDotenvFile(key, cwd)).toBe('from-quoted');
  });
});
