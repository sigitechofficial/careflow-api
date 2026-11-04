import { CarePlanVisitTaskLinkStatus as LinkStatus } from '@prisma/client';
import type { CarePlanFormFieldRef } from './compose/compose-context.types';
import {
  buildCarePlanDeliveryTasks,
  parsePublishedValuesJson,
} from '../scheduled-jobs-housekeeping/visit-care-plan-delivery.util';

/**
 * Only selection-type fields count as structured requirements. Free text (TEXT / TEXTAREA / rich
 * text) is never read for tasks — no keyword matching or interpretation.
 */
export const STRUCTURED_REQUIREMENT_FIELD_TYPES = new Set([
  'YES_NO',
  'CHECKBOX',
  'SELECT',
  'MULTI_SELECT',
  'RADIO',
]);

export type ReconciliationState =
  | 'LINKED'
  | 'UNLINKED'
  | 'REVIEW_REQUIRED'
  | 'NOT_APPLICABLE';

export type StructuredRequirement = {
  key: string;
  label: string;
  expectedDisplay: string;
};

/** Structured requirements switched on in a published version (same planned items carers record). */
export function structuredCarePlanRequirements(
  fields: CarePlanFormFieldRef[],
  publishedValuesJson: unknown,
): StructuredRequirement[] {
  return buildCarePlanDeliveryTasks(
    fields,
    parsePublishedValuesJson(publishedValuesJson),
  )
    .filter((t) => STRUCTURED_REQUIREMENT_FIELD_TYPES.has(t.fieldType))
    .map((t) => ({
      key: t.fieldKey,
      label: t.label,
      expectedDisplay: t.expectedDisplay,
    }));
}

export type ReconciliationLinkRow = {
  id: string;
  requirementKey: string;
  requirementLabel: string | null;
  status: LinkStatus;
  reason: string | null;
  visitTaskAssignmentId: string | null;
  carePlanPublishedVersionId: string;
  linkedAt: Date;
  linkedById: string | null;
  reviewedAt: Date | null;
  reviewedById: string | null;
};

export type ReconciliationAssignment = {
  id: string;
  taskName: string;
  medicationRoundCode: string;
  dueTime: string | null;
  isActive: boolean;
  deletedAt: Date | null;
};

/**
 * The reconciliation view for one published plan. Nothing is inferred: a requirement with no link
 * is UNLINKED (for a manager to look at), never "missing", and an assignment with no link is just
 * listed as available to link.
 */
export function buildTaskReconciliation(input: {
  requirements: StructuredRequirement[];
  links: ReconciliationLinkRow[];
  assignments: ReconciliationAssignment[];
  currentVersionId: string;
  currentValues: Record<string, unknown>;
  /** Published values of versions the links were confirmed against, by version id. */
  valuesByVersionId: Map<string, Record<string, unknown>>;
  versionNumberById: Map<string, number>;
}) {
  const assignmentById = new Map(input.assignments.map((a) => [a.id, a]));

  const links = input.links.map((link) => {
    const assignment = link.visitTaskAssignmentId
      ? assignmentById.get(link.visitTaskAssignmentId)
      : undefined;
    const assignmentInactive = Boolean(
      link.visitTaskAssignmentId &&
      (!assignment || assignment.deletedAt || !assignment.isActive),
    );
    const requirementGone =
      link.requirementKey !== '' &&
      !input.requirements.some((r) => r.key === link.requirementKey);
    const state: ReconciliationState =
      link.status === LinkStatus.REVIEW_REQUIRED ||
      assignmentInactive ||
      requirementGone
        ? 'REVIEW_REQUIRED'
        : link.status;
    // Same structured value in the version it was confirmed against and now: offered for reuse.
    const previous = input.valuesByVersionId.get(
      link.carePlanPublishedVersionId,
    );
    const suggestedReuse =
      link.status === LinkStatus.REVIEW_REQUIRED &&
      link.requirementKey !== '' &&
      !requirementGone &&
      previous !== undefined &&
      JSON.stringify(previous[link.requirementKey]) ===
        JSON.stringify(input.currentValues[link.requirementKey]);
    return {
      id: link.id,
      requirementKey: link.requirementKey,
      requirementLabel: link.requirementLabel,
      state,
      reason: link.reason,
      visitTaskAssignmentId: link.visitTaskAssignmentId,
      task: assignment
        ? {
            name: assignment.taskName,
            medicationRoundCode: assignment.medicationRoundCode,
            dueTime: assignment.dueTime,
          }
        : null,
      assignmentInactive,
      requirementGone,
      suggestedReuse,
      confirmedForVersionId: link.carePlanPublishedVersionId,
      confirmedForVersionNumber:
        input.versionNumberById.get(link.carePlanPublishedVersionId) ?? null,
      confirmedForCurrentVersion:
        link.carePlanPublishedVersionId === input.currentVersionId,
      linkedAt: link.linkedAt.toISOString(),
      linkedById: link.linkedById,
      reviewedAt: link.reviewedAt?.toISOString() ?? null,
      reviewedById: link.reviewedById,
    };
  });

  const requirements = input.requirements.map((req) => {
    const own = links.filter((l) => l.requirementKey === req.key);
    const state: ReconciliationState = own.some(
      (l) => l.state === 'REVIEW_REQUIRED',
    )
      ? 'REVIEW_REQUIRED'
      : own.some((l) => l.state === 'LINKED')
        ? 'LINKED'
        : own.some((l) => l.state === 'NOT_APPLICABLE')
          ? 'NOT_APPLICABLE'
          : 'UNLINKED';
    return { ...req, state, linkIds: own.map((l) => l.id) };
  });

  const linkedAssignmentIds = new Set(
    input.links.map((l) => l.visitTaskAssignmentId).filter(Boolean),
  );
  // Every active task can be linked (a task may cover more than one requirement).
  const activeAssignments = input.assignments
    .filter((a) => !a.deletedAt && a.isActive)
    .map((a) => ({
      id: a.id,
      taskName: a.taskName,
      medicationRoundCode: a.medicationRoundCode,
      dueTime: a.dueTime,
    }));
  const unlinkedAssignments = activeAssignments.filter((a) => !linkedAssignmentIds.has(a.id));

  return {
    /** False when the plan has no structured requirements: reconcile manually against the plan. */
    hasStructuredRequirements: requirements.length > 0,
    requirements,
    links,
    unlinkedAssignments,
    activeAssignments,
    counts: {
      linked: links.filter((l) => l.state === 'LINKED').length,
      reviewRequired: links.filter((l) => l.state === 'REVIEW_REQUIRED').length,
      notApplicable: links.filter((l) => l.state === 'NOT_APPLICABLE').length,
      unlinkedRequirements: requirements.filter((r) => r.state === 'UNLINKED')
        .length,
    },
  };
}
