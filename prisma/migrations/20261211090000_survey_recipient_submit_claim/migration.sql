-- Surveys: a recipient is claimed before an unlinked answer (anonymous survey, or "answer without my
-- name") is held, so two racing submits can never both be held. The claim is a random token with no
-- time, and a coarse expiry (rounded up to a quarter hour) after which a claim left by a crash may be
-- taken again. Both are cleared when the person's survey is marked Completed.

ALTER TABLE "surveys"."SurveyRecipient"
  ADD COLUMN IF NOT EXISTS "submitClaim" TEXT,
  ADD COLUMN IF NOT EXISTS "submitClaimExpiresAt" TIMESTAMP(3);
