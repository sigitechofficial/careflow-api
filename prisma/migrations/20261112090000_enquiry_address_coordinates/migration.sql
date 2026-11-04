-- Map position of the enquiry address (from Google Places), copied to the service user's address.
ALTER TABLE "service_users"."Enquiry" ADD COLUMN "latitude" DECIMAL(10,7),
  ADD COLUMN "longitude" DECIMAL(10,7);
