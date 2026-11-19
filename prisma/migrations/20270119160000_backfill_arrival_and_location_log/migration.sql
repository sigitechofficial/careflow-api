-- Arrival and location rows for the visit Log, for visits recorded before the Log showed them (see
-- src/employee-app/visit-safety-timeline.util.ts for the same rows written live). Each row is added only when
-- that visit does not have it yet. Safe to re-run. Times are stored as UTC; labels are UK clock time.

-- Every carer's clock-in answers saved on the visit (per carer, plus the older single-carer form).
CREATE TEMP TABLE _arrival ON COMMIT DROP AS
WITH blobs AS (
  SELECT j.id AS job_id, kv.key AS emp, kv.value AS b
  FROM scheduling."ScheduledJob" j
  CROSS JOIN LATERAL jsonb_each(
    CASE WHEN jsonb_typeof(j.metadata -> 'employeeApp' -> 'checkIns') = 'object'
         THEN j.metadata -> 'employeeApp' -> 'checkIns' ELSE '{}'::jsonb END) kv
  WHERE j."deletedAt" IS NULL AND jsonb_typeof(kv.value) = 'object'
  UNION ALL
  SELECT j.id, j.metadata -> 'employeeApp' -> 'checkIn' ->> 'employeeId', j.metadata -> 'employeeApp' -> 'checkIn'
  FROM scheduling."ScheduledJob" j
  WHERE j."deletedAt" IS NULL
    AND jsonb_typeof(j.metadata -> 'employeeApp' -> 'checkIn') = 'object'
    AND (j.metadata -> 'employeeApp' -> 'checkIn' ->> 'employeeId') IS NOT NULL
    AND NOT coalesce(j.metadata -> 'employeeApp' -> 'checkIns', '{}'::jsonb) ? (j.metadata -> 'employeeApp' -> 'checkIn' ->> 'employeeId')
)
SELECT b.job_id,
       b.emp,
       (SELECT v.id FROM scheduling."ScheduledVisit" v
         WHERE v."scheduledJobId" = b.job_id AND v."deletedAt" IS NULL
         ORDER BY v."scheduledStartDateTime" LIMIT 1) AS visit_id,
       ((b.b ->> 'checkedInAt')::timestamptz AT TIME ZONE 'UTC') AS at,
       w.label AS welfare_label,
       w.tone AS welfare_tone,
       b.b ->> 'personSeen' AS person_seen,
       (b.b ->> 'accessViaKeySafe') = 'true' AS key_safe,
       (b.b ->> 'requiresManagerReview') = 'true' AS review,
       (b.b ->> 'outsideGeofence') = 'true' AND upper(coalesce(b.b ->> 'method', 'GPS')) = 'GPS' AS outside,
       CASE WHEN (b.b ->> 'distanceMeters') ~ '^-?[0-9.]+$' THEN round((b.b ->> 'distanceMeters')::numeric)::int END AS metres,
       nullif(btrim(coalesce(b.b ->> 'outsideGeofenceReason', '')), '') AS outside_reason
FROM blobs b
LEFT JOIN scheduling."VisitWelfareOutcomeCatalog" w
  ON w.id::text = (b.b ->> 'welfareOutcomeId') OR w.code = (b.b ->> 'welfareOutcomeId')
WHERE b.emp ~ '^[0-9a-fA-F-]{36}$'
  AND (b.b ->> 'checkedInAt') ~ '^\d{4}-\d{2}-\d{2}T';

