-- A copy made for each manager (SUR-STF-018): which managers it is about, whether it is the pooled
-- smaller-teams copy, and the fewest staff it may go to. Checked again when the copy is sent or
-- opened, so a team that has shrunk since the drafts were made is not sent a copy that could point
-- at someone (src/surveys/survey-manager-copy-team.ts). Null on every other survey.
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "managerCopy" JSONB;
