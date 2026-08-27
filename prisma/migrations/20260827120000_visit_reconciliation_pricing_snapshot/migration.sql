-- Persist a frozen pricing breakdown snapshot for completed visits.
-- When a visit is priced at completion, the calculation breakdown is captured here
-- and replayed on the reconciliation detail view, so later pay/charge card rule
-- edits do not retro-change how an already-completed visit was priced.

-- AlterTable
ALTER TABLE "billing"."VisitReconciliation" ADD COLUMN "pricingSnapshot" JSONB;
ALTER TABLE "billing"."VisitReconciliation" ADD COLUMN "pricingSnapshotAt" TIMESTAMP(3);
