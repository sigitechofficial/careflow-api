-- Service user over care taken back the next week (docs/SU_OVER_CARE_ADJUST_PLAN.md).
CREATE TABLE "service_users"."ServiceUserOverCareAdjustment" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "overWeekStart" DATE NOT NULL,
    "adjustWeekStart" DATE NOT NULL,
    "weeklyMinutes" INTEGER NOT NULL,
    "careGivenMinutes" INTEGER NOT NULL,
    "excludedMinutes" INTEGER NOT NULL,
    "overMinutes" INTEGER NOT NULL,
    "cancelledMinutes" INTEGER NOT NULL,
    "takenBackMinutes" INTEGER NOT NULL,
    "notTakenBackMinutes" INTEGER NOT NULL,
    "cancelledJobIds" UUID[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceUserOverCareAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceUserOverCareAdjustment_serviceUserId_overWeekStart_key" ON "service_users"."ServiceUserOverCareAdjustment"("serviceUserId", "overWeekStart");
CREATE INDEX "ServiceUserOverCareAdjustment_adjustWeekStart_idx" ON "service_users"."ServiceUserOverCareAdjustment"("adjustWeekStart");

ALTER TABLE "service_users"."ServiceUserOverCareAdjustment" ADD CONSTRAINT "ServiceUserOverCareAdjustment_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
