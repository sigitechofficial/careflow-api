-- Clinical photos attached to visit observations (carer app → admin visit workspace)

CREATE TABLE "service_users"."ServiceUserObservationPhoto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "observationId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "consentStatus" "service_users"."BodyMapPhotoConsentStatus" NOT NULL,
    "caption" TEXT,
    "uploadedByEmployeeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceUserObservationPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceUserObservationPhoto_observationId_idx" ON "service_users"."ServiceUserObservationPhoto"("observationId");

ALTER TABLE "service_users"."ServiceUserObservationPhoto" ADD CONSTRAINT "ServiceUserObservationPhoto_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "service_users"."ServiceUserObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_users"."ServiceUserObservationPhoto" ADD CONSTRAINT "ServiceUserObservationPhoto_uploadedByEmployeeId_fkey" FOREIGN KEY ("uploadedByEmployeeId") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
