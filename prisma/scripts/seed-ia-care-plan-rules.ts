/** Re-apply the starter IA → care-plan recommendation rules (idempotent). `npm run seed:ia-care-plan-rules` */
import { PrismaClient } from '@prisma/client';
import { seedInitialAssessmentCarePlanRules } from '../seeds/initial-assessment-care-plan-rules.seed';

const prisma = new PrismaClient();
seedInitialAssessmentCarePlanRules(prisma)
  .then((created) => console.log(`IA care-plan rules applied (${created} created, others updated).`))
  .finally(() => prisma.$disconnect());
