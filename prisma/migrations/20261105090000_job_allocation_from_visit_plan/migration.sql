-- Whether a carer was put on a visit by the visit plan (generate / plan sync) or by hand (rota,
-- Hours approvals, extra / special visits). The nightly plan sync only replaces plan ones.
-- Existing rows count as plan allocations, so the sync behaves as before for them.
ALTER TABLE "scheduling"."JobAllocation" ADD COLUMN "fromVisitPlan" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "scheduling"."JobAllocation" ALTER COLUMN "fromVisitPlan" SET DEFAULT false;

-- Taken off a visit by a person on the rota: the plan sync does not put the carer back on it.
ALTER TABLE "scheduling"."JobAllocation" ADD COLUMN "unallocatedByHand" BOOLEAN NOT NULL DEFAULT false;
