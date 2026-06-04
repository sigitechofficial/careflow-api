SELECT
  (SELECT COUNT(*)::int FROM "service_users"."InitialAssessmentSubmission") AS submissions,
  (SELECT COUNT(*)::int FROM "service_users"."InitialAssessmentAnswer") AS answers,
  (SELECT COUNT(*)::int FROM "service_users"."InitialAssessmentAction") AS actions,
  (SELECT COUNT(*)::int FROM "service_users"."InitialAssessmentAttachment") AS attachments,
  (SELECT COUNT(*)::int FROM "service_users"."InitialAssessmentRiskRecord") AS risk_records,
  (SELECT COUNT(*)::int FROM "service_users"."ServiceUserInitialAssessment") AS checklist_profiles;
