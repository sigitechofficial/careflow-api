-- Governance -> CQC notifications: organisation policies attached to a notification.
-- Additive only: one enum and one table in the quality schema.

-- CreateEnum
CREATE TYPE "quality"."CqcNotificationPolicySource" AS ENUM ('SUGGESTED', 'MANUAL');

-- CreateTable
CREATE TABLE "quality"."CqcNotificationPolicy" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "policyDocumentId" UUID NOT NULL,
    "policyVersionId" UUID,
    "referenceSnapshot" TEXT NOT NULL,
    "titleSnapshot" TEXT NOT NULL,
    "versionLabel" TEXT,
    "source" "quality"."CqcNotificationPolicySource" NOT NULL DEFAULT 'MANUAL',
    "addedById" UUID,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CqcNotificationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CqcNotificationPolicy_policyDocumentId_idx" ON "quality"."CqcNotificationPolicy"("policyDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "CqcNotificationPolicy_notificationId_policyDocumentId_key" ON "quality"."CqcNotificationPolicy"("notificationId", "policyDocumentId");

-- AddForeignKey
ALTER TABLE "quality"."CqcNotificationPolicy" ADD CONSTRAINT "CqcNotificationPolicy_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "quality"."CqcNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

