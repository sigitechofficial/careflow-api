import { PrismaClient } from '@prisma/client'

const serviceUserId = 'b6d36682-8e17-4aeb-9c3f-282ecaa3d8e8'
const p = new PrismaClient()

const catalogue = await p.carePathwayForm.findMany({
  where: { formType: 'CARE_PLAN', deletedAt: null },
  select: { id: true, name: true },
})

const AREA_TO_FORM = {
  'Person Centred': 'Person Centred care plan',
  Environment: 'Personal Safety',
  Nutrition: 'Eating and Drinking',
}

const resolveFormId = (area, formName) => {
  if (formName?.trim()) {
    const exactName = catalogue.find((f) => f.name.trim().toLowerCase() === formName.trim().toLowerCase())
    if (exactName) return { id: exactName.id, name: exactName.name, via: 'formName' }
  }
  const alias = AREA_TO_FORM[area.trim()]
  if (alias) {
    const byAlias = catalogue.find((f) => f.name === alias)
    if (byAlias) return { id: byAlias.id, name: byAlias.name, via: 'alias' }
  }
  const areaLower = area.trim().toLowerCase()
  const partial = catalogue.find((f) => {
    const n = f.name.trim().toLowerCase()
    return n.startsWith(`${areaLower} `) || n.startsWith(areaLower)
  })
  if (partial) return { id: partial.id, name: partial.name, via: 'partial' }
  return null
}

const rules = await p.initialAssessmentCarePlanRecommendationRule.findMany({
  where: { deletedAt: null, isActive: true },
  select: { id: true, carePathwayFormId: true, label: true, suppressLegacyArea: true },
})

const sub = await p.initialAssessmentSubmission.findFirst({
  where: { serviceUserId, status: { in: ['SUBMITTED', 'REVIEWED'] } },
  select: { metadata: true },
})

const decisions = sub?.metadata?.carePlanDecisions ?? {}
const acceptedIds = Object.entries(decisions)
  .filter(([, v]) => v?.decision === 'accepted')
  .map(([id]) => id)

console.log('Accepted recommendation IDs:', acceptedIds.length)

// Legacy areas from typical IA sections
const legacyAreas = {
  'cp-1-person-centred': 'Person Centred',
  'cp-3-environment': 'Environment',
  'cp-6-nutrition': 'Nutrition',
}

for (const recId of acceptedIds) {
  if (recId.startsWith('rule-')) {
    const ruleId = recId.replace(/^rule-/, '')
    const rule = rules.find((r) => r.id === ruleId)
    const form = catalogue.find((f) => f.id === rule?.carePathwayFormId)
    console.log({ recId, type: 'rule', ruleLabel: rule?.label, formId: rule?.carePathwayFormId, formName: form?.name })
  } else {
    const area = legacyAreas[recId] ?? recId
    const resolved = resolveFormId(area, null)
    console.log({ recId, type: 'legacy', carePlanArea: area, ...resolved })
  }
}

const byForm = new Map()
for (const recId of acceptedIds) {
  let formId
  if (recId.startsWith('rule-')) {
    const ruleId = recId.replace(/^rule-/, '')
    formId = rules.find((r) => r.id === ruleId)?.carePathwayFormId
  } else {
    const area = legacyAreas[recId] ?? recId
    formId = resolveFormId(area, null)?.id
  }
  if (formId) {
    const list = byForm.get(formId) ?? []
    list.push(recId)
    byForm.set(formId, list)
  } else {
    console.log('UNRESOLVED:', recId)
  }
}

console.log('\nUnique forms:', byForm.size)
for (const [formId, recs] of byForm) {
  const name = catalogue.find((f) => f.id === formId)?.name
  console.log(` ${name} (${formId.slice(0, 8)}...) <-`, recs.join(', '))
}

await p.$disconnect()
