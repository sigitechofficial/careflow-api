import {
  loadCqcFrameworks,
  statementsOf,
} from '../../prisma/seed-lib/cqc-framework';
import {
  loadAuditLibrary,
  validateAuditLibrary,
  type AuditTemplateFile,
} from '../../prisma/seed-lib/audit-library';

const v1 = loadCqcFrameworks()[0];
const codes = statementsOf(v1).map((s) => s.code);

describe('audit library', () => {
  const { library, templates } = loadAuditLibrary(codes);

  it('loads every template file, each with sections of standards', () => {
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      const standards = t.sections.flatMap((s) => s.standards);
      expect(standards.length).toBeGreaterThan(0);
    }
  });

  it('starts with the infection prevention and control audit', () => {
    const ipc = templates.find((t) => t.code === 'AUD-001')!;
    expect(ipc).toMatchObject({
      title: 'Infection prevention and control',
      area: 'INFECTION_PREVENTION',
      keyQuestion: 'SAFE',
      frequency: 'QUARTERLY',
    });
    expect(ipc.cqcStatements).toContain('SAFE_IPC');
  });

  it('has the eight audit areas', () => {
    expect(library.areas.map((a) => a.code)).toEqual([
      'CARE_QUALITY',
      'DAILY_CHECKS',
      'DEMENTIA',
      'INFECTION_PREVENTION',
      'LEADERSHIP',
      'OPERATIONAL',
      'SAFETY_ALERTS',
      'RISK_AND_SAFETY',
    ]);
  });

  it('says the templates are CareFlow’s own words and cites public sources only', () => {
    expect(library.note).toMatch(
      /not copied from any commercial audit product/,
    );
    for (const s of library.sources) expect(s.url).toMatch(/^https:\/\//);
  });

  describe('validation', () => {
    const base = (): AuditTemplateFile => ({
      code: 'AUD-900',
      area: 'INFECTION_PREVENTION',
      keyQuestion: 'SAFE',
      displayOrder: 1,
      title: 'Test',
      summary: 'Test audit',
      frequency: 'MONTHLY',
      estimatedMinutes: 30,
      cqcStatements: ['SAFE_IPC'],
      sections: [{ title: 'One', standards: [{ id: 'a-one', text: 'First' }] }],
      sources: [library.sources[0].id],
      researchedOn: '2026-11-23',
    });

    it('accepts a good template', () => {
      expect(validateAuditLibrary(library, [base()], codes)).toEqual([]);
    });

    it('refuses repeated or badly named standard ids, unknown statements and sources', () => {
      const t = base();
      t.sections.push({
        title: 'Two',
        standards: [
          { id: 'a-one', text: 'Again' },
          { id: 'Bad Id', text: 'Bad' },
        ],
      });
      t.cqcStatements = ['NOT_A_STATEMENT'];
      t.sources = ['nowhere'];
      const errors = validateAuditLibrary(library, [t], codes);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('standard a-one is used twice'),
          expect.stringContaining('"Bad Id" must be kebab-case'),
          expect.stringContaining(
            'NOT_A_STATEMENT is not a CQC quality statement',
          ),
          expect.stringContaining('unknown source nowhere'),
        ]),
      );
    });

    it('refuses an unknown area, key question or frequency, bad windows, and an empty section', () => {
      const t = {
        ...base(),
        area: 'NOWHERE',
        keyQuestion: 'SAFEST',
        frequency: 'DAILY',
        lateDays: 90,
        sections: [{ title: 'Empty', standards: [] }],
      };
      const errors = validateAuditLibrary(library, [t], codes);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('unknown area NOWHERE'),
          expect.stringContaining('keyQuestion must be one of'),
          expect.stringContaining('frequency must be one of'),
          expect.stringContaining('lateDays must be 0 to 60 days'),
          expect.stringContaining('section "Empty" has no standards'),
        ]),
      );
    });
  });
});
