import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()
const [submissions, answers, actions, attachments, risks, checklist] = await Promise.all([
  p.initialAssessmentSubmission.count(),
  p.initialAssessmentAnswer.count(),
  p.initialAssessmentAction.count(),
  p.initialAssessmentAttachment.count(),
  p.initialAssessmentRiskRecord.count(),
  p.serviceUserInitialAssessment.count(),
])
console.log({ submissions, answers, actions, attachments, risks, checklist })
await p.$disconnect()
