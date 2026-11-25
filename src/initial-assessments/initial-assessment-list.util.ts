import type { InitialAssessmentStatus } from '@prisma/client';

/** One bucket per row on the admin "Initial assessments" list. */
export type InitialAssessmentListBucket =
  | 'in_progress'
  | 'waiting_review'
  | 'reviewed'
  | 'archived'
  | 'cancelled'
  | 'no_ia';

/** Filter values: a bucket, `overdue_actions`, or `all` (every bucket except archived / cancelled). */
export const INITIAL_ASSESSMENT_LIST_VIEWS = [
  'all',
  'in_progress',
  'waiting_review',
  'reviewed',
  'overdue_actions',
  'no_ia',
  'archived',
  'cancelled',
] as const;
export type InitialAssessmentListView = (typeof INITIAL_ASSESSMENT_LIST_VIEWS)[number];

/** Draft and In progress are both shown as "In progress"; no IA at all is `no_ia`. */
export function bucketForStatus(status: InitialAssessmentStatus | null | undefined): InitialAssessmentListBucket {
  switch (status) {
    case 'DRAFT':
    case 'IN_PROGRESS':
      return 'in_progress';
    case 'SUBMITTED':
      return 'waiting_review';
    case 'REVIEWED':
      return 'reviewed';
    case 'ARCHIVED':
      return 'archived';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return 'no_ia';
  }
}

export type InitialAssessmentListCounts = {
  in_progress: number;
  waiting_review: number;
  reviewed: number;
  overdue_actions: number;
  no_ia: number;
};

type Classified = { bucket: InitialAssessmentListBucket; overdueActionCount: number };

export function rowMatchesView(row: Classified, view: InitialAssessmentListView): boolean {
  if (view === 'all') return row.bucket !== 'archived' && row.bucket !== 'cancelled';
  if (view === 'overdue_actions') return row.overdueActionCount > 0;
  return row.bucket === view;
}

/** Card counts. Overdue actions counts rows whose IA has at least one open action past its due date. */
export function countBuckets(rows: Classified[]): InitialAssessmentListCounts {
  const counts: InitialAssessmentListCounts = {
    in_progress: 0,
    waiting_review: 0,
    reviewed: 0,
    overdue_actions: 0,
    no_ia: 0,
  };
  for (const row of rows) {
    if (row.bucket in counts) counts[row.bucket as keyof InitialAssessmentListCounts] += 1;
    if (row.overdueActionCount > 0) counts.overdue_actions += 1;
  }
  return counts;
}

export const INITIAL_ASSESSMENT_LIST_SORTS = ['updated', 'started', 'name'] as const;
export type InitialAssessmentListSort = (typeof INITIAL_ASSESSMENT_LIST_SORTS)[number];

type Sortable = {
  serviceUser: { firstName: string; lastName: string };
  assessment: { updatedAt: Date; startedAt: Date } | null;
};

const byName = (a: Sortable, b: Sortable) =>
  `${a.serviceUser.lastName} ${a.serviceUser.firstName}`.localeCompare(
    `${b.serviceUser.lastName} ${b.serviceUser.firstName}`,
    'en-GB',
    { sensitivity: 'base' },
  );

/** updated / started: newest first, rows without an IA last (then by name); name: surname A–Z. */
export function compareListRows(sort: InitialAssessmentListSort) {
  return (a: Sortable, b: Sortable): number => {
    if (sort === 'name') return byName(a, b);
    const pick = (r: Sortable) =>
      r.assessment ? (sort === 'started' ? r.assessment.startedAt : r.assessment.updatedAt).getTime() : -1;
    return pick(b) - pick(a) || byName(a, b);
  };
}
