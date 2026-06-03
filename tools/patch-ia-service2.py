from pathlib import Path
p = Path(r'd:/New folder/Care/careadmin-backend/src/initial-assessments/initial-assessments.service.ts')
text = p.read_text(encoding='utf-8')
text = text.replace(
    '    const carePlanRecommendations = applyCarePlanDecisions(\n      buildCarePlanRecommendations(triggerItems),\n      readCarePlanDecisions(submission.metadata),',
    '    const carePlanRecommendations = applyCarePlanDecisions(\n      await this.carePlanRules.resolveRecommendations(submissionId, triggerItems),\n      readCarePlanDecisions(submission.metadata),',
)
p.write_text(text, encoding='utf-8')
print('ok')
