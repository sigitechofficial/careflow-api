-- AlterTable
ALTER TABLE "incidents"."Incident" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" UUID;


-- CreateTable
CREATE TABLE "incidents"."IncidentOutcome" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "finalOutcome" TEXT,
    "lessonsLearned" TEXT,
    "preventability" "incidents"."IncidentPreventability",
    "changesMade" TEXT[],
    "informationSharedWithStaff" BOOLEAN,
    "serviceUserInformed" BOOLEAN,
    "nokInformed" BOOLEAN,
    "finalManagementComments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "IncidentOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncidentOutcome_incidentId_key" ON "incidents"."IncidentOutcome"("incidentId");

-- AddForeignKey
ALTER TABLE "incidents"."IncidentOutcome" ADD CONSTRAINT "IncidentOutcome_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
