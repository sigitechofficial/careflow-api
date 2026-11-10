-- Consents given, changed or withdrawn after the initial assessment: one row per change (the history).

CREATE TABLE "service_users"."ServiceUserConsentChange" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "topic" VARCHAR(40) NOT NULL,
    "title" VARCHAR(255) NOT NULL DEFAULT '',
    "answer" VARCHAR(20) NOT NULL,
    "method" VARCHAR(20) NOT NULL DEFAULT '',
    "givenBy" VARCHAR(255) NOT NULL DEFAULT '',
    "details" TEXT NOT NULL DEFAULT '',
    "decidedOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "ServiceUserConsentChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceUserConsentChange_serviceUserId_topic_idx" ON "service_users"."ServiceUserConsentChange"("serviceUserId", "topic");

ALTER TABLE "service_users"."ServiceUserConsentChange" ADD CONSTRAINT "ServiceUserConsentChange_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
