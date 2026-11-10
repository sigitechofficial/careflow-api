-- The funding route moves onto each funding line, next to its funder.
ALTER TABLE service_users."ServiceUserFunding" ADD COLUMN IF NOT EXISTS "fundingRouteId" UUID;
DO $$ BEGIN
  ALTER TABLE service_users."ServiceUserFunding"
    ADD CONSTRAINT "ServiceUserFunding_fundingRouteId_fkey"
    FOREIGN KEY ("fundingRouteId") REFERENCES service_users."ServiceUserFundingType"(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "ServiceUserFunding_fundingRouteId_idx" ON service_users."ServiceUserFunding"("fundingRouteId");

-- Existing people: copy the route from Personal Details onto their main funding line when it fits that
-- line's billing type. Lines where it does not fit are left for staff to choose.
UPDATE service_users."ServiceUserFunding" f
SET "fundingRouteId" = u."fundingTypeId"
FROM service_users."ServiceUser" u
JOIN service_users."ServiceUserFundingType" r ON r.id = u."fundingTypeId"
WHERE u."currentFundingId" = f.id
  AND f."fundingRouteId" IS NULL
  AND r."billingFundingTypeId" = f."fundingTypeId";
