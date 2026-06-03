from pathlib import Path
p = Path(r'd:/New folder/Care/careadmin-backend/prisma/seed.ts')
text = p.read_text(encoding='utf-8')
imp = "import { seedInitialAssessmentCarePlanRules } from './seeds/initial-assessment-care-plan-rules.seed';\n"
if 'seedInitialAssessmentCarePlanRules' not in text:
    text = text.replace(
        "import { seedCarePathway } from './seeds/care-pathway.seed';\n",
        "import { seedCarePathway } from './seeds/care-pathway.seed';\n" + imp,
    )
if 'await seedInitialAssessmentCarePlanRules' not in text:
    text = text.replace(
        '  await seedCarePathway(prisma);\n',
        '  await seedCarePathway(prisma);\n  await seedInitialAssessmentCarePlanRules(prisma);\n',
    )
p.write_text(text, encoding='utf-8')
print('seed patched')
