-- Visits completed from the office's visit window before the office outcome and notes were written to the
-- visit Log: add those Log rows now, so the Log matches the Overview. Only adds what is missing; safe to re-run.

-- What the office recorded (one row per visit).
INSERT INTO scheduling."VisitTimelineEvent"
  (id, "scheduledJobId", "scheduledVisitId", "eventType", "occurredAt", "timeLabel", title, detail, tone, "sourceType", "sourceId", "isDraft", "createdAt", "updatedAt")
SELECT gen_random_uuid(), j.id,
       (SELECT v.id FROM scheduling."ScheduledVisit" v WHERE v."scheduledJobId" = j.id AND v."deletedAt" IS NULL ORDER BY v."scheduledStartDateTime" LIMIT 1),
       'clock_out', j."updatedAt", to_char(j."updatedAt" AT TIME ZONE 'Europe/London', 'HH24:MI'),
       'Marked ' || CASE j.status WHEN 'COMPLETED' THEN 'completed' WHEN 'PARTIALLY_COMPLETED' THEN 'partly completed' WHEN 'MISSED' THEN 'missed' ELSE lower(j.status::text) END || ' by the office',
       'Recorded from the visit window.',
       CASE WHEN j.status = 'MISSED' THEN 'danger' ELSE 'success' END,
       'complete', 'office_outcome', false, now(), now()
FROM scheduling."ScheduledJob" j
WHERE j."deletedAt" IS NULL
  AND j.metadata ->> 'ecmCompletionSource' = 'office'
  AND j.status IN ('COMPLETED', 'PARTIALLY_COMPLETED', 'MISSED')
  AND NOT EXISTS (SELECT 1 FROM scheduling."VisitTimelineEvent" e
                  WHERE e."scheduledJobId" = j.id AND e."sourceType" = 'complete' AND e."sourceId" = 'office_outcome');

-- The notes the office typed when completing (stored on the visit record, not in the Log).
INSERT INTO scheduling."VisitTimelineEvent"
  (id, "scheduledJobId", "scheduledVisitId", "eventType", "occurredAt", "timeLabel", title, detail, tone, "sourceType", "sourceId", "isDraft", "createdAt", "updatedAt")
SELECT gen_random_uuid(), j.id,
       (SELECT v.id FROM scheduling."ScheduledVisit" v WHERE v."scheduledJobId" = j.id AND v."deletedAt" IS NULL ORDER BY v."scheduledStartDateTime" LIMIT 1),
       'visit_note', j."updatedAt", to_char(j."updatedAt" AT TIME ZONE 'Europe/London', 'HH24:MI'),
       'Visit note (office)', btrim(j.notes), 'ink', 'log_note', 'office_visit_note', false, now(), now()
FROM scheduling."ScheduledJob" j
WHERE j."deletedAt" IS NULL
  AND j.metadata ->> 'ecmCompletionSource' = 'office'
  AND j.notes IS NOT NULL AND btrim(j.notes) <> '' AND j.notes NOT LIKE 'MANUAL:%'
  AND NOT EXISTS (SELECT 1 FROM scheduling."VisitTimelineEvent" e
                  WHERE e."scheduledJobId" = j.id AND e."sourceType" = 'log_note' AND e."sourceId" = 'office_visit_note');
