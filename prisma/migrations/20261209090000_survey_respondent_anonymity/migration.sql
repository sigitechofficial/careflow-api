-- Surveys: respondent-chosen anonymity on named (confidential) surveys.
--  * allowAnonymousResponses: each person may choose "Answer without my name". Their response is then
--    stored like an anonymous one: no recipient link, no branch or job title, day-only times, and no
--    name, IP or device details in notifications or the audit log (SurveyResponse.isAnonymous = true
--    with an ONLINE / PORTAL channel). Meaningless on anonymous surveys, so kept false there.

ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "allowAnonymousResponses" BOOLEAN NOT NULL DEFAULT false;

UPDATE "surveys"."Survey" SET "allowAnonymousResponses" = false
  WHERE "isAnonymous" = true AND "allowAnonymousResponses" = true;
