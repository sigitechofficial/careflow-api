import {
  API_NOT_FOUND_ERROR_EXAMPLE,
  API_VALIDATION_ERROR_EXAMPLE,
  wrapApiEnvelope,
} from './api-envelope.example';
import {
  MEDICATION_ADMINISTERED_REPORT_ENVELOPE_EXAMPLE,
  MEDICATION_EVENT_CREATED_ENVELOPE_EXAMPLE,
  MEDICATION_EVENTS_LIST_ENVELOPE_EXAMPLE,
  MEDICATION_REGULAR_CHART_ENVELOPE_EXAMPLE,
  MEDICATION_SUPPLY_BUNDLE_ENVELOPE_EXAMPLE,
} from './medication-api.examples';

function assertEnvelope(
  body: Record<string, unknown>,
  opts?: { dataIsArray?: boolean; expectMetaKeys?: string[] },
) {
  expect(body.success).toBe(true);
  expect(typeof body.message).toBe('string');
  expect(body.data).toBeDefined();
  if (opts?.dataIsArray) {
    expect(Array.isArray(body.data)).toBe(true);
  }
  expect(body.meta).toBeDefined();
  if (opts?.expectMetaKeys?.length) {
    for (const key of opts.expectMetaKeys) {
      expect(body.meta).toHaveProperty(key);
    }
  }
}

describe('medication API golden examples', () => {
  it('wrapApiEnvelope produces standard success shape', () => {
    const ex = wrapApiEnvelope({ ok: true }, { page: 1 });
    assertEnvelope(ex as Record<string, unknown>, { expectMetaKeys: ['page'] });
  });

  it('validation error example matches HttpExceptionFilter', () => {
    expect(API_VALIDATION_ERROR_EXAMPLE.success).toBe(false);
    expect(API_VALIDATION_ERROR_EXAMPLE.message).toBeTruthy();
    expect(Array.isArray(API_VALIDATION_ERROR_EXAMPLE.errors)).toBe(true);
  });

  it('not found error example', () => {
    expect(API_NOT_FOUND_ERROR_EXAMPLE.success).toBe(false);
    expect(API_NOT_FOUND_ERROR_EXAMPLE.message).toContain('not found');
  });

  it('regular MAR chart example', () => {
    assertEnvelope(MEDICATION_REGULAR_CHART_ENVELOPE_EXAMPLE as Record<string, unknown>);
    const data = MEDICATION_REGULAR_CHART_ENVELOPE_EXAMPLE.data as Record<string, unknown>;
    expect(data.monthStats).toBeDefined();
    expect(data.summary).toBeDefined();
    expect(Array.isArray(data.medications)).toBe(true);
    expect(Array.isArray(data.legend)).toBe(true);
    const stats = data.monthStats as Record<string, unknown>;
    expect(stats).toHaveProperty('marCompletionPercent');
    expect(stats).toHaveProperty('scheduledToDate');
  });

  it('supply bundle example', () => {
    assertEnvelope(MEDICATION_SUPPLY_BUNDLE_ENVELOPE_EXAMPLE as Record<string, unknown>);
    const meds = (MEDICATION_SUPPLY_BUNDLE_ENVELOPE_EXAMPLE.data as { medications: unknown[] }).medications;
    expect(meds.length).toBeGreaterThan(0);
    expect(meds[0]).toHaveProperty('supplySummary');
  });

  it('create event example', () => {
    assertEnvelope(MEDICATION_EVENT_CREATED_ENVELOPE_EXAMPLE as Record<string, unknown>);
    const event = MEDICATION_EVENT_CREATED_ENVELOPE_EXAMPLE.data as Record<string, unknown>;
    expect(event.statusCode).toBe('G');
    expect(event.medication).toBeDefined();
  });

  it('events list example', () => {
    assertEnvelope(MEDICATION_EVENTS_LIST_ENVELOPE_EXAMPLE as Record<string, unknown>, {
      dataIsArray: true,
      expectMetaKeys: ['page', 'total', 'totalPages'],
    });
  });

  it('administered report example', () => {
    assertEnvelope(MEDICATION_ADMINISTERED_REPORT_ENVELOPE_EXAMPLE as Record<string, unknown>, {
      dataIsArray: true,
      expectMetaKeys: ['page', 'total'],
    });
  });
});
