-- Surveys: inert templates, real anonymity, scheduled audiences, recurring periods.
-- Hand-written; idempotent where practical so a partial run can be repeated.
--
-- "The day" of an anonymous answer is the Europe/London calendar day (the operational timezone),
-- not the UTC day: timestamps are stored as UTC, so 00:30 BST on 5 June is 23:30 UTC on 4 June.

-- UTC timestamp → start of its Europe/London calendar day, as a UTC timestamp.
CREATE OR REPLACE FUNCTION pg_temp.survey_london_day(ts TIMESTAMP(3)) RETURNS TIMESTAMP(3)
LANGUAGE sql STABLE AS $$
  SELECT (date_trunc('day', (ts AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London')
          AT TIME ZONE 'Europe/London') AT TIME ZONE 'UTC'
$$;

-- ─── Survey: scheduled audience, recurrence periods, failure state ───────────
ALTER TABLE "surveys"."Survey"
  ADD COLUMN IF NOT EXISTS "periodKey" TEXT,
  ADD COLUMN IF NOT EXISTS "periodOpenDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "recurrenceAnchorAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "audienceEmployeeIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN IF NOT EXISTS "scheduledById" UUID,
  ADD COLUMN IF NOT EXISTS "distributionFailedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "distributionError" TEXT;

-- Recurring surveys used the opensAt → closesAt length as "how long each period stays open".
UPDATE "surveys"."Survey"
SET "periodOpenDays" = GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("closesAt" - "opensAt")) / 86400.0))::INTEGER
WHERE "recurrence" IS NOT NULL
  AND "clonedFromId" IS NULL
  AND "periodOpenDays" IS NULL
  AND "opensAt" IS NOT NULL
  AND "closesAt" IS NOT NULL
  AND "closesAt" > "opensAt";

UPDATE "surveys"."Survey"
SET "recurrenceAnchorAt" = "distributeAt"
WHERE "recurrence" IS NOT NULL AND "distributeAt" IS NOT NULL AND "recurrenceAnchorAt" IS NULL;

-- The person who last set up a schedule is the best acting user for its background run.
UPDATE "surveys"."Survey"
SET "scheduledById" = COALESCE("updatedById", "createdById")
WHERE "distributeAt" IS NOT NULL AND "scheduledById" IS NULL;

-- ─── SurveyQuestion: period copies link to the recurring survey's question ────
ALTER TABLE "surveys"."SurveyQuestion" ADD COLUMN IF NOT EXISTS "sourceQuestionId" UUID;
CREATE INDEX IF NOT EXISTS "SurveyQuestion_sourceQuestionId_idx" ON "surveys"."SurveyQuestion"("sourceQuestionId");

-- Existing copies were matched by position + type + text; keep that history by linking them now.
UPDATE "surveys"."SurveyQuestion" cq
SET "sourceQuestionId" = sq."id"
FROM "surveys"."Survey" c, "surveys"."SurveyQuestion" sq
WHERE cq."surveyId" = c."id"
  AND c."clonedFromId" IS NOT NULL
  AND sq."surveyId" = c."clonedFromId"
  AND sq."deletedAt" IS NULL
  AND sq."sortOrder" = cq."sortOrder"
  AND sq."questionType" = cq."questionType"
  AND sq."questionText" = cq."questionText"
  AND cq."sourceQuestionId" IS NULL;

-- ─── SurveyResponse: owned by the survey; the recipient link becomes optional ─
ALTER TABLE "surveys"."SurveyResponse"
  ADD COLUMN IF NOT EXISTS "surveyId" UUID,
  ADD COLUMN IF NOT EXISTS "locationId" UUID,
  ADD COLUMN IF NOT EXISTS "jobTitleId" UUID;

UPDATE "surveys"."SurveyResponse" r
SET "surveyId" = rc."surveyId"
FROM "surveys"."SurveyRecipient" rc
WHERE rc."id" = r."recipientId" AND r."surveyId" IS NULL;

ALTER TABLE "surveys"."SurveyResponse" ALTER COLUMN "surveyId" SET NOT NULL;
ALTER TABLE "surveys"."SurveyResponse" ALTER COLUMN "recipientId" DROP NOT NULL;

-- Respondent's branch at the time (group breakdowns only). Job title only on named surveys:
-- on an anonymous survey a job title (often held by one or two people in a branch) identifies.
UPDATE "surveys"."SurveyResponse" r
SET "locationId" = e."locationId",
    "jobTitleId" = CASE WHEN s."isAnonymous" THEN NULL ELSE e."jobTitleId" END
