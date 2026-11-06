-- Survey roadmap Phase 2 (review fix): text invitations wait for the end of quiet hours.
-- True while this person's invitation text is waiting (the send happened in quiet hours); the survey job
-- sends it once quiet hours end and clears it. Never set once they have answered.
ALTER TABLE "surveys"."SurveyRecipient" ADD COLUMN IF NOT EXISTS "invitationTextPending" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "SurveyRecipient_invitationTextPending_idx" ON "surveys"."SurveyRecipient"("invitationTextPending") WHERE "invitationTextPending";
