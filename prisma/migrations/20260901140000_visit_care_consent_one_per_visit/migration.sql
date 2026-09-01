-- One consent row per visit (lead records; support does not).
DELETE FROM "scheduling"."VisitCareConsent" AS a
USING "scheduling"."VisitCareConsent" AS b
WHERE a."scheduledVisitId" = b."scheduledVisitId"
  AND (
    a."updatedAt" < b."updatedAt"
    OR (a."updatedAt" = b."updatedAt" AND a."id" < b."id")
  );

ALTER TABLE "scheduling"."VisitCareConsent"
    DROP CONSTRAINT IF EXISTS "VisitCareConsent_scheduledVisitId_capturedByEmployeeId_key";

DROP INDEX IF EXISTS "scheduling"."VisitCareConsent_scheduledVisitId_capturedByEmployeeId_key";

CREATE UNIQUE INDEX "VisitCareConsent_scheduledVisitId_key"
    ON "scheduling"."VisitCareConsent"("scheduledVisitId");
