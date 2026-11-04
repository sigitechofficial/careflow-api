-- Phase 3A: care plan review & approval. Additive only; idempotent.
-- Existing drafts default to DRAFT and approval enforcement defaults to OFF, so publishing keeps
-- working exactly as before until an administrator turns carePlanApprovalRequired on.

DO $$ BEGIN
  CREATE TYPE "service_users"."ServiceUserCarePlanDraftApprovalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "service_users"."ServiceUserCarePlanDraft"
  ADD COLUMN IF NOT EXISTS "approvalStatus" "service_users"."ServiceUserCarePlanDraftApprovalStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "approvalContentHash" TEXT,
  ADD COLUMN IF NOT EXISTS "submittedForApprovalAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "submittedForApprovalById" UUID,
  ADD COLUMN IF NOT EXISTS "approvalDecidedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvalDecidedById" UUID,
  ADD COLUMN IF NOT EXISTS "approvalReason" TEXT;

ALTER TABLE "service_users"."ServiceUserCarePlanPublishedVersion"
  ADD COLUMN IF NOT EXISTS "approvalJson" JSONB;

ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN IF NOT EXISTS "carePlanApprovalRequired" BOOLEAN NOT NULL DEFAULT false;

-- Dedicated approval permission (not implied by service_users.update).
INSERT INTO "identity"."Permission" ("id", "key", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'service_users.care_plan.approve', true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "identity"."Permission" p WHERE p."key" = 'service_users.care_plan.approve'
);

-- Manager-level roles only.
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Super Admin', 'Admin', 'Manager', 'Branch Admin')
  AND r."deletedAt" IS NULL
  AND p."key" = 'service_users.care_plan.approve'
  AND p."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );
