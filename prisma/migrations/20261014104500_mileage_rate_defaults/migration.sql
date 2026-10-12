-- TR-09: the mileage rates the application applied to every date while they were fixed in the
-- code, recorded as the first period so that no amount changes. Their HMRC approved amounts are
-- left empty because nobody has verified them (policy decision D-15): until a person records
-- them, the tax treatment of mileage is reported as "not verified".
-- Data only, and safe to run twice.

-- The rates the application applied to every date before rates were recorded per period.
INSERT INTO "billing"."MileageRate"
  ("id", "effectiveFrom", "vehicleType", "rateFirst", "rateAfter", "thresholdMiles", "passengerRate", "label", "updatedAt")
VALUES
  (gen_random_uuid(), DATE '2000-04-06', 'CAR_VAN',         0.55, 0.25, 10000, 0.05, 'Rates used by the application before rates were recorded per period. HMRC approved amounts not verified.', CURRENT_TIMESTAMP),
  (gen_random_uuid(), DATE '2000-04-06', 'COMPANY_VEHICLE', 0.55, 0.25, 10000, 0.05, 'Rates used by the application before rates were recorded per period. HMRC approved amounts not verified.', CURRENT_TIMESTAMP),
  (gen_random_uuid(), DATE '2000-04-06', 'MOTORCYCLE',      0.24, 0.24, NULL,  0.05, 'Rates used by the application before rates were recorded per period. HMRC approved amounts not verified.', CURRENT_TIMESTAMP),
  (gen_random_uuid(), DATE '2000-04-06', 'BICYCLE',         0.20, 0.20, NULL,  0.05, 'Rates used by the application before rates were recorded per period. HMRC approved amounts not verified.', CURRENT_TIMESTAMP)
ON CONFLICT ("effectiveFrom", "vehicleType") DO NOTHING;
