-- CreateEnum
CREATE TYPE "surveys"."SurveyResponseChannel" AS ENUM ('ONLINE', 'PORTAL', 'TELEPHONE', 'PAPER', 'IN_PERSON');

-- AlterEnum
ALTER TYPE "surveys"."SurveyRespondentRelation" ADD VALUE 'STAFF';

-- AlterTable
ALTER TABLE "surveys"."SurveyResponse" ADD COLUMN     "channel" "surveys"."SurveyResponseChannel" NOT NULL DEFAULT 'ONLINE',
ADD COLUMN     "consentGiven" BOOLEAN,
ADD COLUMN     "contactNotes" TEXT,
ADD COLUMN     "contactNumber" TEXT,
ADD COLUMN     "contactedAt" TIMESTAMP(3),
ADD COLUMN     "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recordedById" UUID;


-- Service-user surveys can only be answered in the portal, so existing ones came from there.
UPDATE "surveys"."SurveyResponse" r
SET "channel" = 'PORTAL'
FROM "surveys"."SurveyRecipient" rc
WHERE rc."id" = r."recipientId" AND rc."targetKind" = 'SERVICE_USER';

-- Permission: record survey responses on someone's behalf (telephone / paper / in person).
INSERT INTO "identity"."Permission" ("id", "key", "description", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'surveys.responses.record', 'Record survey responses by telephone, paper or in person', true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "identity"."Permission" p WHERE p."key" = 'surveys.responses.record');

-- Every role that can manage surveys can also record responses.
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), rp."roleId", p."id", NOW()
FROM "identity"."RolePermission" rp
JOIN "identity"."Permission" pm ON pm."id" = rp."permissionId" AND pm."key" = 'surveys.manage'
CROSS JOIN "identity"."Permission" p
WHERE p."key" = 'surveys.responses.record'
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" x
    WHERE x."roleId" = rp."roleId" AND x."permissionId" = p."id"
  );

-- Super Admin and Admin always get it.
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Super Admin', 'Admin')
  AND p."key" = 'surveys.responses.record'
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" x
    WHERE x."roleId" = r."id" AND x."permissionId" = p."id"
  );
