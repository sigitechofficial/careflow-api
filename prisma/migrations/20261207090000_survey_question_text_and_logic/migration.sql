-- Survey questions: respondent free text and conditional questions.
--  * key: a stable reference for a question within its survey ("Show only if" rules point at it).
--    Copies of a survey (duplicate, save as template, period copies, library updates) keep it.
--  * otherOption: SINGLE_SELECT / MULTI_SELECT "Other (please tell us)" choice with a text box:
--    { "label": text, "textPrompt": text, "textRequired": boolean }.
--  * exclusiveOptions: MULTI_SELECT options that cannot be combined with any other ("None of these"):
--    [options].
--  * commentConfig: optional comment box alongside the answer (any type except TEXT / TEXTAREA):
--    { "prompt": text, "showWhen": [answers] | null } (null = after any answer).
--  * showIf: ask the question only when an earlier question's answer is one of a list:
--    { "questionKey": key, "answers": [answers] }.
-- Answers keep the respondent's own text: otherText (when "Other" was chosen) and comment.

ALTER TABLE "surveys"."SurveyQuestion" ADD COLUMN "key" TEXT;
ALTER TABLE "surveys"."SurveyQuestion" ADD COLUMN "otherOption" JSONB;
ALTER TABLE "surveys"."SurveyQuestion" ADD COLUMN "exclusiveOptions" JSONB;
ALTER TABLE "surveys"."SurveyQuestion" ADD COLUMN "commentConfig" JSONB;
ALTER TABLE "surveys"."SurveyQuestion" ADD COLUMN "showIf" JSONB;

ALTER TABLE "surveys"."SurveyAnswer" ADD COLUMN "otherText" TEXT;
ALTER TABLE "surveys"."SurveyAnswer" ADD COLUMN "comment" TEXT;

-- Every existing question gets a key, so new "Show only if" rules can point at it.
UPDATE "surveys"."SurveyQuestion"
  SET "key" = 'q-' || substr(replace("id"::text, '-', ''), 1, 8)
  WHERE "key" IS NULL;
