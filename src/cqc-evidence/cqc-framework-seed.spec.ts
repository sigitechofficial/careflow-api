import { readFileSync } from 'fs';
import { join } from 'path';
import {
  loadCqcFrameworks,
  planFrameworkRemap,
  statementsOf,
  validateCqcFramework,
  validateCqcFrameworkSet,
  type CqcFramework,
} from '../../prisma/seed-lib/cqc-framework';
import { loadSurveyLibrary, surveyQuestions } from '../../prisma/seed-lib/survey-library';
import { matchStatement } from './cqc-statement-match.util';

const frameworks = loadCqcFrameworks();
const v1 = frameworks[0];
const matchable = v1.keyQuestions.flatMap((k) =>
  k.statements.map((s) => ({ id: s.code, code: s.code, title: s.title, aliases: s.aliases, keyQuestionCode: k.code })),
);

describe('CQC framework seed data', () => {
  it('has the single assessment framework as the active version 1: 5 key questions, 34 statements, 6 categories', () => {
    expect(frameworks).toHaveLength(1);
    expect(v1).toMatchObject({ version: 1, status: 'ACTIVE' });
    expect(v1.keyQuestions.map((k) => k.code)).toEqual(['SAFE', 'EFFECTIVE', 'CARING', 'RESPONSIVE', 'WELL_LED']);
    expect(v1.keyQuestions.map((k) => k.statements.length)).toEqual([8, 6, 5, 7, 8]);
    expect(statementsOf(v1)).toHaveLength(34);
    expect(v1.evidenceCategories.map((c) => c.code)).toEqual([
      'PEOPLES_EXPERIENCE',
      'STAFF_FEEDBACK',
      'PARTNER_FEEDBACK',
      'OBSERVATION',
      'PROCESSES',
      'OUTCOMES',
    ]);
  });

  it('records which titles could not be checked against an opened source', () => {
    const unverified = statementsOf(v1).filter((s) => s.verification.status === 'unverified');
    expect(unverified.length).toBeGreaterThan(0);
    for (const s of unverified) expect(s.verification.sources).toEqual(['access-group']);
  });

  it('rejects a duplicate code, a long copied summary and a second active version', () => {
    const bad = JSON.parse(JSON.stringify(v1)) as CqcFramework;
    bad.keyQuestions[0].statements[1].code = bad.keyQuestions[0].statements[0].code;
    bad.keyQuestions[1].statements[0].summary = 'word '.repeat(80);
    const errors = validateCqcFramework(bad, 'bad.json');
    expect(errors.join('\n')).toMatch(/code is used twice/);
    expect(errors.join('\n')).toMatch(/at most 45 words/);
    expect(validateCqcFrameworkSet([v1, { ...v1, version: 2 }]).join('\n')).toMatch(/Exactly one framework version must be ACTIVE/);
  });

  it('plans re-mapping evidence from version 1 to a new active version through mapsFrom', () => {
    const v2: CqcFramework = {
      ...JSON.parse(JSON.stringify(v1)),
      version: 2,
      status: 'ACTIVE',
      keyQuestions: v1.keyQuestions.map((k) => ({
        ...k,
        statements: k.code === 'SAFE'
          ? [{ ...k.statements[0], code: 'SAFE_SAFETY_CULTURE', title: 'Safety culture', mapsFrom: ['SAFE_LEARNING_CULTURE', 'SAFE_SAFEGUARDING'] }]
          : k.statements.map((s) => ({ ...s, mapsFrom: [s.code] })),
      })),
      evidenceCategories: v1.evidenceCategories.map((c) => ({ ...c, mapsFrom: [c.code] })),
    };
    const set = [{ ...v1, status: 'RETIRED' as const }, v2];
    expect(validateCqcFrameworkSet(set)).toEqual([]);
    const plan = planFrameworkRemap(set);
    expect(plan.statements.get('v1:SAFE_LEARNING_CULTURE')).toEqual(['SAFE_SAFETY_CULTURE']);
    expect(plan.statements.get('v1:CARING_KINDNESS_DIGNITY')).toEqual(['CARING_KINDNESS_DIGNITY']);
    expect(plan.unmappedStatements).toContain('v1:SAFE_MEDICINES');
    expect(plan.categories.get('v1:PROCESSES')).toBe('PROCESSES');
  });

  it('resolves every quality statement named by the survey library', () => {
    const unmatched: string[] = [];
    for (const file of loadSurveyLibrary()) {
      for (const s of file.surveys) {
        const labels = [...s.cqc.qualityStatements, ...surveyQuestions(s).flatMap((q) => (q.evidence ? [q.evidence] : []))];
        for (const label of labels) if (!matchStatement(label, matchable)) unmatched.push(`${s.reference}: ${label}`);
      }
    }
    expect(unmatched).toEqual([]);
  });

  it('seed code never imports from src/', () => {
    for (const f of ['../../prisma/seed-lib/cqc-framework.ts', '../../prisma/seeds/cqc-framework.seed.ts']) {
      expect(readFileSync(join(__dirname, f), 'utf8')).not.toMatch(/from ['"][./]*src\//);
    }
  });
});
