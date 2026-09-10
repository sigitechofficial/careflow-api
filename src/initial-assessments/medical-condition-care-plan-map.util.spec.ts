import {
  buildRecommendationsFromMedicalConditions,
  carePlanFormNameForMedicalConditionCode,
  mergeMedicalConditionRecommendations,
  MEDICAL_CONDITION_CODE_TO_CARE_PLAN_FORM,
} from './medical-condition-care-plan-map.util'
import type { CarePlanRecommendation } from './initial-assessment-care-plan.util'

describe('medical-condition-care-plan-map', () => {
  const catalogue = [
    { id: 'form-falls', name: 'Falls' },
    { id: 'form-meds', name: 'Medication' },
    { id: 'form-eat', name: 'Eating and Drinking' },
    { id: 'form-dem', name: 'Dementia Care plan' },
    { id: 'form-final', name: 'Final Days' },
  ]

  it('maps known condition codes to real care plan form names', () => {
    expect(carePlanFormNameForMedicalConditionCode('HIGH_RISK_FALLS')).toBe('Falls')
    expect(carePlanFormNameForMedicalConditionCode('diabetes')).toBe('Medication')
    expect(carePlanFormNameForMedicalConditionCode('CHOKING_RISK')).toBe('Eating and Drinking')
    expect(carePlanFormNameForMedicalConditionCode('UNKNOWN_CODE')).toBeUndefined()
  })

  it('builds recommendations from active conditions and collapses same form', () => {
    const recs = buildRecommendationsFromMedicalConditions(
      [
        { code: 'HIGH_RISK_FALLS', name: 'High Risk of Falls' },
        { code: 'DIABETES', name: 'Diabetes' },
        { code: 'PRN_MEDICATIONS', name: 'PRN Medications' },
        { code: 'CHOKING_RISK', name: 'Choking Risk' },
      ],
      catalogue,
    )

    expect(recs).toHaveLength(3)
    const falls = recs.find((r) => r.carePathwayFormName === 'Falls')
    const meds = recs.find((r) => r.carePathwayFormName === 'Medication')
    const eat = recs.find((r) => r.carePathwayFormName === 'Eating and Drinking')
    expect(falls?.source).toBe('medical_condition')
    expect(falls?.triggers[0]?.questionText).toMatch(/High Risk of Falls/)
    expect(meds?.triggerCount).toBe(2)
    expect(eat?.carePathwayFormId).toBe('form-eat')
  })

  it('ignores conditions whose care plan form is not in the catalogue', () => {
    const recs = buildRecommendationsFromMedicalConditions(
      [{ code: 'HIGH_RISK_FALLS', name: 'High Risk of Falls' }],
      [{ id: 'other', name: 'Home Care Plan' }],
    )
    expect(recs).toEqual([])
  })

  it('merges condition recommendations into matching IA recommendations', () => {
    const primary: CarePlanRecommendation[] = [
      {
        id: 'rule-1',
        carePlanArea: 'Falls',
        sectionNumber: 12,
        sectionTitle: 'Mobility',
        title: 'Falls — recommended',
        triggerCount: 1,
        triggers: [{ questionId: 'q1', questionText: 'Falls in last 12 months?' }],
        status: 'pending',
        carePathwayFormId: 'form-falls',
        carePathwayFormName: 'Falls',
        source: 'rule',
      },
    ]
    const fromConditions = buildRecommendationsFromMedicalConditions(
      [{ code: 'HIGH_RISK_FALLS', name: 'High Risk of Falls' }],
      catalogue,
    )
    const merged = mergeMedicalConditionRecommendations(primary, fromConditions)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.triggerCount).toBe(2)
    expect(merged[0]?.source).toBe('rule')
    expect(merged[0]?.triggers.some((t) => t.questionId === 'medical-condition:HIGH_RISK_FALLS')).toBe(
      true,
    )
  })

  it('adds condition-only recommendations when IA has no matching form', () => {
    const primary: CarePlanRecommendation[] = []
    const fromConditions = buildRecommendationsFromMedicalConditions(
      [
        { code: 'DEMENTIA', name: 'Dementia' },
        { code: 'PALLIATIVE_CARE', name: 'Palliative Care' },
      ],
      catalogue,
    )
    const merged = mergeMedicalConditionRecommendations(primary, fromConditions)
    expect(merged.map((r) => r.carePathwayFormName).sort()).toEqual([
      'Dementia Care plan',
      'Final Days',
    ])
  })

  it('exposes the shared mapping table for ops review', () => {
    expect(MEDICAL_CONDITION_CODE_TO_CARE_PLAN_FORM.HIGH_RISK_FALLS).toBe('Falls')
    expect(MEDICAL_CONDITION_CODE_TO_CARE_PLAN_FORM.DIABETES).toBe('Medication')
  })
})
