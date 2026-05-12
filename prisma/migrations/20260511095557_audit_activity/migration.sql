/*
  Warnings:

  - You are about to drop the column `entity` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `entityId` on the `AuditLog` table. All the data in the column will be lost.
  - Added the required column `module` to the `AuditLog` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "audit"."AuditStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "audit"."SecuritySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "audit"."DataAccessType" AS ENUM ('VIEW', 'DOWNLOAD', 'EXPORT', 'PRINT');

-- CreateEnum
CREATE TYPE "audit"."ExportType" AS ENUM ('CSV', 'EXCEL', 'PDF', 'PRINT');

-- DropIndex
DROP INDEX "audit"."AuditLog_entity_entityId_idx";

-- AlterTable
ALTER TABLE "audit"."AuditLog" DROP COLUMN "entity",
DROP COLUMN "entityId",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "module" TEXT NOT NULL,
ADD COLUMN     "newValues" JSONB,
ADD COLUMN     "oldValues" JSONB,
ADD COLUMN     "recordId" TEXT,
ADD COLUMN     "recordType" TEXT,
ADD COLUMN     "status" "audit"."AuditStatus" NOT NULL DEFAULT 'SUCCESS',
ADD COLUMN     "userAgent" TEXT;

-- CreateTable
CREATE TABLE "audit"."LoginHistory" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "email" TEXT,
    "event" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceName" TEXT,
    "status" "audit"."AuditStatus" NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."SecurityEvent" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "eventType" TEXT NOT NULL,
    "severity" "audit"."SecuritySeverity" NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."DataAccessLog" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "module" TEXT NOT NULL,
    "recordType" TEXT,
    "recordId" TEXT,
    "accessType" "audit"."DataAccessType" NOT NULL,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."ExportLog" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "module" TEXT NOT NULL,
    "exportType" "audit"."ExportType" NOT NULL,
    "filters" JSONB,
    "fileName" TEXT,
    "recordCount" INTEGER,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginHistory_userId_idx" ON "audit"."LoginHistory"("userId");

-- CreateIndex
CREATE INDEX "LoginHistory_event_idx" ON "audit"."LoginHistory"("event");

-- CreateIndex
CREATE INDEX "LoginHistory_status_idx" ON "audit"."LoginHistory"("status");

-- CreateIndex
CREATE INDEX "LoginHistory_createdAt_idx" ON "audit"."LoginHistory"("createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_userId_idx" ON "audit"."SecurityEvent"("userId");

-- CreateIndex
CREATE INDEX "SecurityEvent_eventType_idx" ON "audit"."SecurityEvent"("eventType");

-- CreateIndex
CREATE INDEX "SecurityEvent_severity_idx" ON "audit"."SecurityEvent"("severity");

-- CreateIndex
CREATE INDEX "SecurityEvent_createdAt_idx" ON "audit"."SecurityEvent"("createdAt");

-- CreateIndex
CREATE INDEX "DataAccessLog_userId_idx" ON "audit"."DataAccessLog"("userId");

-- CreateIndex
CREATE INDEX "DataAccessLog_module_idx" ON "audit"."DataAccessLog"("module");

-- CreateIndex
CREATE INDEX "DataAccessLog_recordType_recordId_idx" ON "audit"."DataAccessLog"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "DataAccessLog_createdAt_idx" ON "audit"."DataAccessLog"("createdAt");

-- CreateIndex
CREATE INDEX "ExportLog_userId_idx" ON "audit"."ExportLog"("userId");

-- CreateIndex
CREATE INDEX "ExportLog_module_idx" ON "audit"."ExportLog"("module");

-- CreateIndex
CREATE INDEX "ExportLog_exportType_idx" ON "audit"."ExportLog"("exportType");

-- CreateIndex
CREATE INDEX "ExportLog_createdAt_idx" ON "audit"."ExportLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_module_idx" ON "audit"."AuditLog"("module");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "audit"."AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_recordType_recordId_idx" ON "audit"."AuditLog"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "audit"."AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_status_idx" ON "audit"."AuditLog"("status");

-- AddForeignKey
ALTER TABLE "audit"."LoginHistory" ADD CONSTRAINT "LoginHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit"."SecurityEvent" ADD CONSTRAINT "SecurityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit"."DataAccessLog" ADD CONSTRAINT "DataAccessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit"."ExportLog" ADD CONSTRAINT "ExportLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
