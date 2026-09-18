import {
  buildTimelineUpsertData,
  checkInTimelineDetail,
  formatTimelineHm,
  observationTimelineDetail,
  mapRowToTimelineApiItem,
  sortTimelineRows,
  summarizeTimelineDetail,
  taskOutcomeTimelineDetail,
  taskOutcomeTimelineTone,
} from './visit-timeline.util';
import {
  HANDOVER_TIMELINE_SOURCE_ID,
  VISIT_NOTE_TIMELINE_SOURCE_ID,
} from './visit-timeline.types';

describe('visit-timeline.util', () => {
  it('formats HH:mm as UTC wall-clock by default (matches admin)', () => {
    expect(formatTimelineHm(new Date('2026-08-06T05:02:00.000Z'))).toBe('05:02');
    expect(formatTimelineHm(new Date('2026-01-15T05:02:00.000Z'))).toBe('05:02');
  });

  it('formats HH:mm in an explicit timezone when provided', () => {
    // Aug is BST (UTC+1): 05:02Z → 06:02 London
    expect(formatTimelineHm(new Date('2026-08-06T05:02:00.000Z'), 'Europe/London')).toBe(
      '06:02',
    );
    expect(formatTimelineHm(new Date('2026-01-15T05:02:00.000Z'), 'Europe/London')).toBe(
      '05:02',
    );
  });

  it('summarizes long detail text', () => {
    const long = 'x'.repeat(300);
    const summary = summarizeTimelineDetail(long);
    expect(summary).not.toBeNull();
    expect(summary!.length).toBeLessThanOrEqual(280);
    expect(summary!.endsWith('…')).toBe(true);
  });

  it('maps task outcomes to human labels and tones', () => {
    expect(taskOutcomeTimelineDetail('COMPLETED')).toBe('Completed');
    expect(taskOutcomeTimelineDetail('DECLINED')).toBe('Declined');
    expect(taskOutcomeTimelineTone('COMPLETED')).toBe('success');
    expect(taskOutcomeTimelineTone('DECLINED')).toBe('danger');
  });

  it('maps check-in method detail', () => {
    expect(checkInTimelineDetail('GPS')).toBe('GPS confirmed');
    expect(checkInTimelineDetail('MANUAL')).toBe('Manual clock-in');
  });

  it('formats blood pressure as systolic/diastolic, not systolic-only', () => {
    expect(
      observationTimelineDetail({
        typeCode: 'BLOOD_PRESSURE',
        numericValue: 95,
        unit: 'mmHg',
        payload: { systolic: 95, diastolic: 62 },
        value: '95/62 mmHg',
        outcome: 'recorded',
      }),
    ).toBe('95/62 mmHg');
  });


  it('appends a range warning for abnormal observations', () => {
    expect(
      observationTimelineDetail({
        typeCode: 'BLOOD_PRESSURE',
        numericValue: 1000,
        unit: 'mmHg',
        payload: { systolic: 1000, diastolic: 80, abnormal: true },
        value: '1000/80 mmHg',
        outcome: 'recorded',
      }),
    ).toBe('1000/80 mmHg · Outside expected range');
  });

  it('keeps unable observations as a reason, not a reading', () => {
    expect(
      observationTimelineDetail({
        typeCode: 'BLOOD_PRESSURE',
        payload: { systolic: 120, diastolic: 80 },
        outcome: 'unable',
        unableReasonCode: 'equipment_unavailable',
      }),
    ).toBe('equipment_unavailable');
  });

  it('sorts ascending by occurredAt then id', () => {
    const a = { id: 'b', occurredAt: new Date('2026-08-06T10:00:00.000Z') };
    const b = { id: 'a', occurredAt: new Date('2026-08-06T10:00:00.000Z') };
    const c = { id: 'c', occurredAt: new Date('2026-08-06T09:00:00.000Z') };
    expect(sortTimelineRows([a, b, c]).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('builds stable upsert keys for singleton note/handover', () => {
    const note = buildTimelineUpsertData({
      scheduledJobId: 'job-1',
      eventType: 'visit_note',
      sourceType: 'log_note',
      sourceId: VISIT_NOTE_TIMELINE_SOURCE_ID,
      title: 'Visit note',
      detail: 'Hello',
      tone: 'ink',
      occurredAt: new Date('2026-08-06T10:00:00.000Z'),
      isDraft: false,
    });
    const note2 = buildTimelineUpsertData({
      scheduledJobId: 'job-1',
      eventType: 'visit_note',
      sourceType: 'log_note',
      sourceId: VISIT_NOTE_TIMELINE_SOURCE_ID,
      title: 'Visit note',
      detail: 'Updated',
      tone: 'ink',
      occurredAt: new Date('2026-08-06T11:00:00.000Z'),
      isDraft: false,
    });
    expect(note.sourceId).toBe(VISIT_NOTE_TIMELINE_SOURCE_ID);
    expect(note.idempotencyKey).toBe(note2.idempotencyKey);
    expect(note2.detail).toBe('Updated');

    const handover = buildTimelineUpsertData({
      scheduledJobId: 'job-1',
      eventType: 'handover',
      sourceType: 'handover',
      sourceId: HANDOVER_TIMELINE_SOURCE_ID,
      title: 'Handover',
      detail: 'Client dizzy',
      tone: 'warning',
      occurredAt: new Date('2026-08-06T10:45:00.000Z'),
    });
    expect(handover.sourceId).toBe(HANDOVER_TIMELINE_SOURCE_ID);
  });

  it('maps DB row to mobile TimelineItem shape', () => {
    const item = mapRowToTimelineApiItem({
      id: 'tl-1',
      eventType: 'clock_in',
      occurredAt: new Date('2026-08-06T05:02:00.000Z'),
      timeLabel: '05:02',
      title: 'Clocked in',
      detail: 'GPS confirmed',
      tone: 'primary',
      sourceType: 'check_in',
      sourceId: 'check_in',
      logEntryId: null,
    });
    expect(item).toMatchObject({
      id: 'tl-1',
      time: '05:02',
      title: 'Clocked in',
      detail: 'GPS confirmed',
      subtitle: 'GPS confirmed',
      tone: 'primary',
      type: 'clock_in',
      sourceType: 'check_in',
      sourceId: 'check_in',
    });
    expect(item.occurredAt).toBe('2026-08-06T05:02:00.000Z');
  });
});
