/**
 * Create any missing starter IA → care-plan recommendation rules. Existing (administrator-owned)
 * rules are left unchanged. `npm run seed:ia-care-plan-rules`
 */
import { PrismaClient } from '@prisma/client';
import { seedInitialAssessmentCarePlanRules } from '../seeds/initial-assessment-care-plan-rules.seed';

const prisma = new PrismaClient();
seedInitialAssessmentCarePlanRules(prisma)
  .then((created) => console.log(`IA care-plan rules: ${created} created; existing rules left unchanged.`))
  .finally(() => prisma.$disconnect());