FROM "surveys"."SurveyRecipient" rc
JOIN "employees"."EmployeeEmployment" e ON e."employeeId" = rc."employeeId"
JOIN "surveys"."Survey" s ON s."id" = rc."surveyId"
WHERE rc."id" = r."recipientId" AND rc."employeeId" IS NOT NULL AND r."locationId" IS NULL;

UPDATE "surveys"."SurveyResponse" r
SET "locationId" = su."locationId"
FROM "surveys"."SurveyRecipient" rc
JOIN "service_users"."ServiceUser" su ON su."id" = rc."serviceUserId"
WHERE rc."id" = r."recipientId" AND rc."serviceUserId" IS NOT NULL AND r."locationId" IS NULL;

UPDATE "surveys"."SurveyResponse" r
SET "jobTitleId" = NULL
FROM "surveys"."Survey" s
WHERE s."id" = r."surveyId" AND s."isAnonymous" = true AND r."jobTitleId" IS NOT NULL;

ALTER TABLE "surveys"."SurveyResponse" DROP CONSTRAINT IF EXISTS "SurveyResponse_recipientId_fkey";
ALTER TABLE "surveys"."SurveyResponse"
  ADD CONSTRAINT "SurveyResponse_recipientId_fkey" FOREIGN KEY ("recipientId")
  REFERENCES "surveys"."SurveyRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "surveys"."SurveyResponse" DROP CONSTRAINT IF EXISTS "SurveyResponse_surveyId_fkey";
ALTER TABLE "surveys"."SurveyResponse"
  ADD CONSTRAINT "SurveyResponse_surveyId_fkey" FOREIGN KEY ("surveyId")
  REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "SurveyResponse_surveyId_idx" ON "surveys"."SurveyResponse"("surveyId");

