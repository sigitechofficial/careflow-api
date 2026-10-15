/**
 * "Care plan update" measures are completed by a published care plan version — a saved draft is
 * not seen by carers, so it is not evidence. Which versions count:
 * - an existing plan was named: a version of that plan published after the measure was added;
 * - "new care plan needed": any version of a plan for the incident's service user(s) that was
 *   created after the measure was added.
 * A version already used as evidence for another measure doesn't count again.
 */
export type CarePlanMeasureState = {
  id: string;
  createdAt: Date;
  newRecordNeeded: boolean;
  /** Care plan instance ids the measure named. */
  linkedInstanceIds: string[];
};

export type CarePlanVersionState = {
  instanceId: string;
  instanceServiceUserId: string;
  instanceCreatedAt: Date;
  publishedAt: Date;
  /** The measure this version is already evidence for, if any. */
  incidentActionId: string | null;
};

export function versionCompletesCarePlanMeasure(
  measure: CarePlanMeasureState,
  version: CarePlanVersionState,
  incidentServiceUserIds: string[],
): boolean {
  if (version.incidentActionId && version.incidentActionId !== measure.id) return false;
  if (!incidentServiceUserIds.includes(version.instanceServiceUserId)) return false;
  if (measure.newRecordNeeded) {
    return version.instanceCreatedAt.getTime() > measure.createdAt.getTime();
  }
  return (
    measure.linkedInstanceIds.includes(version.instanceId) &&
    version.publishedAt.getTime() > measure.createdAt.getTime()
  );
}

/** The incident's service users: the primary one first, then everyone else involved. */
export function incidentServiceUserIds(incident: {
  primaryServiceUserId: string | null;
  involvedServiceUserIds: string[];
}): string[] {
  return [
    ...new Set(
      [incident.primaryServiceUserId, ...incident.involvedServiceUserIds].filter(
        (v): v is string => !!v,
      ),
    ),
  ];
}
