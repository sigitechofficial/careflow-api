-- Mid-visit left-area lock (distinct from check-in OUTSIDE_GEOFENCE)

ALTER TYPE "scheduling"."EcmExceptionKind" ADD VALUE IF NOT EXISTS 'LEFT_VISIT_AREA';

CREATE TYPE "scheduling"."VisitAreaLockStatus" AS ENUM ('LOCKED', 'ALLOWED');

CREATE TABLE "scheduling"."VisitAreaLock" (
  "id" UUID NOT NULL,
  "scheduledJobId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "status" "scheduling"."VisitAreaLockStatus" NOT NULL DEFAULT 'LOCKED',
  "lockedAt" TIMESTAMP(3) NOT NULL,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "distanceMeters" INTEGER,
  "ecmExceptionId" UUID,
  "allowedAt" TIMESTAMP(3),
  "allowedById" UUID,
  "allowedByName" TEXT,
  "allowNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisitAreaLock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitAreaLock_ecmExceptionId_key" ON "scheduling"."VisitAreaLock"("ecmExceptionId");
CREATE INDEX "VisitAreaLock_scheduledJobId_status_idx" ON "scheduling"."VisitAreaLock"("scheduledJobId", "status");
CREATE INDEX "VisitAreaLock_scheduledJobId_lockedAt_idx" ON "scheduling"."VisitAreaLock"("scheduledJobId", "lockedAt");

ALTER TABLE "scheduling"."VisitAreaLock"
  ADD CONSTRAINT "VisitAreaLock_scheduledJobId_fkey"
  FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduling"."VisitAreaLock"
  ADD CONSTRAINT "VisitAreaLock_ecmExceptionId_fkey"
  FOREIGN KEY ("ecmExceptionId") REFERENCES "scheduling"."EcmException"("id") ON DELETE SET NULL ON UPDATE CASCADE;
