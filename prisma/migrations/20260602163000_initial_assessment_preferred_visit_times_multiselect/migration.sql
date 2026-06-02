UPDATE "service_users"."InitialAssessmentQuestion" AS q
SET
  "questionType" = 'MULTI_SELECT',
  "options" = '{
    "options": [
      { "value": "early_morning", "label": "Early morning (06:00-09:00)" },
      { "value": "morning", "label": "Morning (09:00-12:00)" },
      { "value": "lunch_time", "label": "Lunch time (12:00-14:00)" },
      { "value": "afternoon", "label": "Afternoon (14:00-17:00)" },
      { "value": "early_evening", "label": "Early evening (17:00-20:00)" },
      { "value": "night", "label": "Night (20:00+)" },
      { "value": "flexible", "label": "Flexible" }
    ]
  }'::jsonb,
  "metadata" = COALESCE(q."metadata", '{}'::jsonb) || '{"fieldKey":"preferredVisitTimes"}'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "service_users"."InitialAssessmentSection" AS s
WHERE q."sectionId" = s."id"
  AND q."questionText" = 'Preferred visit times'
  AND s."sectionNumber" = 1
  AND q."deletedAt" IS NULL
  AND s."deletedAt" IS NULL;
