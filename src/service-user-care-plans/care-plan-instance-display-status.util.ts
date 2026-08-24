export type CarePlanInstanceDisplayStatus =
  | 'NOT_STARTED'
  | 'DRAFT'
  | 'PUBLISHED'
  | 'PUBLISHED_WITH_DRAFT';

export function carePlanInstanceDisplayStatus(input: {
  hasDraft: boolean;
  hasPublishedVersion: boolean;
}): CarePlanInstanceDisplayStatus {
  if (!input.hasPublishedVersion) {
    return input.hasDraft ? 'DRAFT' : 'NOT_STARTED';
  }
  return input.hasDraft ? 'PUBLISHED_WITH_DRAFT' : 'PUBLISHED';
}

/**
 * Consume only the exact draft row that was copied into the published version.
 * Matching `updatedAt` avoids deleting a newer in-progress update that was saved
 * after this publish snapshot was taken.
 */
export function consumePublishedDraftWhere(draft: {
  id: string;
  instanceId: string;
  updatedAt: Date;
}) {
  return {
    id: draft.id,
    instanceId: draft.instanceId,
    updatedAt: draft.updatedAt,
  };
}
