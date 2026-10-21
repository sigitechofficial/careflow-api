-- Carer notifications: push messages an office user sends by hand to carers
-- (Settings › Carer notifications). Additive only.

CREATE TYPE "notifications"."CarerMessageAudience" AS ENUM ('ALL', 'BRANCHES', 'EMPLOYEES');

CREATE TABLE "notifications"."CarerMessage" (
    "id" UUID NOT NULL,
    "title" VARCHAR(65) NOT NULL,
    "body" VARCHAR(240) NOT NULL,
    "audience" "notifications"."CarerMessageAudience" NOT NULL,
    "locationIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "employeeIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "withAppCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "sentById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CarerMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CarerMessage_createdAt_idx" ON "notifications"."CarerMessage"("createdAt");

CREATE TABLE "notifications"."CarerMessageRecipient" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "hadDevice" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CarerMessageRecipient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CarerMessageRecipient_messageId_employeeId_key" ON "notifications"."CarerMessageRecipient"("messageId", "employeeId");
CREATE INDEX "CarerMessageRecipient_employeeId_idx" ON "notifications"."CarerMessageRecipient"("employeeId");
ALTER TABLE "notifications"."CarerMessageRecipient" ADD CONSTRAINT "CarerMessageRecipient_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "notifications"."CarerMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permission to send carer notifications and see what was sent.
INSERT INTO "identity"."Permission" ("id", "key", "description", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'carer_notifications.send', 'Send push notifications to carers and view the send history', true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "identity"."Permission" p WHERE p."key" = 'carer_notifications.send');

-- Super Admin and Admin get it; other roles are given it in Roles & permissions.
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Super Admin', 'Admin')
  AND p."key" = 'carer_notifications.send'
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" x
    WHERE x."roleId" = r."id" AND x."permissionId" = p."id"
  );
