-- Idempotent catalog for Funding tab (care services + rate cards).
-- Ensures data exists even if application seed was not run after migrate.

INSERT INTO "service_users"."FundingCareService" ("id","name","code","sortOrder","isActive","createdAt","updatedAt")
VALUES
  (gen_random_uuid(), 'Personal Care', 'PERSONAL_CARE', 0, true, now(), now()),
  (gen_random_uuid(), 'Waking Night', 'WAKING_NIGHT', 1, true, now(), now()),
  (gen_random_uuid(), 'Sleep-in Night', 'SLEEP_IN_NIGHT', 2, true, now(), now()),
  (gen_random_uuid(), 'Live-in care', 'LIVE_IN_CARE', 3, true, now(), now()),
  (gen_random_uuid(), 'Domestic call', 'DOMESTIC_CALL', 4, true, now(), now()),
  (gen_random_uuid(), 'Shopping Call', 'SHOPPING_CALL', 5, true, now(), now()),
  (gen_random_uuid(), 'Drivers', 'DRIVERS', 6, true, now(), now()),
  (gen_random_uuid(), 'Passenger Assistance', 'PASSENGER_ASSISTANCE', 7, true, now(), now()),
  (gen_random_uuid(), 'Cleaning Job', 'CLEANING_JOB', 8, true, now(), now()),
  (gen_random_uuid(), 'Home First', 'HOME_FIRST', 9, true, now(), now()),
  (gen_random_uuid(), 'Children services', 'CHILDREN_SERVICES', 10, true, now(), now()),
  (gen_random_uuid(), 'Family Support', 'FAMILY_SUPPORT', 11, true, now(), now()),
  (gen_random_uuid(), 'Support Disabled children & young People', 'SUPPORT_DISABLED_CHILDREN', 12, true, now(), now()),
  (gen_random_uuid(), 'Support Young People', 'SUPPORT_YOUNG_PEOPLE', 13, true, now(), now()),
  (gen_random_uuid(), 'Contact Supervision', 'CONTACT_SUPERVISION', 14, true, now(), now()),
  (gen_random_uuid(), 'Outreach', 'OUTREACH', 15, true, now(), now()),
  (gen_random_uuid(), 'Training', 'TRAINING', 16, true, now(), now())
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = true,
  "updatedAt" = now();

INSERT INTO "service_users"."RateCard" ("id","name","code","sortOrder","isActive","isCustom","serviceUserId","createdAt","updatedAt")
VALUES
  (gen_random_uuid(), 'Croydon Rates', 'CROYDON_RATES', 0, true, false, null, now(), now()),
  (gen_random_uuid(), 'Croydon 30 mins', 'CROYDON_30_MINS', 1, true, false, null, now(), now()),
  (gen_random_uuid(), 'Croydon 45 mins', 'CROYDON_45_MINS', 2, true, false, null, now(), now()),
  (gen_random_uuid(), 'Waking Night', 'RATE_WAKING_NIGHT', 3, true, false, null, now(), now()),
  (gen_random_uuid(), 'Domestic Call', 'RATE_DOMESTIC_CALL', 4, true, false, null, now(), now()),
  (gen_random_uuid(), 'Croydon 60 mins', 'CROYDON_60_MINS', 5, true, false, null, now(), now()),
  (gen_random_uuid(), 'P A', 'PA', 6, true, false, null, now(), now()),
  (gen_random_uuid(), 'Drivers', 'RATE_DRIVERS', 7, true, false, null, now(), now()),
  (gen_random_uuid(), 'Personal care Haringey', 'PERSONAL_CARE_HARINGEY', 8, true, false, null, now(), now()),
  (gen_random_uuid(), 'Outreach Haringey', 'OUTREACH_HARINGEY', 9, true, false, null, now(), now()),
  (gen_random_uuid(), 'Merton Rates', 'MERTON_RATES', 10, true, false, null, now(), now()),
  (gen_random_uuid(), 'Hackney Council', 'HACKNEY_COUNCIL', 11, true, false, null, now(), now()),
  (gen_random_uuid(), 'Greenwich Council', 'GREENWICH_COUNCIL', 12, true, false, null, now(), now()),
  (gen_random_uuid(), 'Lambeth Council', 'LAMBETH_COUNCIL', 13, true, false, null, now(), now()),
  (gen_random_uuid(), 'Southwark Council', 'SOUTHWARK_COUNCIL', 14, true, false, null, now(), now()),
  (gen_random_uuid(), 'Lewisham Council', 'LEWISHAM_COUNCIL', 15, true, false, null, now(), now()),
  (gen_random_uuid(), 'Bromley Council', 'BROMLEY_COUNCIL', 16, true, false, null, now(), now()),
  (gen_random_uuid(), 'Bexley Council', 'BEXLEY_COUNCIL', 17, true, false, null, now(), now()),
  (gen_random_uuid(), 'Service user Private', 'SU_PRIVATE', 18, true, false, null, now(), now()),
  (gen_random_uuid(), 'Allfor care', 'ALLFOR_CARE', 19, true, false, null, now(), now()),
  (gen_random_uuid(), 'Bexley Council ISF', 'BEXLEY_ISF', 20, true, false, null, now(), now()),
  (gen_random_uuid(), 'Private', 'PRIVATE', 21, true, false, null, now(), now()),
  (gen_random_uuid(), 'cleaners', 'CLEANERS', 22, true, false, null, now(), now()),
  (gen_random_uuid(), 'HOME FIRST CROYDON', 'HOME_FIRST_CROYDON', 23, true, false, null, now(), now()),
  (gen_random_uuid(), 'Supervised contract', 'SUPERVISED_CONTRACT', 24, true, false, null, now(), now()),
  (gen_random_uuid(), 'Standard Local Authority', 'STANDARD_LA', 25, true, false, null, now(), now()),
  (gen_random_uuid(), 'NHS CHC Standard', 'NHS_CHC_STANDARD', 26, true, false, null, now(), now())
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = true,
  "isCustom" = false,
  "serviceUserId" = null,
  "updatedAt" = now();
