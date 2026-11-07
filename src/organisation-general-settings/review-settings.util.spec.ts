import { DEFAULT_REVIEW_SETTINGS, loadReviewSettings, parseReviewSettings } from './review-settings.util';

describe('parseReviewSettings', () => {
  it('fills every default when nothing is saved', () => {
    expect(parseReviewSettings(null)).toEqual(DEFAULT_REVIEW_SETTINGS);
    expect(parseReviewSettings({})).toEqual(DEFAULT_REVIEW_SETTINGS);
  });

  it('keeps the defaults that match the behaviour before the settings existed', () => {
    const d = DEFAULT_REVIEW_SETTINGS;
    expect([d.carePlanDueSoonDays, d.carePlanListDueWithinDays, d.reminderRepeatDays]).toEqual([30, 7, 7]);
    expect(d.riskReviewDays).toEqual({ HIGH: 14, MEDIUM: 30, LOW: 90 });
    expect([d.visitPlanFirstReviewDays, d.visitPlanSuspensionReviewDays]).toEqual([42, 7]);
    expect([d.medicationDueSoonDays, d.medicationReviewDueSoonDays]).toEqual([14, 30]);
    expect(d.complianceReminderStages).toEqual([
      'EXPIRY_90_DAYS',
      'EXPIRY_60_DAYS',
      'EXPIRY_30_DAYS',
      'EXPIRY_7_DAYS',
      'EXPIRED',
    ]);
  });

  it('keeps valid values and falls back per key for invalid ones', () => {
    const s = parseReviewSettings({
      reminderHour: 23,
      carePlanDueSoonDays: 45,
      carePlanListDueWithinDays: 0,
      visitPlanFirstReviewDays: 28.5,
      riskReviewDays: { HIGH: 7, MEDIUM: 'x', LOW: 400 },
      complianceRemindersEnabled: false,
    });
    expect(s.reminderHour).toBe(23);
    expect(s.carePlanDueSoonDays).toBe(45);
    expect(s.carePlanListDueWithinDays).toBe(7);
    expect(s.visitPlanFirstReviewDays).toBe(42);
    expect(s.riskReviewDays).toEqual({ HIGH: 7, MEDIUM: 30, LOW: 90 });
    expect(s.complianceRemindersEnabled).toBe(false);
  });

  it('keeps compliance stages in canonical order and drops unknown ones', () => {
    expect(
      parseReviewSettings({ complianceReminderStages: ['EXPIRED', 'NOPE', 'EXPIRY_30_DAYS', 'EXPIRY_30_DAYS'] })
        .complianceReminderStages,
    ).toEqual(['EXPIRY_30_DAYS', 'EXPIRED']);
    expect(parseReviewSettings({ complianceReminderStages: [] }).complianceReminderStages).toEqual([]);
  });

  it('sanitises assessment interval overrides', () => {
    const s = parseReviewSettings({
      assessmentIntervals: {
        waterlow: { defaultIntervalDays: 28, elevatedRiskIntervalDays: 0, dueSoonLeadDays: 5, junk: 1 },
        must: {},
        'Bad Key!': { defaultIntervalDays: 10 },
        'bed-rail-assessment': { defaultIntervalDays: 180 },
      },
    });
    expect(s.assessmentIntervals).toEqual({
      waterlow: { defaultIntervalDays: 28, dueSoonLeadDays: 5 },
      'bed-rail-assessment': { defaultIntervalDays: 180 },
    });
  });

  it('loads from any client, with defaults when the row is missing', async () => {
    const client = { organisationGeneralSettings: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(loadReviewSettings(client)).resolves.toEqual(DEFAULT_REVIEW_SETTINGS);
    client.organisationGeneralSettings.findFirst.mockResolvedValue({ reviewSettings: { reminderRepeatDays: 3 } });
    expect((await loadReviewSettings(client)).reminderRepeatDays).toBe(3);
  });
});
