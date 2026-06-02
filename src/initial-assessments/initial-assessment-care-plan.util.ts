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
  status: 'pending' | 'accepted' | 'declined';
};

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

  for (const [carePlanArea, triggers] of byArea) {
    const first = triggers[0];
    const sectionNumber = first.section?.sectionNumber ?? 0;
    const sectionTitle = first.section?.title ?? carePlanArea;
    const slug = carePlanArea.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    recommendations.push({
      id: `cp-${sectionNumber}-${slug}`,
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
    });
  }

  return recommendations.sort((a, b) => a.sectionNumber - b.sectionNumber);
}
