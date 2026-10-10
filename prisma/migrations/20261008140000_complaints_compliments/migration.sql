-- CreateEnum
CREATE TYPE "incidents"."FeedbackType" AS ENUM ('COMPLAINT', 'COMPLIMENT');

-- CreateEnum
CREATE TYPE "incidents"."FeedbackStatus" AS ENUM ('RECEIVED', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESPONDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "incidents"."FeedbackFromKind" AS ENUM ('SERVICE_USER', 'FAMILY', 'PROFESSIONAL', 'STAFF', 'PUBLIC', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "incidents"."FeedbackChannel" AS ENUM ('PHONE', 'EMAIL', 'LETTER', 'IN_PERSON', 'PORTAL', 'SURVEY', 'OTHER');

-- CreateEnum
CREATE TYPE "incidents"."ComplaintSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "incidents"."ComplaintOutcome" AS ENUM ('UPHELD', 'PARTIALLY_UPHELD', 'NOT_UPHELD', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "incidents"."FeedbackRecord" (
    "id" UUID NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "type" "incidents"."FeedbackType" NOT NULL,
    "status" "incidents"."FeedbackStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "channel" "incidents"."FeedbackChannel" NOT NULL DEFAULT 'PHONE',
    "fromKind" "incidents"."FeedbackFromKind" NOT NULL,
    "fromName" TEXT,
    "fromContact" TEXT,
    "fromServiceUserId" UUID,
    "fromEmployeeId" UUID,
    "aboutServiceUserId" UUID,
    "aboutEmployeeIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "locationId" UUID,
    "subject" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "category" TEXT,
    "severity" "incidents"."ComplaintSeverity",
    "desiredOutcome" TEXT,
    "handlerEmployeeId" UUID,
    "acknowledgeDueAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "responseDueAt" TIMESTAMP(3),
    "investigationNotes" TEXT,
    "respondedAt" TIMESTAMP(3),
    "responseSummary" TEXT,
    "outcome" "incidents"."ComplaintOutcome",
    "lessonsLearned" TEXT,
    "closedAt" TIMESTAMP(3),
    "sharedWithStaffAt" TIMESTAMP(3),
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,

    CONSTRAINT "FeedbackRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents"."FeedbackEvent" (
    "id" UUID NOT NULL,
    "feedbackId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents"."FeedbackNumberSequence" (
    "type" "incidents"."FeedbackType" NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackNumberSequence_pkey" PRIMARY KEY ("type","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackRecord_referenceNumber_key" ON "incidents"."FeedbackRecord"("referenceNumber");

-- CreateIndex
CREATE INDEX "FeedbackRecord_type_status_idx" ON "incidents"."FeedbackRecord"("type", "status");

-- CreateIndex
CREATE INDEX "FeedbackRecord_receivedAt_idx" ON "incidents"."FeedbackRecord"("receivedAt");

-- CreateIndex
CREATE INDEX "FeedbackRecord_aboutServiceUserId_idx" ON "incidents"."FeedbackRecord"("aboutServiceUserId");

-- CreateIndex
CREATE INDEX "FeedbackRecord_locationId_idx" ON "incidents"."FeedbackRecord"("locationId");

-- CreateIndex
CREATE INDEX "FeedbackRecord_deletedAt_idx" ON "incidents"."FeedbackRecord"("deletedAt");

-- CreateIndex
CREATE INDEX "FeedbackEvent_feedbackId_createdAt_idx" ON "incidents"."FeedbackEvent"("feedbackId", "createdAt");

-- AddForeignKey
ALTER TABLE "incidents"."FeedbackEvent" ADD CONSTRAINT "FeedbackEvent_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "incidents"."FeedbackRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Permissions: view / record and manage complaints & compliments.
INSERT INTO "identity"."Permission" ("id", "key", "description", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.key, v.description, true, NOW(), NOW()
FROM (VALUES
  ('complaints.read', 'View complaints and compliments'),
  ('complaints.manage', 'Record and manage complaints and compliments')
) AS v(key, description)
WHERE NOT EXISTS (SELECT 1 FROM "identity"."Permission" p WHERE p."key" = v.key);

-- Roles that can see incidents can see complaints; roles that review incidents can manage them.
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), rp."roleId", p."id", NOW()
FROM "identity"."RolePermission" rp
JOIN "identity"."Permission" pm ON pm."id" = rp."permissionId"
JOIN "identity"."Permission" p ON
  (pm."key" = 'incidents.read' AND p."key" = 'complaints.read')
  OR (pm."key" = 'incidents.review' AND p."key" = 'complaints.manage')
WHERE NOT EXISTS (
  SELECT 1 FROM "identity"."RolePermission" x
  WHERE x."roleId" = rp."roleId" AND x."permissionId" = p."id"
);

-- Super Admin and Admin always get both.
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Super Admin', 'Admin')
  AND p."key" IN ('complaints.read', 'complaints.manage')
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" x
    WHERE x."roleId" = r."id" AND x."permissionId" = p."id"
  );
