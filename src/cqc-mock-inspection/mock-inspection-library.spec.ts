import { readFileSync } from 'fs';
import { join } from 'path';
import {
  loadCqcFrameworks,
  statementsOf,
} from '../../prisma/seed-lib/cqc-framework';
import {
  loadMockInspectionLibrary,
  validateMockInspectionLibrary,
  type MockInspectionTemplateFile,
} from '../../prisma/seed-lib/mock-inspection-library';

const v1 = loadCqcFrameworks()[0];
const codes = statementsOf(v1).map((s) => s.code);
const dir = join(
  __dirname,
  '..',
  '..',
  'prisma',
  'seed-data',
  'mock-inspection-library',
);
const read = (f: string): unknown =>
  JSON.parse(readFileSync(join(dir, f), 'utf8'));

describe('ready-made mock inspection library', () => {
  const { library, templates } = loadMockInspectionLibrary(codes);

  it('has the 24 researched templates in four groups', () => {
    expect(templates.map((t) => t.code)).toEqual(
      Array.from(
        { length: 24 },
        (_, i) => `MI-${String(i + 1).padStart(3, '0')}`,
      ),
    );
    expect(library.groups.map((g) => g.code)).toEqual([
      'FULL',
      'FOCUSED',
      'TOPIC',
      'HOME_CARE',
    ]);
    expect(new Set(templates.map((t) => t.group))).toEqual(
      new Set(['FULL', 'FOCUSED', 'TOPIC', 'HOME_CARE']),
    );
  });

  it('the full inspection covers every quality statement, and each one has guidance', () => {
    const full = templates.find((t) => t.code === 'MI-001')!;
    expect(full.statements.map((s) => s.code).sort()).toEqual(
      [...codes].sort(),
    );
    for (const s of full.statements)
      expect(s.guidance.lookAt.length).toBeGreaterThan(0);
    expect(
      Object.keys(read('statement-guidance.json') as object).sort(),
    ).toEqual([...codes].sort());
  });

  it("joins each statement's guidance and keeps template focus notes", () => {
    const medicines = templates.find((t) => t.code === 'MI-006')!;
    expect(medicines.groupName).toBe('Topic deep dives');
    const staffing = medicines.statements.find(
      (s) => s.code === 'SAFE_STAFFING',
    )!;
    expect(staffing.focus).toMatch(/competency/);
    expect(staffing.guidance.askStaff.length).toBeGreaterThan(0);
    expect(
      medicines.statements.find((s) => s.code === 'SAFE_MEDICINES')!.focus,
    ).toBeNull();
  });

  it('rejects unknown statements, missing guidance, unknown sources and bad codes', () => {
    const library = read('library.json');
    const guidance = read('statement-guidance.json') as Record<string, unknown>;
    const good = read('MI-006.json') as MockInspectionTemplateFile;
    const withoutIpc = { ...guidance };
    delete withoutIpc.SAFE_IPC;
    const errors = validateMockInspectionLibrary(
      library,
      withoutIpc,
      [
        {
          ...good,
          statements: [{ code: 'NOT_A_STATEMENT' }, { code: 'SAFE_IPC' }],
          sources: ['nope'],
        },
        { ...good, code: 'X-1' },
      ],
      codes,
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'template MI-006: NOT_A_STATEMENT is not a statement of the framework',
        'template MI-006: SAFE_IPC has no guidance in statement-guidance.json',
        'template MI-006: unknown source nope',
        'template X-1: code must look like MI-001',
      ]),
    );
  });
});
