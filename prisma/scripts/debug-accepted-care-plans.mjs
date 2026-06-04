import { PrismaClient } from '@prisma/client'

const serviceUserId = 'b6d36682-8e17-4aeb-9c3f-282ecaa3d8e8'
const p = new PrismaClient()

const submissions = await p.initialAssessmentSubmission.findMany({
  where: {
    serviceUserId,
    deletedAt: null,
    status: { in: ['SUBMITTED', 'REVIEWED'] },
  },
  select: { id: true, metadata: true, status: true },
  orderBy: { submittedAt: 'desc' },
})

console.log('submissions:', submissions.length)

for (const sub of submissions) {
  const meta = sub.metadata && typeof sub.metadata === 'object' ? sub.metadata : {}
  const decisions = meta.carePlanDecisions ?? {}
  const accepted = Object.entries(decisions).filter(([, v]) => v?.decision === 'accepted')
  console.log('\nSubmission', sub.id.slice(0, 8), sub.status)
  console.log('Accepted decision keys:', accepted.length)
  for (const [id, v] of accepted) {
    console.log(' -', id, v.decidedAt)
  }
}

const forms = await p.carePathwayForm.findMany({
  where: { formType: 'CARE_PLAN', deletedAt: null },
  select: { id: true, name: true },
})
console.log('\nCare plan forms in catalogue:', forms.length)

await p.$disconnect()
