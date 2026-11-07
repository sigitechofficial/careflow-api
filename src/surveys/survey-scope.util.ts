import type { OrgScope } from '../common/org-scope/org-scope.types';

/**
 * Branch-restricted users see a survey only when every branch it is for is one of theirs —
 * a survey spanning other branches holds other branches' people and answers. Templates with
 * no branch are shared starting points (no people, no answers) and visible to everyone.
 */
export function surveyVisibleInScope(
  scope: Pick<OrgScope, 'locationIds'>,
  survey: { locationIds: string[]; isTemplate: boolean },
): boolean {
  if (scope.locationIds === null) return true;
  if (survey.locationIds.length === 0) return survey.isTemplate;
  const allowed = new Set(scope.locationIds);
  return survey.locationIds.every((id) => allowed.has(id));
}
