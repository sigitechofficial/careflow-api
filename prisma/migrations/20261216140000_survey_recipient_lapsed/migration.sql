-- Survey roadmap Phase 2 (eligibility fix): an unanswered invitation whose person can no longer be sent the
-- survey (died, inactive, care ended, not started, left; checked with the same rules as sending) is LAPSED:
-- no reminders, texts or call-list rows, and their link says the survey is closed for them. Answers already
-- given are kept. Staff may send it again if the person becomes eligible before the survey closes.
ALTER TYPE "surveys"."SurveyRecipientStatus" ADD VALUE IF NOT EXISTS 'LAPSED';
