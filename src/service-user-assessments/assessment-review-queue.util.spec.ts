import { buildAssessmentReviewQueueItem, filterReviewQueueItems } from './assessment-review-queue.util';

describe('assessment-review-queue.util', () => {
  it('flags overdue waterlow in queue', () => {
    const item = buildAssessmentReviewQueueItem({
      serviceUserId: 'su-1',
      serviceUserName: 'Margaret Hughes',
      assessmentId: 'a-1',
      assessmentKey: 'waterlow',
      assessmentTitle: 'Waterlow',
      latestCompletionId: 'c-1',
      latestCompletedAt: new Date('2026-04-01T00:00:00.000Z'),
      snapshot: { waterlow: { score: 12 } },
      now: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(item.review.status).toBe('overdue');
    expect(item.queueReasons).toContain('Scheduled review overdue');
  });

  it('filters to alerts only by default', () => {
    const ok = buildAssessmentReviewQueueItem({
      serviceUserId: 'su-1',
      serviceUserName: 'Test',
      assessmentId: 'a-1',
      assessmentKey: 'mca-screening',
      assessmentTitle: 'MCA',
      latestCompletionId: 'c-1',
      latestCompletedAt: new Date('2026-05-01T00:00:00.000Z'),
      snapshot: {},
      now: new Date('2026-06-01T00:00:00.000Z'),
    });
    const overdue = buildAssessmentReviewQueueItem({
      serviceUserId: 'su-2',
      serviceUserName: 'Test 2',
      assessmentId: 'a-2',
      assessmentKey: 'waterlow',
      assessmentTitle: 'Waterlow',
      latestCompletionId: 'c-2',
      latestCompletedAt: new Date('2026-04-01T00:00:00.000Z'),
      snapshot: { waterlow: { score: 10 } },
      now: new Date('2026-06-01T00:00:00.000Z'),
    });
    const filtered = filterReviewQueueItems([ok, overdue], { alertsOnly: true });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].assessmentKey).toBe('waterlow');
  });
});
