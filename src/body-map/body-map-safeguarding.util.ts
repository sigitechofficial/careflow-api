import { BodyMapRecordType } from '@prisma/client';

export function evaluateSafeguardingTrigger(input: {
  recordType: BodyMapRecordType;
  subType?: string | null;
  causeSummary?: string | null;
  observationDetails?: Record<string, unknown> | null;
}): { safeguardingTriggered: boolean; managerReviewRequired: boolean } {
  const details = input.observationDetails ?? {};
  const causeKnown = details.causeKnown as string | undefined;
  const consistent = details.consistentWithInjury as string | undefined;
  const sub = (input.subType ?? '').toLowerCase();
  const unexplained =
    sub.includes('unexplained') ||
    causeKnown === 'no' ||
    consistent === 'no';

  const injuryLike =
    input.recordType === BodyMapRecordType.INJURY ||
    input.recordType === BodyMapRecordType.SAFEGUARDING;

  const safeguardingTriggered = injuryLike && unexplained;
  return {
    safeguardingTriggered,
    managerReviewRequired: safeguardingTriggered,
  };
}
