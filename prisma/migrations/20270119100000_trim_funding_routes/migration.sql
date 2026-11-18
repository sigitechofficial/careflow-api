-- Funding routes: keep the 19 that fit a home care service; switch the rest off (not deleted).
-- A route a service user or a funding line already uses stays on, so no record loses its route.
UPDATE service_users."ServiceUserFundingType" t
   SET "isActive" = false, "updatedAt" = now()
 WHERE t."isActive" = true
   AND t.code NOT IN ('LA_SPOT_PURCHASE', 'LA_FRAMEWORK', 'LA_BLOCK_CONTRACT', 'LA_ENABLEMENT', 'LA_RESPITE', 'LA_EMERGENCY', 'NHS_CHC', 'NHS_CHC_FAST_TRACK', 'NHS_SECTION_117', 'NHS_DISCHARGE_TO_ASSESS', 'PERSONAL_HEALTH_BUDGET', 'DP_SELF_MANAGED', 'DP_MANAGED_ACCOUNT', 'INDIVIDUAL_SERVICE_FUND', 'SELF_FULL', 'SELF_THIRD_PARTY_TOP_UP', 'COURT_OF_PROTECTION', 'LPA_FUNDS', 'NOT_YET_ASSESSED')
   AND NOT EXISTS (SELECT 1 FROM service_users."ServiceUser" su WHERE su."fundingTypeId" = t.id)
   AND NOT EXISTS (SELECT 1 FROM service_users."ServiceUserFunding" f WHERE f."fundingRouteId" = t.id);

-- The kept routes are on, with their tidy names.
UPDATE service_users."ServiceUserFundingType" SET "isActive" = true, "updatedAt" = now()
 WHERE code IN ('LA_SPOT_PURCHASE', 'LA_FRAMEWORK', 'LA_BLOCK_CONTRACT', 'LA_ENABLEMENT', 'LA_RESPITE', 'LA_EMERGENCY', 'NHS_CHC', 'NHS_CHC_FAST_TRACK', 'NHS_SECTION_117', 'NHS_DISCHARGE_TO_ASSESS', 'PERSONAL_HEALTH_BUDGET', 'DP_SELF_MANAGED', 'DP_MANAGED_ACCOUNT', 'INDIVIDUAL_SERVICE_FUND', 'SELF_FULL', 'SELF_THIRD_PARTY_TOP_UP', 'COURT_OF_PROTECTION', 'LPA_FUNDS', 'NOT_YET_ASSESSED') AND "isActive" = false;
