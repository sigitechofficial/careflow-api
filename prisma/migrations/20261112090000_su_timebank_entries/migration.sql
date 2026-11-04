-- Service user timebank: hours taken from / given back to the bank per visit (docs/SU_TIMEBANK_USE_PLAN.md).
CREATE TYPE "service_users"."ServiceUserTimebankEntryKind" AS ENUM ('RESERVED', 'RETURNED');

CREATE TABLE "service_users"."ServiceUserTimebankEntry" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "scheduledJobId" UUID,
    "weekStart" DATE NOT NULL,
    "kind" "service_users"."ServiceUserTimebankEntryKind" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceUserTimebankEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceUserTimebankEntry_serviceUserId_idx" ON "service_users"."ServiceUserTimebankEntry"("serviceUserId");
CREATE INDEX "ServiceUserTimebankEntry_scheduledJobId_idx" ON "service_users"."ServiceUserTimebankEntry"("scheduledJobId");
CREATE INDEX "ServiceUserTimebankEntry_weekStart_idx" ON "service_users"."ServiceUserTimebankEntry"("weekStart");

ALTER TABLE "service_users"."ServiceUserTimebankEntry" ADD CONSTRAINT "ServiceUserTimebankEntry_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserTimebankEntry" ADD CONSTRAINT "ServiceUserTimebankEntry_scheduledJobId_fkey" FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserTimebankEntry" ADD CONSTRAINT "ServiceUserTimebankEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