-- ─── Period copies: orphans, then one copy per period ────────────────────────
-- A failed send could leave a DRAFT period copy with no recipients and no answers. Nobody can
-- see or answer it; soft-delete it (and free its period key for the real copy).
UPDATE "surveys"."Survey" c
SET "deletedAt" = NOW(), "periodKey" = NULL
WHERE c."clonedFromId" IS NOT NULL
  AND c."deletedAt" IS NULL
  AND c."status" = 'DRAFT'
  AND NOT EXISTS (SELECT 1 FROM "surveys"."SurveyRecipient" rc WHERE rc."surveyId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "surveys"."SurveyResponse" r WHERE r."surveyId" = c."id");

-- Period keys for existing period copies (operational timezone Europe/London). Where several
-- copies cover one period, the key goes to the one people actually received / answered.
WITH keyed AS (
  SELECT c."id",
         CASE src."recurrence"
           WHEN 'WEEKLY' THEN to_char((c."opensAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-MM-DD')
           WHEN 'MONTHLY' THEN to_char((c."opensAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-MM')
           WHEN 'QUARTERLY' THEN to_char((c."opensAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-"Q"Q')
           WHEN 'YEARLY' THEN to_char((c."opensAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY')
         END AS "key",
         c."clonedFromId",
         c."createdAt",
         (SELECT COUNT(*) FROM "surveys"."SurveyResponse" r WHERE r."surveyId" = c."id") AS responses,
         (SELECT COUNT(*) FROM "surveys"."SurveyRecipient" rc WHERE rc."surveyId" = c."id") AS recipients
  FROM "surveys"."Survey" c
  JOIN "surveys"."Survey" src ON src."id" = c."clonedFromId"
  WHERE c."periodKey" IS NULL AND c."deletedAt" IS NULL AND c."opensAt" IS NOT NULL
    AND src."recurrence" IS NOT NULL
),
ranked AS (
  SELECT k."id", k."key",
         ROW_NUMBER() OVER (
           PARTITION BY k."clonedFromId", k."key"
           ORDER BY k.responses DESC, k.recipients DESC, k."createdAt" ASC, k."id" ASC
         ) AS rn
  FROM keyed k
  WHERE k."key" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "surveys"."Survey" x
      WHERE x."clonedFromId" = k."clonedFromId" AND x."periodKey" = k."key"
    )
)
UPDATE "surveys"."Survey" s
SET "periodKey" = r."key"
FROM ranked r
WHERE s."id" = r."id" AND r.rn = 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Survey_clonedFromId_periodKey_key"
  ON "surveys"."Survey"("clonedFromId", "periodKey");

-- ─── Recipients: one per person per survey ───────────────────────────────────
-- Employees already have "SurveyRecipient_surveyId_employeeId_key". Service users get the same
-- (partial: rows without a service user are employees). Duplicates are merged first: the row
-- that was answered (else completed, else the earliest) stays; a second answer from the same
-- person is kept on the survey but no longer linked to them.
DROP TABLE IF EXISTS "_survey_recipient_dupes";
CREATE TEMP TABLE "_survey_recipient_dupes" AS
SELECT ranked."id", ranked.rn
FROM (
  SELECT rc."id",
         ROW_NUMBER() OVER (
           PARTITION BY rc."surveyId", rc."serviceUserId"
           ORDER BY EXISTS (SELECT 1 FROM "surveys"."SurveyResponse" r WHERE r."recipientId" = rc."id") DESC,
                    (rc."status" = 'COMPLETED') DESC,
                    rc."createdAt" ASC,
                    rc."id" ASC
         ) AS rn
  FROM "surveys"."SurveyRecipient" rc
  WHERE rc."serviceUserId" IS NOT NULL
) ranked
WHERE ranked.rn > 1;

UPDATE "surveys"."SurveyResponse" r
SET "recipientId" = NULL
WHERE r."recipientId" IN (SELECT "id" FROM "_survey_recipient_dupes");

DELETE FROM "surveys"."SurveyRecipient"
WHERE "id" IN (SELECT "id" FROM "_survey_recipient_dupes");

DROP TABLE IF EXISTS "_survey_recipient_dupes";

CREATE UNIQUE INDEX IF NOT EXISTS "SurveyRecipient_surveyId_serviceUserId_key"
  ON "surveys"."SurveyRecipient"("surveyId", "serviceUserId")
  WHERE "serviceUserId" IS NOT NULL;

-- ─── Anonymity: anonymous answers are never linked to a person ───────────────
-- Unlink, and blur the timing to the (Europe/London) day so a completion time cannot be matched
-- to an answer.
UPDATE "surveys"."SurveyResponse" r
SET "recipientId" = NULL,
    "respondentName" = NULL,
    "contactNumber" = NULL,
    "submittedAt" = pg_temp.survey_london_day(r."submittedAt"),
    "createdAt" = pg_temp.survey_london_day(r."createdAt"),
    "updatedAt" = pg_temp.survey_london_day(r."updatedAt"),
    "contactedAt" = CASE
      WHEN s."isAnonymous" AND r."contactedAt" IS NOT NULL THEN pg_temp.survey_london_day(r."contactedAt")
      ELSE r."contactedAt"
    END
FROM "surveys"."Survey" s
WHERE s."id" = r."surveyId"
  AND (s."isAnonymous" = true OR r."isAnonymous" = true)
  AND (
    r."recipientId" IS NOT NULL
    OR r."respondentName" IS NOT NULL
    OR r."contactNumber" IS NOT NULL
    OR r."submittedAt" <> pg_temp.survey_london_day(r."submittedAt")
    OR r."createdAt" <> pg_temp.survey_london_day(r."createdAt")
    OR r."updatedAt" <> pg_temp.survey_london_day(r."updatedAt")
    OR (s."isAnonymous" AND r."contactedAt" <> pg_temp.survey_london_day(r."contactedAt"))
  );

-- The answers' own times too.
UPDATE "surveys"."SurveyAnswer" a
SET "createdAt" = pg_temp.survey_london_day(a."createdAt"),
    "updatedAt" = pg_temp.survey_london_day(a."updatedAt")
FROM "surveys"."SurveyResponse" r
JOIN "surveys"."Survey" s ON s."id" = r."surveyId"
WHERE a."responseId" = r."id"
  AND (s."isAnonymous" = true OR r."isAnonymous" = true)
  AND (
    a."createdAt" <> pg_temp.survey_london_day(a."createdAt")
    OR a."updatedAt" <> pg_temp.survey_london_day(a."updatedAt")
  );

UPDATE "surveys"."SurveyRecipient" rc
SET "updatedAt" = pg_temp.survey_london_day(rc."updatedAt")
FROM "surveys"."Survey" s
WHERE s."id" = rc."surveyId" AND s."isAnonymous" = true
  AND rc."updatedAt" <> pg_temp.survey_london_day(rc."updatedAt");

-- Shared-link / anonymous-recorded answers used placeholder recipients with no person.
-- The answer now belongs to the survey directly, so the placeholders go.
UPDATE "surveys"."SurveyResponse" r
SET "recipientId" = NULL
FROM "surveys"."SurveyRecipient" rc
WHERE rc."id" = r."recipientId" AND rc."employeeId" IS NULL AND rc."serviceUserId" IS NULL;

DELETE FROM "surveys"."SurveyRecipient" WHERE "employeeId" IS NULL AND "serviceUserId" IS NULL;

-- Audit trail of answers to anonymous surveys: no recipient, no response id, no IP / device,
-- and (for the respondent's own submission) no user. The row points at the survey instead.
WITH response_audit AS (
  SELECT a."id",
         COALESCE(
           a."newValues" ->> 'surveyId',
           a."metadata" ->> 'surveyId',
           (SELECT r."surveyId"::TEXT FROM "surveys"."SurveyResponse" r
            WHERE a."recordType" = 'SurveyResponse' AND r."id"::TEXT = a."recordId")
         ) AS survey_id
  FROM "audit"."AuditLog" a
  WHERE a."action" IN ('survey_response_submitted', 'survey_response_recorded', 'survey_response_updated')
)
UPDATE "audit"."AuditLog" a
SET "recordType" = 'Survey',
    "recordId" = s."id"::TEXT,
    "ipAddress" = NULL,
    "userAgent" = NULL,
    "userId" = CASE WHEN a."action" = 'survey_response_submitted' THEN NULL ELSE a."userId" END,
    "oldValues" = CASE WHEN jsonb_typeof(a."oldValues") = 'object'
                       THEN a."oldValues" - 'recipientId' - 'responseId' ELSE a."oldValues" END,
    "newValues" = CASE WHEN jsonb_typeof(a."newValues") = 'object'
                       THEN a."newValues" - 'recipientId' - 'responseId' ELSE a."newValues" END,
    "metadata" = CASE WHEN jsonb_typeof(a."metadata") = 'object'
                      THEN a."metadata" - 'recipientId' - 'responseId' ELSE a."metadata" END
FROM response_audit ra
JOIN "surveys"."Survey" s ON s."id"::TEXT = ra.survey_id
WHERE a."id" = ra."id"
  AND s."isAnonymous" = true;

-- ─── Templates are inert ─────────────────────────────────────────────────────
-- "Save as template" used to move live surveys into Templates, and templates could be scheduled
-- or repeated. Any template that was sent, answered, has period copies, or has a schedule / repeat
-- goes back to Surveys as it is (a repeating series keeps running), and a clean template copy
-- (questions only) takes its place.
DROP TABLE IF EXISTS "_survey_template_fix";
CREATE TEMP TABLE "_survey_template_fix" AS
SELECT s."id" AS old_id, gen_random_uuid() AS new_id
FROM "surveys"."Survey" s
WHERE s."isTemplate" = true
  AND s."deletedAt" IS NULL
  AND (
    EXISTS (SELECT 1 FROM "surveys"."SurveyRecipient" rc WHERE rc."surveyId" = s."id")
    OR EXISTS (SELECT 1 FROM "surveys"."SurveyResponse" r WHERE r."surveyId" = s."id")
    OR EXISTS (SELECT 1 FROM "surveys"."Survey" c WHERE c."clonedFromId" = s."id")
    OR s."distributeAt" IS NOT NULL
    OR s."recurrence" IS NOT NULL
  );

INSERT INTO "surveys"."Survey" (
  "id", "title", "description", "targetKind", "status", "isAnonymous", "locationIds", "roleIds",
  "isTemplate", "shareToken", "createdAt", "updatedAt", "createdById", "updatedById"
)
SELECT f.new_id, s."title", s."description", s."targetKind", 'DRAFT', s."isAnonymous", s."locationIds", s."roleIds",
       true, gen_random_uuid()::TEXT, NOW(), NOW(), s."createdById", s."updatedById"
FROM "_survey_template_fix" f
JOIN "surveys"."Survey" s ON s."id" = f.old_id;

INSERT INTO "surveys"."SurveyQuestion" (
  "id", "surveyId", "questionText", "helpText", "questionType", "options", "isRequired", "sortOrder",
  "config", "isActive", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), f.new_id, q."questionText", q."helpText", q."questionType", q."options", q."isRequired",
       q."sortOrder", q."config", q."isActive", NOW(), NOW()
FROM "_survey_template_fix" f
JOIN "surveys"."SurveyQuestion" q ON q."surveyId" = f.old_id AND q."deletedAt" IS NULL;

UPDATE "surveys"."Survey" SET "isTemplate" = false
WHERE "id" IN (SELECT old_id FROM "_survey_template_fix");

DROP TABLE IF EXISTS "_survey_template_fix";

DROP FUNCTION IF EXISTS pg_temp.survey_london_day(TIMESTAMP);
