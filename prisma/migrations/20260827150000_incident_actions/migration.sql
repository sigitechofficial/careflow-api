-- CreateEnum
CREATE TYPE "incidents"."IncidentActionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "incidents"."IncidentActionStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');


-- CreateTable
CREATE TABLE "incidents"."IncidentAction" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "incidents"."IncidentActionPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "incidents"."IncidentActionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" TIMESTAMP(3),
    "assignedEmployeeId" UUID,
    "completionNotes" TEXT,
    "completedById" UUID,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "IncidentAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncidentAction_incidentId_idx" ON "incidents"."IncidentAction"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentAction_assignedEmployeeId_idx" ON "incidents"."IncidentAction"("assignedEmployeeId");

-- CreateIndex
CREATE INDEX "IncidentAction_status_idx" ON "incidents"."IncidentAction"("status");

-- CreateIndex
CREATE INDEX "IncidentAction_dueDate_idx" ON "incidents"."IncidentAction"("dueDate");

-- CreateIndex
CREATE INDEX "IncidentAction_deletedAt_idx" ON "incidents"."IncidentAction"("deletedAt");

-- AddForeignKey
ALTER TABLE "incidents"."IncidentAction" ADD CONSTRAINT "IncidentAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
