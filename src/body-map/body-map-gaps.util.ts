import { BodyMapRecordStatus, BodyMapRecordType } from '@prisma/client';

export type BodyMapGapItem = {
  recordId: string;
  code: string;
  message: string;
};

type GapRecord = {
  id: string;
  recordType: string;
  subType: string | null;
  status: string;
  nextReviewAt: string | null;
  medicationSite?: {
    lastAdministrationEventId: string | null;
  } | null;
  links?: { linkedModule: string }[];
  actionSummary?: string | null;
  closedAt?: string | null;
};

const CLOSED = new Set<string>([
  BodyMapRecordStatus.CLOSED,
  BodyMapRecordStatus.RESOLVED,
]);

export function computeBodyMapOutstandingGaps(records: GapRecord[]): BodyMapGapItem[] {
  const now = Date.now();
  const gaps: BodyMapGapItem[] = [];

  for (const r of records) {
    if (CLOSED.has(r.status)) continue;

    if (r.nextReviewAt && new Date(r.nextReviewAt).getTime() < now) {
      gaps.push({
        recordId: r.id,
        code: 'REVIEW_OVERDUE',
        message: `Review overdue (${r.subType ?? r.recordType})`,
      });
    }

    if (
      r.recordType === BodyMapRecordType.MEDICATION &&
      r.medicationSite &&
      !r.medicationSite.lastAdministrationEventId
    ) {
      gaps.push({
        recordId: r.id,
        code: 'MAR_DOSE_UNLINKED',
        message: 'Medication site without linked MAR administration event',
      });
    }

    if (
      (r.recordType === BodyMapRecordType.INJURY ||
        r.recordType === BodyMapRecordType.SAFEGUARDING) &&
      !r.links?.some(l => l.linkedModule === 'INCIDENT')
    ) {
      gaps.push({
        recordId: r.id,
        code: 'MISSING_INCIDENT_LINK',
        message: 'Injury/safeguarding record not linked to an incident',
      });
    }

    if (
      (r.recordType === BodyMapRecordType.PRESSURE ||
        r.recordType === BodyMapRecordType.WOUND) &&
      !r.links?.some(l => l.linkedModule === 'CARE_PLAN')
    ) {
      gaps.push({
        recordId: r.id,
        code: 'MISSING_CARE_PLAN_LINK',
        message: 'Wound/pressure record not linked to a care plan',
      });
    }

    if (!r.actionSummary?.trim()) {
      gaps.push({
        recordId: r.id,
        code: 'NO_ACTION_RECORDED',
        message: 'No action summary recorded on open record',
      });
    }
  }

  return gaps;
}
