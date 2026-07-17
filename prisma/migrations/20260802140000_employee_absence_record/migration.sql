-- CreateTable
CREATE TABLE "employees"."EmployeeAbsenceRecord" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recordNo" SERIAL NOT NULL,
  "employeeId" UUID NOT NULL,
  "absenceType" TEXT NOT NULL,
  "fromDateTime" TIMESTAMP(3) NOT NULL,
  "toDateTime" TIMESTAMP(3) NOT NULL,
  "sicknessFlag" BOOLEAN NOT NULL DEFAULT false,
  "lastMinuteFlag" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "countryVisited" TEXT,
  "trackerStatus" TEXT,
  "returnToWorkCompleted" BOOLEAN NOT NULL DEFAULT false,
  "evidenceNotesStatus" TEXT,
  "managerAction" TEXT,
  "comments" TEXT,
  "cosWorkerRef" TEXT,
  "visaRtwExpiry" TEXT,
  "permissionStatus" TEXT NOT NULL DEFAULT 'Authorised',
  "evidenceTypeRequired" TEXT,
  "evidenceHeld" BOOLEAN NOT NULL DEFAULT false,
  "evidenceReceivedDate" TIMESTAMP(3),
  "continuousWorkingDaysAbsent" INTEGER,
  "smsReported" BOOLEAN,
  "smsReportDate" TIMESTAMP(3),
  "responsiblePerson" TEXT,
  "nextReviewDate" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdById" UUID,
  "updatedById" UUID,

  CONSTRAINT "EmployeeAbsenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAbsenceRecord_recordNo_key"
  ON "employees"."EmployeeAbsenceRecord"("recordNo");

-- CreateIndex
CREATE INDEX "EmployeeAbsenceRecord_employeeId_fromDateTime_idx"
  ON "employees"."EmployeeAbsenceRecord"("employeeId", "fromDateTime");

-- CreateIndex
CREATE INDEX "EmployeeAbsenceRecord_fromDateTime_idx"
  ON "employees"."EmployeeAbsenceRecord"("fromDateTime");

-- CreateIndex
CREATE INDEX "EmployeeAbsenceRecord_deletedAt_idx"
  ON "employees"."EmployeeAbsenceRecord"("deletedAt");

-- AddForeignKey
ALTER TABLE "employees"."EmployeeAbsenceRecord"
  ADD CONSTRAINT "EmployeeAbsenceRecord_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
