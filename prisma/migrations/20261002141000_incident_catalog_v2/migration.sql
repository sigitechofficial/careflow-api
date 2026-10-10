-- Incident catalog v2 (14 categories). Idempotent: upsert by stable key, never delete.
-- Categories/subtypes no longer offered are deactivated (Incident.categoryId is ON DELETE RESTRICT).

INSERT INTO "incidents"."IncidentCategory" ("id","key","label","isSystem","sortOrder","isActive","createdAt","updatedAt")
VALUES (gen_random_uuid(), 'ACCIDENT', 'Accident', true, 0, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "isSystem" = true, "deletedAt" = NULL, "updatedAt" = now();
INSERT INTO "incidents"."IncidentSubtype" ("id","categoryId","key","label","sortOrder","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(), c."id", v.key, v.label, v.sort, true, now(), now()
FROM "incidents"."IncidentCategory" c, (VALUES
  ('SLIP', 'Slip', 0),
  ('TRIP', 'Trip', 1),
  ('FALL', 'Fall', 2),
  ('COLLISION', 'Collision', 3),
  ('BURN_SCALD', 'Burn / Scald', 4),
  ('CUT_ABRASION', 'Cut / Abrasion', 5),
  ('MANUAL_HANDLING', 'Manual Handling', 6),
  ('CHOKING', 'Choking', 7),
  ('EQUIPMENT_RELATED', 'Equipment Related', 8),
  ('OTHER', 'Other', 9)
) AS v(key, label, sort)
WHERE c."key" = 'ACCIDENT'
ON CONFLICT ("categoryId","key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "deletedAt" = NULL, "updatedAt" = now();

INSERT INTO "incidents"."IncidentCategory" ("id","key","label","isSystem","sortOrder","isActive","createdAt","updatedAt")
VALUES (gen_random_uuid(), 'NEAR_MISS', 'Near Miss', true, 1, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "isSystem" = true, "deletedAt" = NULL, "updatedAt" = now();
INSERT INTO "incidents"."IncidentSubtype" ("id","categoryId","key","label","sortOrder","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(), c."id", v.key, v.label, v.sort, true, now(), now()
FROM "incidents"."IncidentCategory" c, (VALUES
  ('MEDICATION_NEAR_MISS', 'Medication Near Miss', 0),
  ('FALL_PREVENTED', 'Fall Prevented', 1),
  ('EQUIPMENT_NEAR_MISS', 'Equipment Near Miss', 2),
  ('ENVIRONMENTAL_NEAR_MISS', 'Environmental Near Miss', 3),
  ('OTHER', 'Other', 4)
) AS v(key, label, sort)
WHERE c."key" = 'NEAR_MISS'
ON CONFLICT ("categoryId","key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "deletedAt" = NULL, "updatedAt" = now();

INSERT INTO "incidents"."IncidentCategory" ("id","key","label","isSystem","sortOrder","isActive","createdAt","updatedAt")
VALUES (gen_random_uuid(), 'SAFEGUARDING', 'Safeguarding Concern', true, 2, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "isSystem" = true, "deletedAt" = NULL, "updatedAt" = now();
INSERT INTO "incidents"."IncidentSubtype" ("id","categoryId","key","label","sortOrder","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(), c."id", v.key, v.label, v.sort, true, now(), now()
FROM "incidents"."IncidentCategory" c, (VALUES
  ('PHYSICAL_ABUSE', 'Physical Abuse', 0),
  ('DOMESTIC_ABUSE', 'Domestic Abuse', 1),
  ('SEXUAL_ABUSE', 'Sexual Abuse', 2),
  ('EMOTIONAL_ABUSE', 'Psychological / Emotional Abuse', 3),
  ('FINANCIAL_ABUSE', 'Financial / Material Abuse', 4),
  ('MODERN_SLAVERY', 'Modern Slavery', 5),
  ('DISCRIMINATORY_ABUSE', 'Discriminatory Abuse', 6),
  ('ORGANISATIONAL_ABUSE', 'Organisational Abuse', 7),
  ('NEGLECT', 'Neglect / Acts of Omission', 8),
  ('SELF_NEGLECT', 'Self-neglect', 9),
  ('OTHER', 'Other', 10)
) AS v(key, label, sort)
WHERE c."key" = 'SAFEGUARDING'
ON CONFLICT ("categoryId","key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "deletedAt" = NULL, "updatedAt" = now();

INSERT INTO "incidents"."IncidentCategory" ("id","key","label","isSystem","sortOrder","isActive","createdAt","updatedAt")
VALUES (gen_random_uuid(), 'MEDICATION', 'Medication Incident', true, 3, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "isSystem" = true, "deletedAt" = NULL, "updatedAt" = now();
INSERT INTO "incidents"."IncidentSubtype" ("id","categoryId","key","label","sortOrder","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(), c."id", v.key, v.label, v.sort, true, now(), now()
FROM "incidents"."IncidentCategory" c, (VALUES
  ('MISSED_DOSE', 'Missed Dose', 0),
  ('WRONG_DOSE', 'Wrong Dose', 1),
  ('WRONG_MEDICATION', 'Wrong Medication', 2),
  ('WRONG_PERSON', 'Wrong Person', 3),
  ('WRONG_TIME', 'Wrong Time', 4),
  ('WRONG_ROUTE', 'Wrong Route', 5),
  ('REFUSED', 'Refused Medication', 6),
  ('UNAVAILABLE', 'Medication Unavailable', 7),
  ('STOCK_DISCREPANCY', 'Stock / Count Discrepancy', 8),
  ('EXPIRED_MEDICATION', 'Expired Medication', 9),
  ('MAR_ISSUE', 'MAR Issue', 10),
  ('CONTROLLED_DRUG_ISSUE', 'Controlled Drug Issue', 11),
  ('OTHER', 'Other', 12)
) AS v(key, label, sort)
WHERE c."key" = 'MEDICATION'
ON CONFLICT ("categoryId","key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "deletedAt" = NULL, "updatedAt" = now();

INSERT INTO "incidents"."IncidentCategory" ("id","key","label","isSystem","sortOrder","isActive","createdAt","updatedAt")
VALUES (gen_random_uuid(), 'BEHAVIOUR', 'Behaviour / Distress Incident', true, 4, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "isSystem" = true, "deletedAt" = NULL, "updatedAt" = now();
INSERT INTO "incidents"."IncidentSubtype" ("id","categoryId","key","label","sortOrder","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(), c."id", v.key, v.label, v.sort, true, now(), now()
FROM "incidents"."IncidentCategory" c, (VALUES
  ('VERBAL_AGGRESSION', 'Verbal Aggression', 0),
  ('PHYSICAL_AGGRESSION', 'Physical Aggression', 1),
  ('SELF_INJURY', 'Self Injury', 2),
  ('PROPERTY_DAMAGE', 'Property Damage', 3),
  ('CHALLENGING', 'Distressed / Challenging Behaviour', 4),
  ('RESTRICTIVE_INTERVENTION', 'Restrictive Intervention', 5),
  ('THREATENING_BEHAVIOUR', 'Threatening Behaviour', 6),
  ('OTHER', 'Other', 7)
) AS v(key, label, sort)
WHERE c."key" = 'BEHAVIOUR'
ON CONFLICT ("categoryId","key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "deletedAt" = NULL, "updatedAt" = now();

INSERT INTO "incidents"."IncidentCategory" ("id","key","label","isSystem","sortOrder","isActive","createdAt","updatedAt")
VALUES (gen_random_uuid(), 'SKIN_WOUND', 'Skin Integrity / Wound', true, 5, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "isSystem" = true, "deletedAt" = NULL, "updatedAt" = now();
INSERT INTO "incidents"."IncidentSubtype" ("id","categoryId","key","label","sortOrder","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(), c."id", v.key, v.label, v.sort, true, now(), now()
FROM "incidents"."IncidentCategory" c, (VALUES
  ('PRESSURE_ULCER', 'Pressure Ulcer', 0),
  ('SKIN_TEAR', 'Skin Tear', 1),
  ('WOUND', 'Wound', 2),
  ('BRUISING', 'Bruising', 3),
  ('UNEXPLAINED_BRUISING', 'Unexplained Bruising / Injury', 4),
  ('MOISTURE_DAMAGE', 'Moisture Damage', 5),
  ('RASH_SKIN_INFECTION', 'Rash / Skin Infection', 6),
  ('OTHER', 'Other', 7)
) AS v(key, label, sort)
WHERE c."key" = 'SKIN_WOUND'
ON CONFLICT ("categoryId","key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "deletedAt" = NULL, "updatedAt" = now();

INSERT INTO "incidents"."IncidentCategory" ("id","key","label","isSystem","sortOrder","isActive","createdAt","updatedAt")
VALUES (gen_random_uuid(), 'HEALTH_SAFETY', 'Health & Safety / Environment', true, 6, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "isSystem" = true, "deletedAt" = NULL, "updatedAt" = now();
INSERT INTO "incidents"."IncidentSubtype" ("id","categoryId","key","label","sortOrder","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(), c."id", v.key, v.label, v.sort, true, now(), now()
FROM "incidents"."IncidentCategory" c, (VALUES
  ('ENVIRONMENT', 'Environmental Hazard', 0),
  ('EQUIPMENT', 'Equipment Failure', 1),
  ('FIRE', 'Fire / Evacuation', 2),
  ('KEY_SAFE_SECURITY', 'Key Safe / Security Issue', 3),
  ('UTILITY_FAILURE', 'Utility Failure', 4),
  ('NEEDLESTICK_SHARPS', 'Needle-stick / Sharps', 5),
  ('OTHER', 'Other', 6)
) AS v(key, label, sort)
WHERE c."key" = 'HEALTH_SAFETY'
ON CONFLICT ("categoryId","key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "deletedAt" = NULL, "updatedAt" = now();

INSERT INTO "incidents"."IncidentCategory" ("id","key","label","isSystem","sortOrder","isActive","createdAt","updatedAt")
VALUES (gen_random_uuid(), 'CARE_DELIVERY', 'Care Delivery / Visit Incident', true, 7, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "isSystem" = true, "deletedAt" = NULL, "updatedAt" = now();
INSERT INTO "incidents"."IncidentSubtype" ("id","categoryId","key","label","sortOrder","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(), c."id", v.key, v.label, v.sort, true, now(), now()
FROM "incidents"."IncidentCategory" c, (VALUES
  ('MISSED_VISIT', 'Missed Visit', 0),
  ('LATE_VISIT', 'Late Visit', 1),
  ('SHORT_VISIT', 'Short Visit', 2),
  ('CARER_NO_SHOW', 'Carer No-show', 3),
  ('UNABLE_TO_ACCESS', 'Unable to Access', 4),
  ('VISIT_NOT_COMPLETED', 'Visit Not Completed', 5),
  ('ESSENTIAL_TASK_MISSED', 'Essential Care Task Missed', 6),
  ('OTHER', 'Other', 7)
) AS v(key, label, sort)
WHERE c."key" = 'CARE_DELIVERY'
ON CONFLICT ("categoryId","key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "deletedAt" = NULL, "updatedAt" = now();

INSERT INTO "incidents"."IncidentCategory" ("id","key","label","isSystem","sortOrder","isActive","createdAt","updatedAt")
VALUES (gen_random_uuid(), 'HEALTH_DETERIORATION', 'Health Deterioration / Medical Emergency', true, 8, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "isSystem" = true, "deletedAt" = NULL, "updatedAt" = now();
INSERT INTO "incidents"."IncidentSubtype" ("id","categoryId","key","label","sortOrder","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(), c."id", v.key, v.label, v.sort, true, now(), now()
FROM "incidents"."IncidentCategory" c, (VALUES
  ('SUDDEN_DETERIORATION', 'Sudden Deterioration', 0),
  ('COLLAPSE_UNRESPONSIVE', 'Collapse / Unresponsive', 1),
  ('BREATHING_DIFFICULTY', 'Breathing Difficulty', 2),
  ('CHEST_PAIN', 'Chest Pain', 3),
  ('SEIZURE', 'Seizure', 4),
  ('SUSPECTED_STROKE', 'Suspected Stroke', 5),
  ('DIABETIC_EMERGENCY', 'Diabetic Emergency', 6),
  ('OTHER', 'Other', 7)
) AS v(key, label, sort)
WHERE c."key" = 'HEALTH_DETERIORATION'
ON CONFLICT ("categoryId","key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "deletedAt" = NULL, "updatedAt" = now();

INSERT INTO "incidents"."IncidentCategory" ("id","key","label","isSystem","sortOrder","isActive","createdAt","updatedAt")
VALUES (gen_random_uuid(), 'DEATH', 'Death', true, 9, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "isSystem" = true, "deletedAt" = NULL, "updatedAt" = now();
INSERT INTO "incidents"."IncidentSubtype" ("id","categoryId","key","label","sortOrder","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(), c."id", v.key, v.label, v.sort, true, now(), now()
FROM "incidents"."IncidentCategory" c, (VALUES
  ('EXPECTED_DEATH', 'Expected Death', 0),
  ('UNEXPECTED_DEATH', 'Unexpected Death', 1)
) AS v(key, label, sort)
WHERE c."key" = 'DEATH'
ON CONFLICT ("categoryId","key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "deletedAt" = NULL, "updatedAt" = now();

INSERT INTO "incidents"."IncidentCategory" ("id","key","label","isSystem","sortOrder","isActive","createdAt","updatedAt")
VALUES (gen_random_uuid(), 'INFECTION', 'Infection', true, 10, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "isSystem" = true, "deletedAt" = NULL, "updatedAt" = now();
INSERT INTO "incidents"."IncidentSubtype" ("id","categoryId","key","label","sortOrder","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(), c."id", v.key, v.label, v.sort, true, now(), now()
FROM "incidents"."IncidentCategory" c, (VALUES
  ('SUSPECTED_INFECTION', 'Suspected Infection', 0),
  ('CONFIRMED_INFECTION', 'Confirmed Infection', 1),
  ('OUTBREAK', 'Outbreak', 2),
  ('OTHER', 'Other', 3)
) AS v(key, label, sort)
WHERE c."key" = 'INFECTION'
ON CONFLICT ("categoryId","key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "deletedAt" = NULL, "updatedAt" = now();

INSERT INTO "incidents"."IncidentCategory" ("id","key","label","isSystem","sortOrder","isActive","createdAt","updatedAt")
VALUES (gen_random_uuid(), 'VIOLENCE_TO_STAFF', 'Violence / Abuse to Staff', true, 11, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "isSystem" = true, "deletedAt" = NULL, "updatedAt" = now();
INSERT INTO "incidents"."IncidentSubtype" ("id","categoryId","key","label","sortOrder","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(), c."id", v.key, v.label, v.sort, true, now(), now()
FROM "incidents"."IncidentCategory" c, (VALUES
  ('VERBAL_ABUSE', 'Verbal Abuse', 0),
  ('PHYSICAL_ASSAULT', 'Physical Assault', 1),
  ('THREATS', 'Threats', 2),
  ('HARASSMENT', 'Harassment', 3),
  ('SEXUAL_HARASSMENT', 'Sexual Harassment / Assault', 4),
  ('ANIMAL_ATTACK', 'Animal Attack', 5),
  ('OTHER', 'Other', 6)
) AS v(key, label, sort)
WHERE c."key" = 'VIOLENCE_TO_STAFF'
ON CONFLICT ("categoryId","key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "deletedAt" = NULL, "updatedAt" = now();

INSERT INTO "incidents"."IncidentCategory" ("id","key","label","isSystem","sortOrder","isActive","createdAt","updatedAt")
VALUES (gen_random_uuid(), 'DATA_BREACH', 'Data / Confidentiality Breach', true, 12, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "isSystem" = true, "deletedAt" = NULL, "updatedAt" = now();
INSERT INTO "incidents"."IncidentSubtype" ("id","categoryId","key","label","sortOrder","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(), c."id", v.key, v.label, v.sort, true, now(), now()
FROM "incidents"."IncidentCategory" c, (VALUES
  ('LOST_DEVICE_PAPERWORK', 'Lost Device / Paperwork', 0),
  ('SENT_TO_WRONG_PERSON', 'Sent to Wrong Person', 1),
  ('UNAUTHORISED_ACCESS', 'Unauthorised Access', 2),
  ('INCORRECT_DISCLOSURE', 'Incorrect Disclosure', 3),
  ('OTHER', 'Other', 4)
) AS v(key, label, sort)
WHERE c."key" = 'DATA_BREACH'
ON CONFLICT ("categoryId","key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "deletedAt" = NULL, "updatedAt" = now();

INSERT INTO "incidents"."IncidentCategory" ("id","key","label","isSystem","sortOrder","isActive","createdAt","updatedAt")
VALUES (gen_random_uuid(), 'OTHER', 'General / Other Incident', true, 13, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "isSystem" = true, "deletedAt" = NULL, "updatedAt" = now();
INSERT INTO "incidents"."IncidentSubtype" ("id","categoryId","key","label","sortOrder","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(), c."id", v.key, v.label, v.sort, true, now(), now()
FROM "incidents"."IncidentCategory" c, (VALUES
  ('PROPERTY_LOSS_DAMAGE', 'Property Loss / Damage', 0),
  ('MONEY_MISSING', 'Money Missing', 1),
  ('MISSING_PERSON', 'Missing Person / Absconded', 2),
  ('VEHICLE_ROAD', 'Vehicle / Road Incident', 3),
  ('OTHER', 'Other', 4)
) AS v(key, label, sort)
WHERE c."key" = 'OTHER'
ON CONFLICT ("categoryId","key") DO UPDATE SET "label" = EXCLUDED."label", "sortOrder" = EXCLUDED."sortOrder", "isActive" = true, "deletedAt" = NULL, "updatedAt" = now();

UPDATE "incidents"."IncidentCategory" SET "isActive" = false, "updatedAt" = now() WHERE "key" = 'INCIDENT';
UPDATE "incidents"."IncidentSubtype" s SET "isActive" = false, "updatedAt" = now() FROM "incidents"."IncidentCategory" c WHERE s."categoryId" = c."id" AND c."key" = 'BEHAVIOUR' AND s."key" = 'ABSCONDING';
