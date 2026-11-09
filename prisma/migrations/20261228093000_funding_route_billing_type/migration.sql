-- Each funding route (Personal Details) comes under one broad billing type (Funding tab). Routes the rules below
-- do not place are left empty for a manager to set in Settings -> Funding types.
ALTER TABLE service_users."ServiceUserFundingType" ADD COLUMN IF NOT EXISTS "billingFundingTypeId" UUID;
DO $$ BEGIN
  ALTER TABLE service_users."ServiceUserFundingType"
    ADD CONSTRAINT "ServiceUserFundingType_billingFundingTypeId_fkey"
    FOREIGN KEY ("billingFundingTypeId") REFERENCES service_users."FundingType"(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "ServiceUserFundingType_billingFundingTypeId_idx"
  ON service_users."ServiceUserFundingType"("billingFundingTypeId");

UPDATE service_users."ServiceUserFundingType" r
SET "billingFundingTypeId" = b.id
FROM (
  SELECT r2.id AS route_id,
    CASE
      WHEN r2.code IN (SELECT code FROM service_users."FundingType" WHERE "deletedAt" IS NULL) THEN r2.code
      WHEN r2.code IN ('FUNDING_UNKNOWN', 'NOT_YET_ASSESSED', 'PREFER_NOT_TO_SAY', 'ORDINARY_RESIDENCE_DISPUTE',
                       'HOSPITAL_DISCHARGE_PENDING') THEN 'UNKNOWN'
      WHEN r2.code LIKE 'DP\_%' ESCAPE '\' OR r2.code IN ('WALES_DIRECT_PAYMENT', 'INDIVIDUAL_SERVICE_FUND',
                       'NHS_DIRECT_PAYMENT_HEALTH', 'SCOTLAND_SDS') THEN 'DIRECT_PAYMENT'
      WHEN r2.code LIKE 'MIXED\_%' ESCAPE '\' OR r2.code IN ('PERSONAL_BUDGET_MIXED', 'INTEGRATED_PERSONAL_BUDGET',
                       'LA_SECTION_75', 'LA_PARTIAL') THEN 'MIXED'
      WHEN r2.code LIKE 'NHS\_%' ESCAPE '\' OR r2.code IN ('PERSONAL_HEALTH_BUDGET', 'HOSPITAL_NHS_INPATIENT',
                       'MHA_S117_AFTERCARE', 'NI_HSC_TRUST') THEN 'NHS'
      WHEN r2.code LIKE 'LA\_%' ESCAPE '\' OR r2.code IN ('WALES_LA', 'CARE_ACT_ORDINARY_RESIDENCE') THEN 'LOCAL_AUTHORITY'
      WHEN r2.code LIKE 'FAMILY\_%' ESCAPE '\' THEN 'FAMILY_FUNDED'
      WHEN r2.code LIKE 'SELF\_%' ESCAPE '\' OR r2.code IN ('NI_SELF_FUNDED', 'LPA_FUNDS', 'COURT_OF_PROTECTION',
                       'INSURANCE_PAYOUT', 'LEGAL_SETTLEMENT') THEN 'SELF_FUNDED'
      ELSE NULL
    END AS billing_code
  FROM service_users."ServiceUserFundingType" r2
) m
JOIN service_users."FundingType" b ON b.code = m.billing_code AND b."deletedAt" IS NULL
WHERE r.id = m.route_id AND r."billingFundingTypeId" IS NULL;

-- Benefits are the person's own money; council-run funds and partnerships are commissioned; CHC outcomes still open are unknown.
UPDATE service_users."ServiceUserFundingType" r
SET "billingFundingTypeId" = b.id
FROM (VALUES
  ('BENEFIT_AA', 'SELF_FUNDED'), ('BENEFIT_PIP', 'SELF_FUNDED'), ('BENEFIT_DLA', 'SELF_FUNDED'),
  ('BENEFIT_UC_CARE', 'SELF_FUNDED'), ('BENEFIT_PENSION_CREDIT', 'SELF_FUNDED'),
  ('SCOTLAND_HSCP', 'LOCAL_AUTHORITY'), ('DOLS_PLACEMENT', 'LOCAL_AUTHORITY'), ('BRIDGING_SHORT_TERM', 'LOCAL_AUTHORITY'),
  ('CONTINGENCY_FUND', 'LOCAL_AUTHORITY'), ('MARKET_SUSTAINABILITY', 'LOCAL_AUTHORITY'),
  ('CHC_CHECKLIST_NOT_PASSED', 'UNKNOWN'), ('CHC_FAST_TRACK_ENDED', 'UNKNOWN')
) AS m(route_code, billing_code)
JOIN service_users."FundingType" b ON b.code = m.billing_code AND b."deletedAt" IS NULL
WHERE r.code = m.route_code AND r."billingFundingTypeId" IS NULL;
