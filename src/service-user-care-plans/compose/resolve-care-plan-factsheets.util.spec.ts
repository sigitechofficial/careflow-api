import { buildCarePlanPersonalisationContext } from '../../care-plan-text/care-plan-text.util';
import { resolveCarePlanFactsheets } from './resolve-care-plan-factsheets.util';

describe('resolveCarePlanFactsheets', () => {
  const personalisation = buildCarePlanPersonalisationContext({
    firstName: 'Margaret',
    lastName: 'Hughes',
    preferredName: 'Maggie',
    serviceUserNumber: 'SU-1042',
  });

  it('returns attached factsheets for dementia care plan with personalised tokens', () => {
    const sheets = resolveCarePlanFactsheets('Dementia Care plan', personalisation);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].code).toBe('dementia');
    expect(sheets[0].contentHtml).toContain('Maggie');
    expect(sheets[0].plainText).toContain('Maggie');
  });

  it('returns multiple sheets for master care plan', () => {
    const sheets = resolveCarePlanFactsheets('Risk Assessment and Care Plan', personalisation);
    expect(sheets.map((s) => s.code)).toEqual(['falls', 'medication']);
  });

  it('returns empty list for templates without attachments', () => {
    expect(resolveCarePlanFactsheets('Continence', personalisation)).toEqual([]);
  });
});
