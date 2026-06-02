-- Body map governance alerts (§15) + review metadata

CREATE TYPE "service_users"."BodyMapAlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

CREATE TABLE "service_users"."BodyMapAlert" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "serviceUserId" UUID NOT NULL,
  "bodyMapRecordId" UUID,
  "alertType" VARCHAR(80) NOT NULL,
  "severity" "service_users"."BodyMapAlertSeverity" NOT NULL DEFAULT 'MEDIUM',
  "message" TEXT NOT NULL,
  "dismissedAt" TIMESTAMP(3),
  "dismissedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BodyMapAlert_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BodyMapAlert_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BodyMapAlert_bodyMapRecordId_fkey" FOREIGN KEY ("bodyMapRecordId") REFERENCES "service_users"."BodyMapRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BodyMapAlert_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BodyMapAlert_record_type_active_key"
  ON "service_users"."BodyMapAlert"("bodyMapRecordId", "alertType")
  WHERE "dismissedAt" IS NULL AND "bodyMapRecordId" IS NOT NULL;

CREATE INDEX "BodyMapAlert_serviceUserId_idx" ON "service_users"."BodyMapAlert"("serviceUserId");
CREATE INDEX "BodyMapAlert_dismissedAt_idx" ON "service_users"."BodyMapAlert"("dismissedAt");
CREATE INDEX "BodyMapAlert_severity_idx" ON "service_users"."BodyMapAlert"("severity");

ALTER TABLE "service_users"."BodyMapReview" ADD COLUMN IF NOT EXISTS "reviewDetails" JSONB;
