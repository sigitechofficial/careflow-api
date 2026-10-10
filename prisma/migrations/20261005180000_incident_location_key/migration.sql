-- "Where did it happen?" on the office raise form (optional dropdown + text for "Other").
-- specificArea stays the carer app's own wording.
ALTER TABLE "incidents"."Incident"
  ADD COLUMN "locationKey" VARCHAR(40),
  ADD COLUMN "locationDetail" VARCHAR(200);
