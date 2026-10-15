/**
 * An "extra visit" is a one-off rota visit added from the visit plan's "Changes for specific dates".
 * It sits under a slot for naming and reporting, but keeps its own time and carers — slot-level
 * changes (time change, carer sync) must leave it alone.
 */
export const VISIT_PLAN_EXTRA_JOB_METADATA_KEY = 'visitPlanExtra';

export function isVisitPlanExtraJobMetadata(metadata: unknown): boolean {
  return (
    metadata !== null &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>)[VISIT_PLAN_EXTRA_JOB_METADATA_KEY] === true
  );
}
