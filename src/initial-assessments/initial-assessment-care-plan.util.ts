export type CarePlanTriggerItem = {
  answerId: string;
  questionId: string;
  questionText: string;
  notes: string | null;
  textValue: string | null;
  section?: { id: string; title: string; sectionNumber: number; carePlanArea?: string | null };
  carePlanArea?: string | null;
  specRef?: string;
};

export type CarePlanRecommendation = {
  id: string;
  carePlanArea: string;
  sectionNumber: number;
  sectionTitle: string;
  title: string;
  triggerCount: number;
  triggers: Array<{
    questionId: string;
    questionText: string;
    specRef?: string;
  }>;
  status: 'pending' | 'accepted' | 'declined' | 'deferred';
  carePathwayFormId?: string;
  carePathwayFormName?: string;
  source?: 'rule' | 'legacy' | 'medical_condition';
  ruleId?: string;
  /**
   * Ids this recommendation was also known by (recommendations merged into it, and legacy ids that
   * depended on answer order). Decisions stored under any of them still apply.
   */
  aliasIds?: string[];
};

function legacyRecommendationId(sectionNumber: number, slug: string): string {
  return `cp-${sectionNumber}-${slug}`;
}

export function buildCarePlanRecommendations(items: CarePlanTriggerItem[]): CarePlanRecommendation[] {
  const byArea = new Map<string, CarePlanTriggerItem[]>();

  for (const item of items) {
    const area =
      item.carePlanArea?.trim() ||
      item.section?.carePlanArea?.trim() ||
      item.section?.title?.trim() ||
      'General care';
    const list = byArea.get(area) ?? [];
    list.push(item);
    byArea.set(area, list);
  }

  const recommendations: CarePlanRecommendation[] = [];

  for (const [carePlanArea, unordered] of byArea) {
    // Answers arrive in database order; the id must not depend on it (one area can span sections).
    const triggers = [...unordered].sort(
      (a, b) => (a.section?.sectionNumber ?? 0) - (b.section?.sectionNumber ?? 0),
    );
    const first = triggers[0];
    const sectionNumber = first.section?.sectionNumber ?? 0;
    const sectionTitle = first.section?.title ?? carePlanArea;
    const slug = carePlanArea.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const otherSections = [
      ...new Set(triggers.map((t) => t.section?.sectionNumber ?? 0).filter((n) => n !== sectionNumber)),
    ];

    recommendations.push({
      id: legacyRecommendationId(sectionNumber, slug),
      ...(otherSections.length
        ? { aliasIds: otherSections.map((n) => legacyRecommendationId(n, slug)) }
        : {}),
      carePlanArea,
      sectionNumber,
      sectionTitle,
      title: `${carePlanArea} care plan update recommended`,
      triggerCount: triggers.length,
      triggers: triggers.map((t) => ({
        questionId: t.questionId,
        questionText: t.questionText,
        specRef: t.specRef,
      })),
      status: 'pending',
      source: 'legacy',
    });
  }

  return recommendations.sort((a, b) => a.sectionNumber - b.sectionNumber);
}
