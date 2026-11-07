-- Surveys: period copies of a repeating survey keep the repeating survey's origin. Copies made before
-- the code copied it (20261208090000_survey_origin_and_safeguards) may have no libraryReference /
-- libraryRevision / createdFromTemplateId: fill them from the clonedFromId parent where empty, so a
-- period of a ready-made survey is anonymity-locked like its parent. Values already set are kept.

UPDATE "surveys"."Survey" c
  SET "libraryReference" = p."libraryReference",
      "libraryRevision"  = COALESCE(c."libraryRevision", p."libraryRevision")
  FROM "surveys"."Survey" p
  WHERE c."clonedFromId" = p."id"
    AND c."libraryReference" IS NULL
    AND p."libraryReference" IS NOT NULL;

-- A copy that had the reference but not the revision takes the parent's revision of the same reference.
UPDATE "surveys"."Survey" c
  SET "libraryRevision" = p."libraryRevision"
  FROM "surveys"."Survey" p
  WHERE c."clonedFromId" = p."id"
    AND c."libraryRevision" IS NULL
    AND p."libraryRevision" IS NOT NULL
    AND c."libraryReference" = p."libraryReference";

UPDATE "surveys"."Survey" c
  SET "createdFromTemplateId" = p."createdFromTemplateId"
  FROM "surveys"."Survey" p
  WHERE c."clonedFromId" = p."id"
    AND c."createdFromTemplateId" IS NULL
    AND p."createdFromTemplateId" IS NOT NULL
    AND p."createdFromTemplateId" <> c."id";
