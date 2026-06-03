-- Medication status code catalog (idempotent for production recovery).

DO $$ BEGIN
  CREATE TYPE "service_users"."MedicationStatusCodeCategory" AS ENUM (
    'SUCCESS', 'EXCEPTION', 'WARNING', 'INFORMATION', 'NEUTRAL', 'CRITICAL', 'PENDING'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "service_users"."MedicationStatusCodeFieldRequirement" AS ENUM (
    'NOT_REQUIRED', 'OPTIONAL', 'REQUIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "service_users"."MedicationStatusCode" (
    "id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "label" TEXT NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "textColor" VARCHAR(7) NOT NULL,
    "category" "service_users"."MedicationStatusCodeCategory" NOT NULL,
    "administrationStatus" "service_users"."MedicationAdministrationStatus" NOT NULL DEFAULT 'PENDING',
    "reasonRequirement" "service_users"."MedicationStatusCodeFieldRequirement" NOT NULL DEFAULT 'NOT_REQUIRED',
    "managerReviewRequirement" "service_users"."MedicationStatusCodeFieldRequirement" NOT NULL DEFAULT 'NOT_REQUIRED',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MedicationStatusCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MedicationStatusCode_code_key"
  ON "service_users"."MedicationStatusCode"("code");

CREATE INDEX IF NOT EXISTS "MedicationStatusCode_deletedAt_idx"
  ON "service_users"."MedicationStatusCode"("deletedAt");

CREATE INDEX IF NOT EXISTS "MedicationStatusCode_isActive_idx"
  ON "service_users"."MedicationStatusCode"("isActive");

CREATE INDEX IF NOT EXISTS "MedicationStatusCode_sortOrder_idx"
  ON "service_users"."MedicationStatusCode"("sortOrder");

CREATE INDEX IF NOT EXISTS "MedicationStatusCode_administrationStatus_idx"
  ON "service_users"."MedicationStatusCode"("administrationStatus");
