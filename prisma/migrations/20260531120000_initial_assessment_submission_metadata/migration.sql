-- Store section comments, Waterlow/ADL scores, and other enterprise UX state on submissions.
ALTER TABLE "service_users"."InitialAssessmentSubmission"
ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT '{}';
