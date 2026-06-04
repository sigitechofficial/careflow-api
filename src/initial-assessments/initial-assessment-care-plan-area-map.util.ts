/**
 * Maps initial assessment carePlanArea (legacy recommendations) to care pathway form names.
 * Enterprise IA sections use short area labels; catalogue forms use longer clinical names.
 */
export const INITIAL_ASSESSMENT_CARE_PLAN_AREA_TO_FORM_NAME: Record<string, string> = {
  'Person Centred': 'Person Centred care plan',
  Consent: 'Culture/Religion/Spirituality',
  Environment: 'Personal Safety',
  'Physical Health': 'Physical Health',
  Respiratory: 'Physical Health',
  Nutrition: 'Eating and Drinking',
  Continence: 'Continence',
  Communication: 'Communication',
  Medication: 'Medication',
  'Mental Health': 'Psychological',
  'Skin Integrity': 'Skin Integrity',
  Mobility: 'Falls',
  Safeguarding: 'Personal Safety',
  Governance: 'Care Plan review form',
};

export type CarePlanCatalogueRow = { id: string; name: string };

export function carePlanFormNameForArea(carePlanArea: string): string | undefined {
  const trimmed = carePlanArea.trim();
  if (!trimmed) return undefined;
  return INITIAL_ASSESSMENT_CARE_PLAN_AREA_TO_FORM_NAME[trimmed];
}

export function resolveCarePlanFormFromCatalogue(
  catalogue: CarePlanCatalogueRow[],
  carePlanArea: string,
  carePathwayFormName?: string | null,
): CarePlanCatalogueRow | undefined {
  if (carePathwayFormName?.trim()) {
    const byName = catalogue.find(
      (f) => f.name.trim().toLowerCase() === carePathwayFormName.trim().toLowerCase(),
    );
    if (byName) return byName;
  }

  const aliasName = carePlanFormNameForArea(carePlanArea);
  if (aliasName) {
    const byAlias = catalogue.find((f) => f.name.trim().toLowerCase() === aliasName.toLowerCase());
    if (byAlias) return byAlias;
  }

  const areaLower = carePlanArea.trim().toLowerCase();
  const exactArea = catalogue.find((f) => f.name.trim().toLowerCase() === areaLower);
  if (exactArea) return exactArea;

  return catalogue.find((f) => {
    const n = f.name.trim().toLowerCase();
    return n.startsWith(`${areaLower} `) || n.startsWith(areaLower);
  });
}

export function enrichCarePlanRecommendationsWithForms(
  recommendations: Array<{
    carePlanArea: string;
    carePathwayFormId?: string;
    carePathwayFormName?: string;
  }>,
  catalogue: CarePlanCatalogueRow[],
): void {
  for (const rec of recommendations) {
    if (rec.carePathwayFormId) continue;
    const form = resolveCarePlanFormFromCatalogue(catalogue, rec.carePlanArea, rec.carePathwayFormName);
    if (!form) continue;
    rec.carePathwayFormId = form.id;
    rec.carePathwayFormName = form.name;
  }
}
