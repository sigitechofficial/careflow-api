import { COMPLIANCE_REMINDER_STAGES } from '../organisation-general-settings/review-settings.util';
import {
  complianceReminderHorizonDays,
  complianceReminderStage,
  daysToExpiry,
  expiryText,
} from './compliance-expiry-reminder.util';

const ALL = COMPLIANCE_REMINDER_STAGES;

describe('compliance expiry reminder stages', () => {
  it('counts whole calendar days', () => {
    const today = new Date('2026-11-05T18:30:00Z');
    expect(daysToExpiry(new Date('2026-11-05T00:00:00Z'), today)).toBe(0);
    expect(daysToExpiry(new Date('2026-12-05T12:00:00Z'), today)).toBe(30);
    expect(daysToExpiry(new Date('2026-11-04T23:59:00Z'), today)).toBe(-1);
  });

  it('returns nothing outside the furthest enabled stage', () => {
    expect(complianceReminderStage(91, ALL)).toBeNull();
    expect(complianceReminderStage(45, ['EXPIRY_30_DAYS', 'EXPIRED'])).toBeNull();
  });

  it('returns the latest stage crossed, so a missed day is caught up once', () => {
    expect(complianceReminderStage(90, ALL)).toBe('EXPIRY_90_DAYS');
    expect(complianceReminderStage(61, ALL)).toBe('EXPIRY_90_DAYS');
    expect(complianceReminderStage(60, ALL)).toBe('EXPIRY_60_DAYS');
    // Added 20 days before expiry: only the 30-day reminder, not 90 and 60 as well.
    expect(complianceReminderStage(20, ALL)).toBe('EXPIRY_30_DAYS');
    expect(complianceReminderStage(7, ALL)).toBe('EXPIRY_7_DAYS');
    expect(complianceReminderStage(0, ALL)).toBe('EXPIRY_7_DAYS');
  });

  it('sends EXPIRED only after the expiry date and only when enabled', () => {
    expect(complianceReminderStage(-1, ALL)).toBe('EXPIRED');
    expect(complianceReminderStage(-400, ALL)).toBe('EXPIRED');
    expect(complianceReminderStage(-1, ['EXPIRY_30_DAYS'])).toBeNull();
  });

  it('honours the enabled stages', () => {
    expect(complianceReminderStage(5, ['EXPIRY_60_DAYS', 'EXPIRY_30_DAYS'])).toBe('EXPIRY_30_DAYS');
    expect(complianceReminderStage(5, [])).toBeNull();
  });

  it('looks only as far ahead as the furthest stage', () => {
    expect(complianceReminderHorizonDays(ALL)).toBe(90);
    expect(complianceReminderHorizonDays(['EXPIRY_30_DAYS', 'EXPIRED'])).toBe(30);
    expect(complianceReminderHorizonDays(['EXPIRED'])).toBe(0);
  });

  it('describes the expiry', () => {
    expect(expiryText(0, '5 Nov 2026')).toBe('expires today');
    expect(expiryText(1, '6 Nov 2026')).toBe('expires tomorrow');
    expect(expiryText(30, '5 Dec 2026')).toBe('expires in 30 days (5 Dec 2026)');
    expect(expiryText(-2, '3 Nov 2026')).toBe('expired on 3 Nov 2026');
  });
});
