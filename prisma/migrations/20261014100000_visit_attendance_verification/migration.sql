-- Payroll remediation, Gate B sprint (R-16 / VW-02).
-- One attendance verification record per visit job and carer, with an append-only history.
-- Until now each carer's record lived inside the job's metadata document and was written by
-- reading the whole document and writing it back, so two carers completing a double-up at the
-- same moment could overwrite each other's evidence.
--
-- Additive: two new tables. Nothing existing is changed. Records already in job metadata stay
-- there, are still read, and are copied into a row (with a LEGACY_IMPORT history entry) the first
-- time that carer's record is written.

-- CreateTable
CREATE TABLE "scheduling"."VisitAttendanceVerification" (
    "id" UUID NOT NULL,
    "scheduledJobId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "jobAllocationId" UUID,
    "startSource" TEXT NOT NULL DEFAULT 'NONE',
    "endSource" TEXT NOT NULL DEFAULT 'NONE',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReasons" JSONB NOT NULL DEFAULT '[]',
    "serverReceivedAt" TIMESTAMP(3),
    "serverCheckInAt" TIMESTAMP(3),
    "reportedStart" TIMESTAMP(3),
    "reportedEnd" TIMESTAMP(3),
    "officeStart" TIMESTAMP(3),
    "officeEnd" TIMESTAMP(3),
    "officeByUserId" UUID,
    "officeAt" TIMESTAMP(3),
    "officeReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitAttendanceVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling"."VisitAttendanceVerificationEntry" (
    "id" UUID NOT NULL,
    "verificationId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "clientEventId" TEXT,
    "actorEmployeeId" UUID,
    "actorUserId" UUID,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitAttendanceVerificationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitAttendanceVerification_scheduledJobId_idx" ON "scheduling"."VisitAttendanceVerification"("scheduledJobId");

-- CreateIndex
CREATE INDEX "VisitAttendanceVerification_employeeId_idx" ON "scheduling"."VisitAttendanceVerification"("employeeId");

-- CreateIndex
CREATE INDEX "VisitAttendanceVerification_needsReview_idx" ON "scheduling"."VisitAttendanceVerification"("needsReview");

-- CreateIndex
CREATE UNIQUE INDEX "VisitAttendanceVerification_scheduledJobId_employeeId_key" ON "scheduling"."VisitAttendanceVerification"("scheduledJobId", "employeeId");

-- CreateIndex
CREATE INDEX "VisitAttendanceVerificationEntry_verificationId_idx" ON "scheduling"."VisitAttendanceVerificationEntry"("verificationId");

-- CreateIndex
CREATE UNIQUE INDEX "VisitAttendanceVerificationEntry_verificationId_clientEvent_key" ON "scheduling"."VisitAttendanceVerificationEntry"("verificationId", "clientEventId");

-- AddForeignKey
ALTER TABLE "scheduling"."VisitAttendanceVerificationEntry" ADD CONSTRAINT "VisitAttendanceVerificationEntry_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "scheduling"."VisitAttendanceVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

