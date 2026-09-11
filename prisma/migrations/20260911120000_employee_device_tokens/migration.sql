-- Carer FCM device tokens + once-only visit push receipts

CREATE TYPE "employees"."DevicePushPlatform" AS ENUM ('ANDROID', 'IOS');

CREATE TABLE "employees"."EmployeeDeviceToken" (
  "id" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "token" TEXT NOT NULL,
  "platform" "employees"."DevicePushPlatform" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeDeviceToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeDeviceToken_token_key" ON "employees"."EmployeeDeviceToken"("token");
CREATE INDEX "EmployeeDeviceToken_employeeId_idx" ON "employees"."EmployeeDeviceToken"("employeeId");

ALTER TABLE "employees"."EmployeeDeviceToken"
  ADD CONSTRAINT "EmployeeDeviceToken_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "scheduling"."CarerVisitPushKind" AS ENUM (
  'VISIT_ASSIGN',
  'VISIT_CHANGE',
  'VISIT_CALLED_OFF',
  'VISIT_REMOVED',
  'VISIT_START_REMINDER',
  'VISIT_LATE',
  'AREA_PAUSED',
  'AREA_RESUMED',
  'MANUAL_AUTHORISED',
  'MANUAL_REJECTED',
  'VISIT_COMPLETE'
);

CREATE TABLE "scheduling"."CarerVisitPushReceipt" (
  "id" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "scheduledJobId" UUID NOT NULL,
  "kind" "scheduling"."CarerVisitPushKind" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarerVisitPushReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CarerVisitPushReceipt_employeeId_scheduledJobId_kind_key"
  ON "scheduling"."CarerVisitPushReceipt"("employeeId", "scheduledJobId", "kind");
CREATE INDEX "CarerVisitPushReceipt_scheduledJobId_idx"
  ON "scheduling"."CarerVisitPushReceipt"("scheduledJobId");

ALTER TABLE "scheduling"."CarerVisitPushReceipt"
  ADD CONSTRAINT "CarerVisitPushReceipt_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduling"."CarerVisitPushReceipt"
  ADD CONSTRAINT "CarerVisitPushReceipt_scheduledJobId_fkey"
  FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
