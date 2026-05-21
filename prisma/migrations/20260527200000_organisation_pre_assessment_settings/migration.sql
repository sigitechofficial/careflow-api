ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN "preAssessmentCareRequired" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "preAssessmentComponents" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "preAssessmentForms" JSONB NOT NULL DEFAULT '[]';
