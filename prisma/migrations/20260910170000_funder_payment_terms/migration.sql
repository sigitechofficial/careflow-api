-- QBO-style: payment terms belong on the funder (customer/payer), not the charge card.
ALTER TABLE "service_users"."Funder" ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT;

-- Backfill from the funder's default charge card when present.
UPDATE "service_users"."Funder" AS f
SET "paymentTerms" = c."paymentTerms"
FROM "billing"."ChargeCard" AS c
WHERE f."defaultChargeCardId" = c.id
  AND f."paymentTerms" IS NULL
  AND c."paymentTerms" IS NOT NULL
  AND TRIM(c."paymentTerms") <> '';

-- Fallback: any FUNDER-attached charge card for this funder id.
UPDATE "service_users"."Funder" AS f
SET "paymentTerms" = sub."paymentTerms"
FROM (
  SELECT DISTINCT ON (c."assignmentTargetId")
    c."assignmentTargetId" AS "funderId",
    c."paymentTerms"
  FROM "billing"."ChargeCard" AS c
  WHERE c."assignmentLevel" = 'FUNDER'
    AND c."assignmentTargetId" IS NOT NULL
    AND c."paymentTerms" IS NOT NULL
    AND TRIM(c."paymentTerms") <> ''
    AND c."deletedAt" IS NULL
  ORDER BY c."assignmentTargetId", c."updatedAt" DESC
) AS sub
WHERE f.id = sub."funderId"
  AND f."paymentTerms" IS NULL;
