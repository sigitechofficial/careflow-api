-- Deletes all initial assessment data for service users.
-- Keeps templates, sections, questions, and care-plan recommendation rules.

DELETE FROM "service_users"."InitialAssessmentSubmission";
DELETE FROM "service_users"."ServiceUserInitialAssessment";
