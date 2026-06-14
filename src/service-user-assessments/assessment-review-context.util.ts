const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCarePathwayAssessmentKey(assessmentKey: string): boolean {
  return UUID_RE.test(assessmentKey);
}

export function resolveCarePathwayFormName(params: {
  assessmentKey: string;
  assessmentTitle?: string | null;
  snapshot?: Record<string, unknown> | null;
}): string | null {
  if (!isCarePathwayAssessmentKey(params.assessmentKey)) return null;
  const snapshotName = params.snapshot?.formName;
  if (typeof snapshotName === 'string' && snapshotName.trim()) return snapshotName.trim();
  if (params.assessmentTitle?.trim()) return params.assessmentTitle.trim();
  return null;
}

export function reviewContextForAssessment(params: {
  assessmentKey: string;
  assessmentTitle?: string | null;
  snapshot?: Record<string, unknown> | null;
}) {
  return {
    assessmentKey: params.assessmentKey,
    carePathwayFormName: resolveCarePathwayFormName(params),
  };
}
