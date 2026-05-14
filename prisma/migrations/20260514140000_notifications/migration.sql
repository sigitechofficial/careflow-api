-- In-app notifications (notifications schema; WebSocket delivery is separate)

CREATE SCHEMA IF NOT EXISTS "notifications";

CREATE TYPE "notifications"."NotificationType" AS ENUM (
  'COMPLIANCE_EXPIRING',
  'COMPLIANCE_EXPIRED',
  'EMPLOYEE_DOCUMENT_UPLOADED',
  'EMPLOYEE_STATUS_CHANGED',
  'SERVICE_USER_UPDATED',
  'CARE_PLAN_REVIEW_DUE',
  'MEDICATION_ALERT',
  'INCIDENT_REPORTED',
  'SCHEDULE_UNALLOCATED_VISIT',
  'REPORT_READY',
  'SECURITY_ALERT',
  'SYSTEM_MESSAGE'
);

CREATE TYPE "notifications"."NotificationSeverity" AS ENUM (
  'INFO',
  'SUCCESS',
  'WARNING',
  'ERROR',
  'CRITICAL'
);

CREATE TYPE "notifications"."NotificationModule" AS ENUM (
  'AUTH',
  'EMPLOYEE',
  'EMPLOYEE_COMPLIANCE',
  'SERVICE_USER',
  'SERVICE_CARE',
  'SCHEDULING',
  'REPORT',
  'SECURITY',
  'SYSTEM'
);

CREATE TABLE "notifications"."Notification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "notifications"."NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "module" "notifications"."NotificationModule" NOT NULL,
    "recordType" TEXT,
    "recordId" UUID,
    "severity" "notifications"."NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "metadata" JSONB,
    "createdById" UUID,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications"."NotificationRecipient" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notificationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications"."NotificationPreference" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "type" "notifications"."NotificationType" NOT NULL,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationRecipient_notificationId_userId_key" ON "notifications"."NotificationRecipient"("notificationId", "userId");
CREATE INDEX "NotificationRecipient_userId_idx" ON "notifications"."NotificationRecipient"("userId");
CREATE INDEX "NotificationRecipient_notificationId_idx" ON "notifications"."NotificationRecipient"("notificationId");
CREATE INDEX "NotificationRecipient_readAt_idx" ON "notifications"."NotificationRecipient"("readAt");
CREATE INDEX "NotificationRecipient_dismissedAt_idx" ON "notifications"."NotificationRecipient"("dismissedAt");
CREATE INDEX "NotificationRecipient_createdAt_idx" ON "notifications"."NotificationRecipient"("createdAt");

CREATE UNIQUE INDEX "NotificationPreference_userId_type_key" ON "notifications"."NotificationPreference"("userId", "type");
CREATE INDEX "NotificationPreference_userId_idx" ON "notifications"."NotificationPreference"("userId");

CREATE INDEX "Notification_type_idx" ON "notifications"."Notification"("type");
CREATE INDEX "Notification_module_idx" ON "notifications"."Notification"("module");
CREATE INDEX "Notification_severity_idx" ON "notifications"."Notification"("severity");
CREATE INDEX "Notification_createdAt_idx" ON "notifications"."Notification"("createdAt");
CREATE INDEX "Notification_recordType_recordId_idx" ON "notifications"."Notification"("recordType", "recordId");

ALTER TABLE "notifications"."Notification" ADD CONSTRAINT "Notification_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "notifications"."NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"."Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications"."NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"."NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
