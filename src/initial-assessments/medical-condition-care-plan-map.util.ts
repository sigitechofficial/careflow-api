import type { CarePlanRecommendation } from './initial-assessment-care-plan.util'
import type { CarePlanCatalogueRow } from './initial-assessment-care-plan-area-map.util'

/**
 * Active medical condition catalogue codes → Care Pathway CARE_PLAN form names.
 * Only maps to real seeded forms. Unmapped codes do not invent recommendations.
 */
export const MEDICAL_CONDITION_CODE_TO_CARE_PLAN_FORM: Record<string, string> = {
  HIGH_RISK_FALLS: 'Falls',

  DIABETES: 'Medication',
  MEDICATION: 'Medication',
  MEDICATION_BY_CARER: 'Medication',
  PRN_MEDICATIONS: 'Medication',
  PROMPT_ASSIST_MEDICATION: 'Medication',
  CRUSH_MEDICATION: 'Medication',

  CHOKING_RISK: 'Eating and Drinking',
  DYSPHAGIA: 'Eating and Drinking',
  NUTRITION_HYDRATION: 'Eating and Drinking',
  POOR_EATING_DRINKING: 'Eating and Drinking',
  EATING_DISORDER: 'Eating and Drinking',

  DEMENTIA: 'Dementia Care plan',

  COMMUNICATION_NEEDS: 'Communication',

  COPD: 'Physical Health',
  ASTHMA: 'Physical Health',
  RESPIRATORY_DISEASE: 'Physical Health',

  PALLIATIVE_CARE: 'Final Days',
  END_OF_LIFE: 'Final Days',

  COMMUNITY_DOLS: 'Personal Safety',
}

export type ActiveConditionForCarePlan = {
  code: string
  name: string
}

export function carePlanFormNameForMedicalConditionCode(code: string): string | undefined {
  const key = code.trim().toUpperCase()
  if (!key) return undefined
  return MEDICAL_CONDITION_CODE_TO_CARE_PLAN_FORM[key]
}

/**
 * Build pending care plan recommendations from active medical conditions.
 * Multiple conditions mapping to the same form collapse into one recommendation.
 */
export function buildRecommendationsFromMedicalConditions(
  conditions: ActiveConditionForCarePlan[],
  catalogue: CarePlanCatalogueRow[],
): CarePlanRecommendation[] {
  const byFormId = new Map<string, CarePlanRecommendation>()
  const catalogueByName = new Map(
    catalogue.map((f) => [f.name.trim().toLowerCase(), f] as const),
  )

  for (const condition of conditions) {
    const formName = carePlanFormNameForMedicalConditionCode(condition.code)
    if (!formName) continue
    const form = catalogueByName.get(formName.trim().toLowerCase())
    if (!form) continue

    const trigger = {
      questionId: `medical-condition:${condition.code.trim().toUpperCase()}`,
      questionText: `Medical condition: ${condition.name.trim() || condition.code}`,
    }

    const existing = byFormId.get(form.id)
    if (existing) {
      if (!existing.triggers.some((t) => t.questionId === trigger.questionId)) {
        existing.triggers.push(trigger)
        existing.triggerCount = existing.triggers.length
      }
      continue
    }

    byFormId.set(form.id, {
      id: `condition-${form.id}`,
      carePlanArea: form.name,
      sectionNumber: 0,
      sectionTitle: 'Medical Conditions',
      title: `${form.name} — recommended from medical conditions`,
      triggerCount: 1,
      triggers: [trigger],
      status: 'pending',
      carePathwayFormId: form.id,
      carePathwayFormName: form.name,
      source: 'medical_condition',
    })
  }

  return [...byFormId.values()].sort((a, b) =>
    (a.carePathwayFormName ?? a.title).localeCompare(b.carePathwayFormName ?? b.title),
  )
}

function recommendationFormKey(rec: CarePlanRecommendation): string | null {
  if (rec.carePathwayFormId?.trim()) return `id:${rec.carePathwayFormId.trim()}`
  if (rec.carePathwayFormName?.trim()) {
    return `name:${rec.carePathwayFormName.trim().toLowerCase()}`
  }
  return null
}

/**
 * Merge IA/rule recommendations with medical-condition recommendations.
 * Same care plan form → keep primary (IA/rule), append condition triggers.
 * Condition-only forms are added as new pending recommendations.
 */
export function mergeMedicalConditionRecommendations(
  primary: CarePlanRecommendation[],
  fromConditions: CarePlanRecommendation[],
): CarePlanRecommendation[] {
  if (fromConditions.length === 0) return primary

  const byKey = new Map<string, CarePlanRecommendation>()
  const withoutForm: CarePlanRecommendation[] = []

  for (const rec of primary) {
    const key = recommendationFormKey(rec)
    if (!key) {
      withoutForm.push(rec)
      continue
    }
    byKey.set(key, rec)
  }

  for (const rec of fromConditions) {
    const key = recommendationFormKey(rec)
    if (!key) continue
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, rec)
      continue
    }
    const seen = new Set(existing.triggers.map((t) => t.questionId))
    for (const trigger of rec.triggers) {
      if (seen.has(trigger.questionId)) continue
      existing.triggers.push(trigger)
      seen.add(trigger.questionId)
    }
    existing.triggerCount = existing.triggers.length
  }

  return [...byKey.values(), ...withoutForm].sort(
    (a, b) => a.sectionNumber - b.sectionNumber || a.title.localeCompare(b.title),
  )
}
