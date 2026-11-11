-- Over care reviews (10 Nov 2026): over care is no longer taken back by itself. The weekly check
-- raises a review request, and a manager cancels visits or marks it "no action needed".
CREATE TYPE "service_users"."ServiceUserOverCareReviewStatus" AS ENUM ('PENDING', 'ACTION_TAKEN', 'NO_ACTION_NEEDED');

ALTER TABLE "service_users"."ServiceUserOverCareAdjustment"
    ADD COLUMN "status" "service_users"."ServiceUserOverCareReviewStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "raisedByUserId" UUID,
    ADD COLUMN "decidedByUserId" UUID,
    ADD COLUMN "decidedAt" TIMESTAMP(3),
    ADD COLUMN "decidedAutomatically" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "decisionNote" TEXT,
    ALTER COLUMN "adjustWeekStart" DROP NOT NULL;

-- Rows made before this were taken back by the nightly run itself: action taken, by the system.
UPDATE "service_users"."ServiceUserOverCareAdjustment"
SET "status" = 'ACTION_TAKEN', "decidedAt" = "createdAt", "decidedAutomatically" = true;

CREATE INDEX "ServiceUserOverCareAdjustment_status_idx" ON "service_users"."ServiceUserOverCareAdjustment"("status");
