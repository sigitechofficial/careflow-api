/**
 * Backfills carePathwayFormId on accepted care plan decisions in submission metadata.
 * Run after upgrading accept flow so existing accepts resolve to active care plans.
 */
import { PrismaClient, CarePathwayFormType } from '@prisma/client'

const AREA_TO_FORM = {
  'Person Centred': 'Person Centred care plan',
  Environment: 'Personal Safety',
  Nutrition: 'Eating and Drinking',
  Consent: 'Culture/Religion/Spirituality',
  'Physical Health': 'Physical Health',
  Respiratory: 'Physical Health',
  Continence: 'Continence',
  Communication: 'Communication',
  Medication: 'Medication',
  'Mental Health': 'Psychological',
  'Skin Integrity': 'Skin Integrity',
  Mobility: 'Falls',
  Safeguarding: 'Personal Safety',
  Governance: 'Care Plan review form',
}

function resolveForm(catalogue, area, formName, formId) {
  if (formId) {
    const row = catalogue.find((f) => f.id === formId)
    if (row) return row
  }
  if (formName?.trim()) {
    const row = catalogue.find((f) => f.name.toLowerCase() === formName.trim().toLowerCase())
    if (row) return row
  }
  const alias = AREA_TO_FORM[area?.trim()]
  if (alias) {
    const row = catalogue.find((f) => f.name === alias)
    if (row) return row
  }
  const areaLower = (area ?? '').trim().toLowerCase()
  return catalogue.find((f) => {
    const n = f.name.toLowerCase()
    return n === areaLower || n.startsWith(`${areaLower} `)
  })
}

const p = new PrismaClient()
const catalogue = await p.carePathwayForm.findMany({
  where: { formType: CarePathwayFormType.CARE_PLAN, deletedAt: null },
  select: { id: true, name: true },
})

const rules = await p.initialAssessmentCarePlanRecommendationRule.findMany({
  where: { deletedAt: null, isActive: true },
  select: { id: true, carePathwayFormId: true, label: true },
})
const ruleForm = new Map(rules.map((r) => [`rule-${r.id}`, r.carePathwayFormId]))

const subs = await p.initialAssessmentSubmission.findMany({
  where: { deletedAt: null, status: { in: ['SUBMITTED', 'REVIEWED'] } },
  select: { id: true, metadata: true },
})

let updated = 0
for (const sub of subs) {
  const meta = sub.metadata && typeof sub.metadata === 'object' ? { ...sub.metadata } : null
  if (!meta?.carePlanDecisions || typeof meta.carePlanDecisions !== 'object') continue

  const decisions = { ...meta.carePlanDecisions }
  let changed = false

  for (const [recId, raw] of Object.entries(decisions)) {
    if (!raw || typeof raw !== 'object' || raw.decision !== 'accepted') continue
    if (raw.carePathwayFormId) continue

    let area = raw.carePlanArea
    let formId = ruleForm.get(recId)
    let formName

    if (recId.startsWith('cp-')) {
      const slug = recId.replace(/^cp-\d+-/, '').replace(/-/g, ' ')
      const legacyAreas = {
        nutrition: 'Nutrition',
        environment: 'Environment',
        'person-centred': 'Person Centred',
      }
      area = area ?? legacyAreas[recId.split('-').slice(2).join('-')] ?? slug
    }

    if (formId) {
      formName = catalogue.find((f) => f.id === formId)?.name
    } else {
      const row = resolveForm(catalogue, area, raw.carePathwayFormName, null)
      formId = row?.id
      formName = row?.name
    }

    if (!formId) continue

    decisions[recId] = {
      ...raw,
      carePathwayFormId: formId,
      carePathwayFormName: formName,
      carePlanArea: area ?? raw.carePlanArea,
    }
    changed = true
  }

  if (changed) {
    await p.initialAssessmentSubmission.update({
      where: { id: sub.id },
      data: { metadata: { ...meta, carePlanDecisions: decisions } },
    })
    updated += 1
    console.log('Updated submission', sub.id.slice(0, 8))
  }
}

console.log('Done. Submissions updated:', updated)
await p.$disconnect()
