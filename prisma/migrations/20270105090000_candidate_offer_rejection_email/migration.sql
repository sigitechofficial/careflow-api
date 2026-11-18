-- Offer and rejection emails to the candidate: when each was last emailed.
ALTER TABLE "employees"."Candidate" ADD COLUMN "offerEmailedAt" TIMESTAMP(3),
ADD COLUMN "rejectionEmailedAt" TIMESTAMP(3);