-- 1. How the person was found on arrival.
INSERT INTO scheduling."VisitTimelineEvent"
  (id, "scheduledJobId", "scheduledVisitId", "eventType", "occurredAt", "timeLabel", title, detail, tone,
   "sourceType", "sourceId", "isDraft", "createdByEmployeeId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), a.job_id, a.visit_id, 'clock_in', a.at,
       to_char((a.at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'HH24:MI'),
       CASE WHEN a.welfare_label IS NOT NULL THEN 'On arrival: ' || a.welfare_label ELSE 'On arrival' END,
       nullif(concat_ws(E'\n',
         CASE a.person_seen WHEN 'true' THEN 'Person seen: yes' WHEN 'false' THEN 'Person seen: no' END,
         CASE WHEN a.key_safe THEN 'Got in using the key safe' END,
         CASE WHEN a.review THEN 'Needs a manager to review this visit' END), ''),
       CASE WHEN a.welfare_tone = 'bad' THEN 'danger'
            WHEN a.welfare_tone = 'warn' OR a.review OR a.person_seen = 'false' THEN 'warning'
            ELSE 'success' END,
       'check_in', 'arrival:' || a.emp, false, a.emp::uuid, now(), now()
FROM _arrival a
WHERE (a.welfare_label IS NOT NULL OR a.person_seen IN ('true', 'false') OR a.key_safe OR a.review)
  AND NOT EXISTS (SELECT 1 FROM scheduling."VisitTimelineEvent" e
                  WHERE e."scheduledJobId" = a.job_id AND e."sourceId" = 'arrival:' || a.emp);

-- 2. Clocked in outside the visit area (GPS clock-ins only).
INSERT INTO scheduling."VisitTimelineEvent"
  (id, "scheduledJobId", "scheduledVisitId", "eventType", "occurredAt", "timeLabel", title, detail, tone,
   "sourceType", "sourceId", "isDraft", "createdByEmployeeId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), a.job_id, a.visit_id, 'presence', a.at,
       to_char((a.at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'HH24:MI'),
       CASE WHEN a.metres IS NOT NULL THEN 'Clocked in ' || a.metres || ' m outside the visit area'
            ELSE 'Clocked in outside the visit area' END,
       CASE WHEN a.outside_reason IS NOT NULL THEN 'Reason: ' || a.outside_reason ELSE 'No reason given.' END,
       'warning', 'presence', 'outside_area:' || a.emp, false, a.emp::uuid, now(), now()
FROM _arrival a
WHERE a.outside AND (a.metres IS NOT NULL OR a.outside_reason IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM scheduling."VisitTimelineEvent" e
                  WHERE e."scheduledJobId" = a.job_id AND e."sourceId" = 'outside_area:' || a.emp);

-- 3. A fake (mock) phone location at clock-in or clock-out (from the attendance record).
INSERT INTO scheduling."VisitTimelineEvent"
  (id, "scheduledJobId", "scheduledVisitId", "eventType", "occurredAt", "timeLabel", title, detail, tone,
   "sourceType", "sourceId", "isDraft", "createdByEmployeeId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), m."scheduledJobId", m."scheduledVisitId", 'presence', m."occurredAt",
       to_char((m."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'HH24:MI'),
       CASE WHEN m."eventType" = 'CHECK_IN' THEN 'Mock location at clock-in' ELSE 'Mock location at clock-out' END,
       'The phone reported a fake (mock) location, so this visit''s location can''t be trusted.',
       'danger', 'presence',
       'mock_location:' || CASE WHEN m."eventType" = 'CHECK_IN' THEN 'in:' ELSE 'out:' END || m."employeeId"::text,
       false, m."employeeId", now(), now()
FROM (
  SELECT DISTINCT ON ("scheduledJobId", "employeeId", "eventType") *
  FROM scheduling."VisitAttendanceEvent"
  WHERE "isMockLocation" AND "eventType" IN ('CHECK_IN', 'CHECK_OUT')
  ORDER BY "scheduledJobId", "employeeId", "eventType", "occurredAt"
) m
WHERE EXISTS (SELECT 1 FROM scheduling."ScheduledJob" j WHERE j.id = m."scheduledJobId")
  AND NOT EXISTS (SELECT 1 FROM scheduling."VisitTimelineEvent" e
                  WHERE e."scheduledJobId" = m."scheduledJobId"
                    AND e."sourceId" = 'mock_location:' || CASE WHEN m."eventType" = 'CHECK_IN' THEN 'in:' ELSE 'out:' END || m."employeeId"::text);

-- 4. Left the area mid-visit: the lock, and the office allowing the visit to continue.
INSERT INTO scheduling."VisitTimelineEvent"
  (id, "scheduledJobId", "scheduledVisitId", "eventType", "occurredAt", "timeLabel", title, detail, tone,
   "sourceType", "sourceId", "isDraft", "createdByEmployeeId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), l."scheduledJobId",
       (SELECT v.id FROM scheduling."ScheduledVisit" v WHERE v."scheduledJobId" = l."scheduledJobId" AND v."deletedAt" IS NULL ORDER BY v."scheduledStartDateTime" LIMIT 1),
       'presence', l."lockedAt", to_char((l."lockedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'HH24:MI'),
       'Left the visit area: Care app locked',
       coalesce(l."distanceMeters" || ' m from the home. ', '') || 'The carer could not record care until the office allowed the visit to continue.',
       'danger', 'presence', 'area_lock:' || l.id::text, false, l."employeeId", now(), now()
FROM scheduling."VisitAreaLock" l
WHERE NOT EXISTS (SELECT 1 FROM scheduling."VisitTimelineEvent" e
                  WHERE e."scheduledJobId" = l."scheduledJobId" AND e."sourceId" = 'area_lock:' || l.id::text);

INSERT INTO scheduling."VisitTimelineEvent"
  (id, "scheduledJobId", "scheduledVisitId", "eventType", "occurredAt", "timeLabel", title, detail, tone,
   "sourceType", "sourceId", "isDraft", "createdByEmployeeId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), l."scheduledJobId",
       (SELECT v.id FROM scheduling."ScheduledVisit" v WHERE v."scheduledJobId" = l."scheduledJobId" AND v."deletedAt" IS NULL ORDER BY v."scheduledStartDateTime" LIMIT 1),
       'presence', l."allowedAt", to_char((l."allowedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'HH24:MI'),
       CASE WHEN nullif(btrim(coalesce(l."allowedByName", '')), '') IS NOT NULL
            THEN 'Allowed to continue by ' || btrim(l."allowedByName") ELSE 'Allowed to continue by the office' END,
       nullif(btrim(coalesce(l."allowNote", '')), ''),
       'success', 'presence', 'area_allow:' || l.id::text, false, l."employeeId", now(), now()
FROM scheduling."VisitAreaLock" l
WHERE l.status = 'ALLOWED' AND l."allowedAt" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM scheduling."VisitTimelineEvent" e
                  WHERE e."scheduledJobId" = l."scheduledJobId" AND e."sourceId" = 'area_allow:' || l.id::text);
