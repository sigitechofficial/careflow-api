-- Persist per-plan preference for working-pattern-aware carer sync on rota generate.
ALTER TABLE "service_users"."ServiceUserVisitPlan"
ADD COLUMN "respectWorkingPatternOnSync" BOOLEAN NOT NULL DEFAULT true;
