-- Per-visit, per-carer consent to care (employee-app Overview).

CREATE TYPE "scheduling"."VisitCareConsentStatus" AS ENUM ('GRANTED', 'DECLINED');

CREATE TABLE "scheduling"."VisitCareConsent" (
    "id" UUID NOT NULL,
    "scheduledVisitId" UUID NOT NULL,
    "scheduledJobId" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "capturedByEmployeeId" UUID NOT NULL,
    "status" "scheduling"."VisitCareConsentStatus" NOT NULL,
    "reason" TEXT,
    "deviceRecordedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitCareConsent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitCareConsent_scheduledVisitId_capturedByEmployeeId_key"
    ON "scheduling"."VisitCareConsent"("scheduledVisitId", "capturedByEmployeeId");

CREATE INDEX "VisitCareConsent_scheduledJobId_idx" ON "scheduling"."VisitCareConsent"("scheduledJobId");
CREATE INDEX "VisitCareConsent_serviceUserId_idx" ON "scheduling"."VisitCareConsent"("serviceUserId");
CREATE INDEX "VisitCareConsent_capturedByEmployeeId_idx" ON "scheduling"."VisitCareConsent"("capturedByEmployeeId");

ALTER TABLE "scheduling"."VisitCareConsent"
    ADD CONSTRAINT "VisitCareConsent_scheduledVisitId_fkey"
    FOREIGN KEY ("scheduledVisitId") REFERENCES "scheduling"."ScheduledVisit"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scheduling"."VisitCareConsent"
    ADD CONSTRAINT "VisitCareConsent_scheduledJobId_fkey"
    FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scheduling"."VisitCareConsent"
    ADD CONSTRAINT "VisitCareConsent_serviceUserId_fkey"
    FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scheduling"."VisitCareConsent"
    ADD CONSTRAINT "VisitCareConsent_capturedByEmployeeId_fkey"
    FOREIGN KEY ("capturedByEmployeeId") REFERENCES "employees"."Employee"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
