-- Service user communication notes (office comms log).

CREATE TABLE "service_users"."ServiceUserCommunicationNote" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "signature" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "shareWith" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserCommunicationNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceUserCommunicationNote_serviceUserId_idx" ON "service_users"."ServiceUserCommunicationNote"("serviceUserId");
CREATE INDEX "ServiceUserCommunicationNote_recordedAt_idx" ON "service_users"."ServiceUserCommunicationNote"("recordedAt");
CREATE INDEX "ServiceUserCommunicationNote_deletedAt_idx" ON "service_users"."ServiceUserCommunicationNote"("deletedAt");

ALTER TABLE "service_users"."ServiceUserCommunicationNote" ADD CONSTRAINT "ServiceUserCommunicationNote_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserCommunicationNote" ADD CONSTRAINT "ServiceUserCommunicationNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserCommunicationNote" ADD CONSTRAINT "ServiceUserCommunicationNote_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
