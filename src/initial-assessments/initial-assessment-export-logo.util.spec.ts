import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { embedOrganisationLogoForExport } from './initial-assessment-export-logo.util';

describe('embedOrganisationLogoForExport', () => {
  const testDir = join(process.cwd(), 'uploads', 'company');
  const testFile = 'ia-export-logo-test.png';
  const testPath = join(testDir, testFile);

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      testPath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
  });

  afterAll(() => {
    if (existsSync(testPath)) {
      const { unlinkSync } = require('fs');
      unlinkSync(testPath);
    }
  });

  it('returns a data URI for a local uploads path', async () => {
    const uri = await embedOrganisationLogoForExport(`/uploads/company/${testFile}`);
    expect(uri).toMatch(/^data:image\/png;base64,/);
  });

  it('prefers the first available logo', async () => {
    const uri = await embedOrganisationLogoForExport(null, `/uploads/company/${testFile}`);
    expect(uri).toMatch(/^data:image\/png;base64,/);
  });

  it('returns null when no file exists', async () => {
    const uri = await embedOrganisationLogoForExport('/uploads/company/missing-logo.png');
    expect(uri).toBeNull();
  });
});
