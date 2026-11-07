import { MIN_ANONYMOUS_GROUP_SIZE, buildSurveyBreakdown } from './survey-breakdown.util';

const g = (key: string, responses: number) => ({ key, label: key, responses });

describe('buildSurveyBreakdown', () => {
  it('shows every group for named surveys', () => {
    const out = buildSurveyBreakdown('branch', [g('Leeds', 1), g('York', 2)], false);
    expect(out.suppressed).toBe(false);
    expect(out.groups.map((x) => x.key)).toEqual(['York', 'Leeds']);
  });

  it('shows nothing for an anonymous survey with fewer than 5 responses', () => {
    expect(MIN_ANONYMOUS_GROUP_SIZE).toBe(5);
    const out = buildSurveyBreakdown('jobTitle', [g('Carer', 3), g('Manager', 1)], true);
    expect(out).toMatchObject({ suppressed: true, groups: [] });
    expect(out.note).toMatch(/at least 5/);
  });

  it('combines small anonymous groups when the combined group is large enough', () => {
    const out = buildSurveyBreakdown(
      'branch',
      [g('Leeds', 9), g('York', 3), g('Hull', 2), g('Wakefield', 1)],
      true,
    );
    expect(out.suppressed).toBe(false);
    expect(out.groups).toEqual([
      { key: 'Leeds', label: 'Leeds', responses: 9 },
      { key: 'other', label: 'Other groups (combined)', responses: 6 },
    ]);
  });

  it('withholds the breakdown when the small groups together are still under 5', () => {
    // Showing "Leeds 9" next to a total of 11 would reveal the 2 in the sole Registered Manager group.
    const out = buildSurveyBreakdown('jobTitle', [g('Carer', 9), g('Registered Manager', 2)], true);
    expect(out).toMatchObject({ suppressed: true, groups: [] });
  });

  it('shows anonymous groups that are all 5 or more', () => {
    const out = buildSurveyBreakdown('branch', [g('Leeds', 5), g('York', 7)], true);
    expect(out).toMatchObject({ suppressed: false, note: null });
    expect(out.groups).toHaveLength(2);
  });
});
