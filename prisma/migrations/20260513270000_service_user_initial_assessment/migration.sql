-- CreateTable
CREATE TABLE "service_users"."ServiceUserInitialAssessment" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "numberOfCarers" INTEGER NOT NULL DEFAULT 1,
    "likesToBeKnownAs" TEXT,
    "doorCode" TEXT,
    "accessRisks" TEXT NOT NULL DEFAULT '',
    "accessInstruction" TEXT NOT NULL DEFAULT '',
    "reasonForAdmission" TEXT NOT NULL DEFAULT '',
    "previousMedicalHistory" TEXT NOT NULL DEFAULT '',
    "careInstructions" TEXT NOT NULL DEFAULT '',
    "assessmentPictureUrl" TEXT,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "culturalReligiousNotes" TEXT NOT NULL DEFAULT '',
    "careCarerNumbersNote" TEXT NOT NULL DEFAULT '',
    "additionalRisksNotes" TEXT NOT NULL DEFAULT '',
    "environmentAccessHazardsNotes" TEXT NOT NULL DEFAULT '',
    "hydrationComment" TEXT NOT NULL DEFAULT '',
    "nutritionComment" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserInitialAssessment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceUserInitialAssessment_serviceUserId_key" ON "service_users"."ServiceUserInitialAssessment"("serviceUserId");

ALTER TABLE "service_users"."ServiceUserInitialAssessment" ADD CONSTRAINT "ServiceUserInitialAssessment_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
