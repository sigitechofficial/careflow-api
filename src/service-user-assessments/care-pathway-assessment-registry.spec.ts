import {
  getCarePathwayAutoLinkCarePlanNames,
  getCarePathwayFormReviewSchedule,
  resolveCarePathwayAssessmentCatalogEntry,
} from './care-pathway-assessment-registry';

describe('care-pathway-assessment-registry', () => {
  it('resolves bed rail assessment review and links', () => {
    const entry = resolveCarePathwayAssessmentCatalogEntry('Bed Rail Assessment');
    expect(entry?.formName).toBe('Bed Rail Assessment');
    expect(entry?.linkCarePlanFormNames).toEqual(['Personal Safety', 'Mobility']);
    expect(getCarePathwayFormReviewSchedule('Bed Rail Assessment')?.defaultIntervalDays).toBe(365);
  });

  it('resolves choking assessment with 180-day interval', () => {
    const schedule = getCarePathwayFormReviewSchedule('Choking Risk Assessment');
    expect(schedule?.defaultIntervalDays).toBe(180);
    expect(getCarePathwayAutoLinkCarePlanNames('Choking Risk Assessment')).toEqual([
      'Eating and Drinking',
    ]);
  });

  it('returns empty links for unknown forms', () => {
    expect(getCarePathwayAutoLinkCarePlanNames('Custom Org Form')).toEqual([]);
  });
});
