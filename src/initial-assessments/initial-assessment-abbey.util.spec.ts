import {
  abbeySeverityFromTotal,
  computeAbbeyTotal,
  enrichAbbeyMetadata,
  formatAbbeyCarePlanSuggestion,
  formatPainAssessmentHistorySummary,
  isAbbeyAssessmentComplete,
  isNrsAssessmentComplete,
  isPainElevatedReview,
  isPainToolComplete,
} from './initial-assessment-abbey.util';
import { isPainAssessmentComplete } from '../service-user-assessments/assessment-promotion-p3.util';

const allZero = {
  vocalisation: 0 as const,
  facialExpression: 0 as const,
  bodyLanguage: 0 as const,
  behaviouralChange: 0 as const,
  physiologicalChange: 0 as const,
  physicalChanges: 0 as const,
};

const mixed = {
  vocalisation: 1 as const,
  facialExpression: 2 as const,
  bodyLanguage: 0 as const,
  behaviouralChange: 1 as const,
  physiologicalChange: 2 as const,
  physicalChanges: 1 as const,
};

const abbey11 = {
  vocalisation: 2 as const,
  facialExpression: 2 as const,
  bodyLanguage: 2 as const,
  behaviouralChange: 2 as const,
  physiologicalChange: 2 as const,
  physicalChanges: 1 as const,
};

describe('initial-assessment-abbey.util', () => {
  it('all six 0 → total 0 → none', () => {
    expect(computeAbbeyTotal(allZero)).toBe(0);
    expect(abbeySeverityFromTotal(0)).toBe('none');
    expect(isAbbeyAssessmentComplete(allZero)).toBe(true);
  });

  it('mixed scores → correct total and mild band', () => {
    expect(computeAbbeyTotal(mixed)).toBe(7);
    expect(abbeySeverityFromTotal(7)).toBe('mild');
  });

  it('maps 3–7 mild, 8–13 moderate, 14+ severe', () => {
    expect(abbeySeverityFromTotal(3)).toBe('mild');
    expect(abbeySeverityFromTotal(8)).toBe('moderate');
    expect(abbeySeverityFromTotal(13)).toBe('moderate');
    expect(abbeySeverityFromTotal(14)).toBe('severe');
    expect(abbeySeverityFromTotal(computeAbbeyTotal(abbey11))).toBe('moderate');
  });

  it('one Abbey item missing → incomplete; all-zero complete', () => {
    expect(isAbbeyAssessmentComplete({ ...allZero, physicalChanges: undefined })).toBe(false);
    expect(isAbbeyAssessmentComplete(allZero)).toBe(true);
  });

  it('NRS 0 complete; missing NRS incomplete; values outside 0–10 incomplete', () => {
    expect(isNrsAssessmentComplete(0)).toBe(true);
    expect(isNrsAssessmentComplete(10)).toBe(true);
    expect(isNrsAssessmentComplete(undefined)).toBe(false);
    expect(isNrsAssessmentComplete(11)).toBe(false);
    expect(isNrsAssessmentComplete(-1)).toBe(false);
  });

  it('pain tool complete if Abbey or NRS; neither is incomplete', () => {
    expect(isPainToolComplete({ abbey: allZero })).toBe(true);
    expect(isPainToolComplete({ nrsScore: 0 })).toBe(true);
    expect(isPainToolComplete({ abbey: { vocalisation: 2 } })).toBe(false);
    expect(isPainToolComplete({})).toBe(false);
  });

  it('enrich always derives total and band', () => {
    const enriched = enrichAbbeyMetadata({ ...abbey11, severityBand: 'none' });
    expect(enriched?.total).toBe(11);
    expect(enriched?.severityBand).toBe('moderate');
  });

  it('history summary uses calculated values', () => {
    expect(formatPainAssessmentHistorySummary({ nrsScore: 4 })).toBe('NRS 4/10');
    expect(
      formatPainAssessmentHistorySummary({
        abbey: { ...abbey11, painType: 'acute_on_chronic' },
      }),
    ).toBe('Abbey 11/18 (moderate), acute on chronic');
    expect(
      formatPainAssessmentHistorySummary({
        nrsScore: 4,
        abbey: { ...abbey11, painType: 'acute_on_chronic' },
      }),
    ).toBe('NRS 4/10 · Abbey 11/18 (moderate), acute on chronic');
    expect(
      formatPainAssessmentHistorySummary({
        nrsScore: 0,
        abbey: {
          vocalisation: 0,
          facialExpression: 0,
          bodyLanguage: 0,
          behaviouralChange: 0,
          physiologicalChange: 0,
          physicalChanges: 0,
          dateCompleted: '2026-09-02',
        },
      }),
    ).toMatch(/^NRS 0\/10 · Abbey 0\/18 \(none\) · .+2026$/);
  });

  it('does not convert Abbey total into an NRS 0–10 score', () => {
    const suggestion = formatAbbeyCarePlanSuggestion({
      abbey: { ...abbey11, painType: 'acute_on_chronic' },
    });
    expect(suggestion).toBe('Abbey 11/18 — moderate; acute on chronic (IA Pain Assessment Tool)');
    expect(suggestion).not.toBe('6');
    expect(suggestion).not.toBe('11');
  });

  it('elevated review is Abbey >= 8 or NRS >= 4', () => {
    expect(isPainElevatedReview({ nrsScore: 4 })).toBe(true);
    expect(isPainElevatedReview({ nrsScore: 3 })).toBe(false);
    expect(isPainElevatedReview({ abbey: abbey11 })).toBe(true);
    expect(isPainElevatedReview({ abbey: mixed })).toBe(false);
  });
});

describe('promotion completeness uses Abbey helper', () => {
  it('treats all-zero Abbey as complete and a single domain as incomplete', () => {
    expect(isPainAssessmentComplete({ painAssessment: { abbey: allZero } })).toBe(true);
    expect(isPainAssessmentComplete({ painAssessment: { abbey: { vocalisation: 3 } } })).toBe(false);
    expect(isPainAssessmentComplete({ painAssessment: { nrsScore: 0 } })).toBe(true);
    expect(isPainAssessmentComplete({ painAssessment: {} })).toBe(false);
  });
});
