import {
  carePlanInstanceDisplayStatus,
  consumePublishedDraftWhere,
} from './care-plan-instance-display-status.util';

describe('carePlanInstanceDisplayStatus', () => {
  it('is NOT_STARTED when there is no draft and no published version', () => {
    expect(carePlanInstanceDisplayStatus({ hasDraft: false, hasPublishedVersion: false })).toBe(
      'NOT_STARTED',
    );
  });

  it('is DRAFT before the first publish', () => {
    expect(carePlanInstanceDisplayStatus({ hasDraft: true, hasPublishedVersion: false })).toBe(
      'DRAFT',
    );
  });

  it('is PUBLISHED when the pre-publish draft has been consumed', () => {
    expect(carePlanInstanceDisplayStatus({ hasDraft: false, hasPublishedVersion: true })).toBe(
      'PUBLISHED',
    );
  });

  it('is PUBLISHED_WITH_DRAFT only when a later draft exists after publish', () => {
    expect(carePlanInstanceDisplayStatus({ hasDraft: true, hasPublishedVersion: true })).toBe(
      'PUBLISHED_WITH_DRAFT',
    );
  });
});

describe('consumePublishedDraftWhere', () => {
  it('targets the exact draft snapshot, not a later update on the same instance', () => {
    const publishedFrom = {
      id: 'draft-1',
      instanceId: 'instance-1',
      updatedAt: new Date('2026-08-20T10:00:00.000Z'),
    };
    expect(consumePublishedDraftWhere(publishedFrom)).toEqual(publishedFrom);

    const laterDraft = {
      ...publishedFrom,
      updatedAt: new Date('2026-08-20T10:05:00.000Z'),
    };
    expect(consumePublishedDraftWhere(publishedFrom).updatedAt).not.toEqual(laterDraft.updatedAt);
  });
});
