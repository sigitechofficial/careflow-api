-- External bodies involved alongside the internal investigation (LA safeguarding, police, CQC…).
CREATE TABLE "incidents"."IncidentExternalBody" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "bodyType" VARCHAR(40) NOT NULL,
    "organisationName" VARCHAR(200),
    "referredOn" DATE NOT NULL,
    "referenceNumber" VARCHAR(100),
    "contactName" VARCHAR(200),
    "contactPhone" VARCHAR(50),
    "contactEmail" VARCHAR(200),
    "role" VARCHAR(20) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'REFERRED',
    "outcome" TEXT,
    "outcomeDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IncidentExternalBody_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IncidentExternalBody_incidentId_idx" ON "incidents"."IncidentExternalBody"("incidentId");
CREATE INDEX "IncidentExternalBody_status_idx" ON "incidents"."IncidentExternalBody"("status");

ALTER TABLE "incidents"."IncidentExternalBody"
  ADD CONSTRAINT "IncidentExternalBody_incidentId_fkey" FOREIGN KEY ("incidentId")
  REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
