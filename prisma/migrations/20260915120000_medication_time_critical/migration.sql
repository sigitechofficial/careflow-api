-- Time-sensitive (time-critical) flag on each medicine, not only the visit-plan slot.
ALTER TABLE "service_users"."ServiceUserMedication"
  ADD COLUMN "timeCritical" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "timeToleranceMinutes" INTEGER NOT NULL DEFAULT 30;
