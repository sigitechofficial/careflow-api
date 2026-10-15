-- Duty of Candour (Regulation 20) per affected service user, with contact attempts.
CREATE TABLE "incidents"."IncidentCandour" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "decision" VARCHAR(20) NOT NULL,
    "decisionReason" TEXT,
    "harmTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "healthProfessionalName" VARCHAR(200),
    "healthProfessionalRole" VARCHAR(120),
    "healthProfessionalEmployeeId" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "dutyStartedAt" TIMESTAMP(3),
    "toldOn" DATE,
    "toldByEmployeeId" UUID,
    "toldPersonKind" VARCHAR(20),
    "toldPersonName" VARCHAR(200),
    "toldRelationship" VARCHAR(120),
    "factsExplained" BOOLEAN NOT NULL DEFAULT false,
    "enquiriesExplained" BOOLEAN NOT NULL DEFAULT false,
    "apologyGiven" BOOLEAN NOT NULL DEFAULT false,
    "supportOffered" TEXT,
    "writtenSentOn" DATE,
    "writtenByEmployeeId" UUID,
    "writtenMethod" VARCHAR(20),
    "writtenAttachmentId" UUID,
    "resultsSharedOn" DATE,
    "resultsMethod" VARCHAR(20),
    "resultsAttachmentId" UUID,
    "noFurtherEnquiriesReason" TEXT,
    "unableToNotify" BOOLEAN NOT NULL DEFAULT false,
    "unableReason" VARCHAR(30),
    "unableNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "IncidentCandour_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IncidentCandour_incidentId_serviceUserId_key" ON "incidents"."IncidentCandour"("incidentId", "serviceUserId");
CREATE INDEX "IncidentCandour_incidentId_idx" ON "incidents"."IncidentCandour"("incidentId");
CREATE INDEX "IncidentCandour_decision_idx" ON "incidents"."IncidentCandour"("decision");
ALTER TABLE "incidents"."IncidentCandour" ADD CONSTRAINT "IncidentCandour_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "incidents"."IncidentCandourAttempt" (
    "id" UUID NOT NULL,
    "candourId" UUID NOT NULL,
    "attemptedOn" DATE NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "byEmployeeId" UUID,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    CONSTRAINT "IncidentCandourAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IncidentCandourAttempt_candourId_idx" ON "incidents"."IncidentCandourAttempt"("candourId");
ALTER TABLE "incidents"."IncidentCandourAttempt" ADD CONSTRAINT "IncidentCandourAttempt_candourId_fkey"
    FOREIGN KEY ("candourId") REFERENCES "incidents"."IncidentCandour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Organisation policy: flag Duty of Candour overdue after N days (null = off).
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN "incidentCandourOverdueDays" INTEGER;
