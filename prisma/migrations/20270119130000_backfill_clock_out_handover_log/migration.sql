-- Handovers a carer typed on the clock-out screen were saved on the visit record only, so the visit
-- Log never showed them. Add a Handover row for those visits now. Skipped where the visit already has a
-- handover in the Log, or where the same words are already in the Log as a visit note. Safe to re-run.
INSERT INTO scheduling."VisitTimelineEvent"
  (id, "scheduledJobId", "scheduledVisitId", "eventType", "occurredAt", "timeLabel", title, detail, tone,
   "sourceType", "sourceId", "isDraft", "createdByEmployeeId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), j.id,
       (SELECT v.id FROM scheduling."ScheduledVisit" v
         WHERE v."scheduledJobId" = j.id AND v."deletedAt" IS NULL
         ORDER BY v."scheduledStartDateTime" LIMIT 1),
       'handover', t.at, to_char(t.at AT TIME ZONE 'Europe/London', 'HH24:MI'),
       'Handover', btrim(j.notes), 'ink', 'handover', 'handover', false,
       CASE WHEN (j.metadata #>> '{employeeApp,checkOut,employeeId}') ~ '^[0-9a-fA-F-]{36}$'
            THEN (j.metadata #>> '{employeeApp,checkOut,employeeId}')::uuid END,
       now(), now()
FROM scheduling."ScheduledJob" j
CROSS JOIN LATERAL (
  SELECT COALESCE(
           CASE WHEN (j.metadata #>> '{employeeApp,checkOut,completedAt}') ~ '^\d{4}-\d{2}-\d{2}T'
                THEN (j.metadata #>> '{employeeApp,checkOut,completedAt}')::timestamptz END,
           j."updatedAt") AS at
) t
WHERE j."deletedAt" IS NULL
  AND j.metadata ->> 'ecmCompletionSource' = 'mobile'
  AND j.status IN ('COMPLETED', 'PARTIALLY_COMPLETED', 'MISSED')
  AND j.notes IS NOT NULL AND btrim(j.notes) <> '' AND j.notes NOT LIKE 'MANUAL:%'
  AND NOT EXISTS (SELECT 1 FROM scheduling."VisitTimelineEvent" e
                  WHERE e."scheduledJobId" = j.id AND e."eventType" = 'handover')
  AND NOT EXISTS (SELECT 1 FROM scheduling."VisitTimelineEvent" e
                  WHERE e."scheduledJobId" = j.id AND e."eventType" = 'visit_note'
                    AND btrim(coalesce(e.detail, '')) = btrim(j.notes));
