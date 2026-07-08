-- Charge card assignment targets and explicit defaults (Birdie / Access pattern)
ALTER TABLE "billing"."ChargeCard"
  ADD COLUMN "assignmentTargetId" UUID,
  ADD COLUMN "assignmentTargetKey" TEXT;

CREATE INDEX "ChargeCard_assignmentLevel_assignmentTargetId_idx"
  ON "billing"."ChargeCard"("assignmentLevel", "assignmentTargetId");

CREATE INDEX "ChargeCard_assignmentLevel_assignmentTargetKey_idx"
  ON "billing"."ChargeCard"("assignmentLevel", "assignmentTargetKey");

ALTER TABLE "service_users"."Funder"
  ADD COLUMN "defaultChargeCardId" UUID;

ALTER TABLE "service_users"."ServiceUser"
  ADD COLUMN "defaultChargeCardId" UUID;

ALTER TABLE "service_users"."ServiceUserFunding"
  ADD COLUMN "defaultChargeCardId" UUID;

CREATE INDEX "Funder_defaultChargeCardId_idx"
  ON "service_users"."Funder"("defaultChargeCardId");

CREATE INDEX "ServiceUser_defaultChargeCardId_idx"
  ON "service_users"."ServiceUser"("defaultChargeCardId");

CREATE INDEX "ServiceUserFunding_defaultChargeCardId_idx"
  ON "service_users"."ServiceUserFunding"("defaultChargeCardId");

ALTER TABLE "service_users"."Funder"
  ADD CONSTRAINT "Funder_defaultChargeCardId_fkey"
  FOREIGN KEY ("defaultChargeCardId") REFERENCES "billing"."ChargeCard"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."ServiceUser"
  ADD CONSTRAINT "ServiceUser_defaultChargeCardId_fkey"
  FOREIGN KEY ("defaultChargeCardId") REFERENCES "billing"."ChargeCard"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."ServiceUserFunding"
  ADD CONSTRAINT "ServiceUserFunding_defaultChargeCardId_fkey"
  FOREIGN KEY ("defaultChargeCardId") REFERENCES "billing"."ChargeCard"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
