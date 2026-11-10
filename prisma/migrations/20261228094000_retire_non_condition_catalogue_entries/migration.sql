-- Hide catalogue entries that are not medical conditions and are recorded elsewhere (office flags, legal and
-- capacity records, medication support level, communication needs, falls risk, number of carers). People who
-- already have one keep it; they just can't be picked for new records.
UPDATE service_users."MedicalConditionCatalog"
SET "isActive" = false
WHERE code IN ('BARCODE_PLACED','NEWLY_ASSESSED','WEEKLY_NEW_PACKAGES','CARE_LOGS_CHECKED','INITIAL_CONTACT_10_START','NEW_CARE_PLAN_FORMAT','BEST_INTEREST_COMPLETE','LPA_OR_DEPUTY','HAS_CAPACITY','LACK_CAPACITY','BEST_INTEREST_LACK_CAPACITY','SELF_MEDICATE','PROMPT_ASSIST_MEDICATION','MEDICATION_BY_CARER','COMMUNICATION_NEEDS','HIGH_RISK_FALLS','DOUBLE_HAND_CLIENT');
