-- Funding contract billing fields (Step 1 — invoice split, PO, caps, billing contacts)
ALTER TABLE "service_users"."ServiceUserFunding"
  ADD COLUMN "splitPercent" DECIMAL(5, 2),
  ADD COLUMN "splitPriority" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "purchaseOrderNumber" TEXT,
  ADD COLUMN "purchaseOrderExpiresAt" DATE,
  ADD COLUMN "authorisedWeeklyHours" DOUBLE PRECISION,
  ADD COLUMN "billingContactName" TEXT,
  ADD COLUMN "billingContactEmail" TEXT,
  ADD COLUMN "billingContactPhone" TEXT,
  ADD COLUMN "invoiceGroupingRule" TEXT;

CREATE INDEX "ServiceUserFunding_serviceUserId_splitPriority_idx"
  ON "service_users"."ServiceUserFunding"("serviceUserId", "splitPriority");
