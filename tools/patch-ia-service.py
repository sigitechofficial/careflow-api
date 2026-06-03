from pathlib import Path

p = Path(__file__).resolve().parent.parent / 'src/initial-assessments/initial-assessments.service.ts'
text = p.read_text(encoding='utf-8')

if 'InitialAssessmentCarePlanRulesService' not in text:
    text = text.replace(
        "import { buildCarePlanRecommendations } from './initial-assessment-care-plan.util';",
        "import { InitialAssessmentCarePlanRulesService } from './initial-assessment-care-plan-rules.service';\n"
        "import { buildCarePlanRecommendations } from './initial-assessment-care-plan.util';",
    )
    text = text.replace(
        '    private readonly notifications: InitialAssessmentNotificationHook,\n  ) {}',
        '    private readonly notifications: InitialAssessmentNotificationHook,\n'
        '    private readonly carePlanRules: InitialAssessmentCarePlanRulesService,\n  ) {}',
    )

text = text.replace(
    '      buildCarePlanRecommendations(triggerItems),\n      carePlanDecisions,',
    '      await this.carePlanRules.resolveRecommendations(submissionId, triggerItems),\n      carePlanDecisions,',
)
text = text.replace(
    '    const recommendations = buildCarePlanRecommendations(triggerItems);',
    '    const recommendations = await this.carePlanRules.resolveRecommendations(submissionId, triggerItems);',
)

p.write_text(text, encoding='utf-8')
print('done')
