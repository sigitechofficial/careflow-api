-- Supervision & appraisals (docs/SUPERVISION_MODULE_PLAN.md). Additive only.
-- Sessions are recorded on Care Pathway staff forms: ReviewType.supervisionFormId picks the form,
-- and each session keeps a snapshot of it (formSnapshot) plus the answers. Reminders: a named
-- supervisor per carer (EmployeeEmployment.supervisorUserId) and a log so each reminder is sent once.

-- AlterEnum
ALTER TYPE "notifications"."NotificationType" ADD VALUE IF NOT EXISTS 'SUPERVISION_DUE';

-- CreateEnum
CREATE TYPE "employees"."SupervisionFormat" AS ENUM ('ONE_TO_ONE', 'GROUP', 'OBSERVED_PRACTICE', 'REMOTE');

-- CreateEnum
CREATE TYPE "employees"."SupervisionSessionStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'AWAITING_SIGN_OFF', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "employees"."SupervisionActionStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "employees"."SupervisionActionOwner" AS ENUM ('CARER', 'SUPERVISOR', 'MANAGER', 'OTHER');

-- AlterTable
ALTER TABLE "employees"."EmployeeEmployment" ADD COLUMN     "supervisorUserId" UUID;

-- AlterTable
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN     "supervisionSettings" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "lookups"."ReviewType" ADD COLUMN     "supervisionFormId" UUID;

-- CreateTable
CREATE TABLE "employees"."SupervisionSession" (
    "id" UUID NOT NULL,
    "reviewTypeId" UUID NOT NULL,
    "format" "employees"."SupervisionFormat" NOT NULL DEFAULT 'ONE_TO_ONE',
    "status" "employees"."SupervisionSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "heldAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "location" TEXT,
    "scheduledJobId" UUID,
    "supervisorUserId" UUID NOT NULL,
    "summary" TEXT,
    "confidentialNotes" TEXT,
    "supervisorSignature" TEXT,
    "supervisorSignedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "formId" UUID,
    "formVersionId" UUID,
    "formSnapshot" JSONB,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "SupervisionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."SupervisionAttendee" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "signature" TEXT,
    "signedAt" TIMESTAMP(3),
    "agrees" BOOLEAN,
    "comment" TEXT,

    CONSTRAINT "SupervisionAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."SupervisionAction" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "owner" "employees"."SupervisionActionOwner" NOT NULL DEFAULT 'CARER',
    "ownerName" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "employees"."SupervisionActionStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "completedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "SupervisionAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."SupervisionReminderLog" (
    "id" UUID NOT NULL,
    "employeeReviewId" UUID,
    "employeeId" UUID NOT NULL,
    "reviewTypeId" UUID NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "recipientUserIds" UUID[],
    "carerPushed" BOOLEAN NOT NULL DEFAULT false,
    "emailed" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupervisionReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."SupervisionAddendum" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID NOT NULL,

    CONSTRAINT "SupervisionAddendum_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupervisionSession_status_idx" ON "employees"."SupervisionSession"("status");

-- CreateIndex
CREATE INDEX "SupervisionSession_scheduledAt_idx" ON "employees"."SupervisionSession"("scheduledAt");

-- CreateIndex
CREATE INDEX "SupervisionSession_supervisorUserId_idx" ON "employees"."SupervisionSession"("supervisorUserId");

-- CreateIndex
CREATE INDEX "SupervisionSession_formId_idx" ON "employees"."SupervisionSession"("formId");

-- CreateIndex
CREATE INDEX "SupervisionSession_deletedAt_idx" ON "employees"."SupervisionSession"("deletedAt");

-- CreateIndex
CREATE INDEX "SupervisionAttendee_employeeId_idx" ON "employees"."SupervisionAttendee"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "SupervisionAttendee_sessionId_employeeId_key" ON "employees"."SupervisionAttendee"("sessionId", "employeeId");

-- CreateIndex
CREATE INDEX "SupervisionAction_employeeId_status_idx" ON "employees"."SupervisionAction"("employeeId", "status");

-- CreateIndex
CREATE INDEX "SupervisionAction_sessionId_idx" ON "employees"."SupervisionAction"("sessionId");

-- CreateIndex
CREATE INDEX "SupervisionReminderLog_employeeReviewId_idx" ON "employees"."SupervisionReminderLog"("employeeReviewId");

-- CreateIndex
CREATE UNIQUE INDEX "SupervisionReminderLog_employeeId_reviewTypeId_dueDate_kind_key" ON "employees"."SupervisionReminderLog"("employeeId", "reviewTypeId", "dueDate", "kind");

-- CreateIndex
CREATE INDEX "SupervisionAddendum_sessionId_idx" ON "employees"."SupervisionAddendum"("sessionId");

-- CreateIndex
CREATE INDEX "EmployeeEmployment_supervisorUserId_idx" ON "employees"."EmployeeEmployment"("supervisorUserId");

-- CreateIndex
CREATE INDEX "ReviewType_supervisionFormId_idx" ON "lookups"."ReviewType"("supervisionFormId");

-- AddForeignKey
ALTER TABLE "employees"."EmployeeEmployment" ADD CONSTRAINT "EmployeeEmployment_supervisorUserId_fkey" FOREIGN KEY ("supervisorUserId") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."SupervisionSession" ADD CONSTRAINT "SupervisionSession_reviewTypeId_fkey" FOREIGN KEY ("reviewTypeId") REFERENCES "lookups"."ReviewType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."SupervisionSession" ADD CONSTRAINT "SupervisionSession_supervisorUserId_fkey" FOREIGN KEY ("supervisorUserId") REFERENCES "identity"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."SupervisionSession" ADD CONSTRAINT "SupervisionSession_formId_fkey" FOREIGN KEY ("formId") REFERENCES "care_pathway"."CarePathwayForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."SupervisionAttendee" ADD CONSTRAINT "SupervisionAttendee_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "employees"."SupervisionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."SupervisionAttendee" ADD CONSTRAINT "SupervisionAttendee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."SupervisionAction" ADD CONSTRAINT "SupervisionAction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "employees"."SupervisionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."SupervisionAction" ADD CONSTRAINT "SupervisionAction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."SupervisionAddendum" ADD CONSTRAINT "SupervisionAddendum_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "employees"."SupervisionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lookups"."ReviewType" ADD CONSTRAINT "ReviewType_supervisionFormId_fkey" FOREIGN KEY ("supervisionFormId") REFERENCES "care_pathway"."CarePathwayForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

