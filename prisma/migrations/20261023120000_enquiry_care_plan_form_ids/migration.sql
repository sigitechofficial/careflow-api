-- Care plans an enquiry is likely to need (care_pathway."CarePathwayForm" ids, scalar links).
ALTER TABLE service_users."Enquiry" ADD COLUMN IF NOT EXISTS "carePlanFormIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
