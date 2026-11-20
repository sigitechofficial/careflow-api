-- Clock-in and clock-out times that never reached the visit Log: times the office entered (completing a visit
-- or a manual attendance entry), and older carer-app clock-ins/outs saved before the Log existed. Each visit gets
-- the row only when it has none of that kind already. Safe to re-run.

-- 1. Times the office entered: one row per carer and kind, the latest entry.
INSERT INTO scheduling."VisitTimelineEvent"
  (id, "scheduledJobId", "scheduledVisitId", "eventType", "occurredAt", "timeLabel", title, detail, tone,
   "sourceType", "sourceId", "isDraft", "createdByEmployeeId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), a."scheduledJobId", a."scheduledVisitId",
       CASE WHEN a."eventType" = 'CHECK_IN' THEN 'clock_in' ELSE 'clock_out' END,
       a."occurredAt", to_char((a."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'HH24:MI'),
       CASE WHEN a."eventType" = 'CHECK_IN' THEN 'Clocked in (entered by the office)' ELSE 'Clocked out (entered by the office)' END,
       CASE WHEN a.notes IS NULL OR a.notes LIKE 'MANUAL:ADMIN_COMPLETE%' THEN 'Recorded when the visit was completed.'
            ELSE 'Reason: ' || lower(replace(split_part(substring(a.notes FROM 'MANUAL:([^|]*)'), ' ', 1), '_', ' ')) || '.' END,
       CASE WHEN a."eventType" = 'CHECK_IN' THEN 'primary' ELSE 'success' END,
       CASE WHEN a."eventType" = 'CHECK_IN' THEN 'check_in' ELSE 'complete' END,
       CASE WHEN a."eventType" = 'CHECK_IN' THEN 'office_check_in:' ELSE 'office_check_out:' END || a."employeeId"::text,
       false, a."employeeId", now(), now()
FROM (
  SELECT DISTINCT ON ("scheduledJobId", "employeeId", "eventType") *
  FROM scheduling."VisitAttendanceEvent"
  WHERE "verificationMethod" = 'MANUAL_OFFICE' AND "eventType" IN ('CHECK_IN', 'CHECK_OUT')
  ORDER BY "scheduledJobId", "employeeId", "eventType", "createdAt" DESC
) a
WHERE EXISTS (SELECT 1 FROM scheduling."ScheduledJob" j WHERE j.id = a."scheduledJobId")
  AND NOT EXISTS (
    SELECT 1 FROM scheduling."VisitTimelineEvent" e
    WHERE e."scheduledJobId" = a."scheduledJobId"
      AND e."sourceId" = CASE WHEN a."eventType" = 'CHECK_IN' THEN 'office_check_in:' ELSE 'office_check_out:' END || a."employeeId"::text);

-- 2. Carer-app clock-ins with no clock-in row for that carer.
INSERT INTO scheduling."VisitTimelineEvent"
  (id, "scheduledJobId", "scheduledVisitId", "eventType", "occurredAt", "timeLabel", title, detail, tone,
   "sourceType", "sourceId", "isDraft", "createdByEmployeeId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), a."scheduledJobId", a."scheduledVisitId", 'clock_in',
       a."occurredAt", to_char((a."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'HH24:MI'),
       'Clocked in', 'Clocked in on the Care app.', 'primary', 'check_in', 'check_in:' || a."employeeId"::text,
       false, a."employeeId", now(), now()
FROM (
  SELECT DISTINCT ON ("scheduledJobId", "employeeId") *
  FROM scheduling."VisitAttendanceEvent"
  WHERE "verificationMethod" <> 'MANUAL_OFFICE' AND "eventType" = 'CHECK_IN'
  ORDER BY "scheduledJobId", "employeeId", "occurredAt" ASC
) a
WHERE EXISTS (SELECT 1 FROM scheduling."ScheduledJob" j WHERE j.id = a."scheduledJobId")
  AND NOT EXISTS (
    SELECT 1 FROM scheduling."VisitTimelineEvent" e
    WHERE e."scheduledJobId" = a."scheduledJobId" AND e."eventType" = 'clock_in'
      AND e."sourceId" IN ('check_in:' || a."employeeId"::text, 'check_in'));

-- 3. Carer-app clock-outs on visits whose Log has no app clock-out at all (the latest one).
INSERT INTO scheduling."VisitTimelineEvent"
  (id, "scheduledJobId", "scheduledVisitId", "eventType", "occurredAt", "timeLabel", title, detail, tone,
   "sourceType", "sourceId", "isDraft", "createdByEmployeeId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), a."scheduledJobId", a."scheduledVisitId", 'clock_out',
       a."occurredAt", to_char((a."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'HH24:MI'),
       'Clocked out', 'Visit complete', 'success', 'complete', 'complete',
       false, a."employeeId", now(), now()
FROM (
  SELECT DISTINCT ON ("scheduledJobId") *
  FROM scheduling."VisitAttendanceEvent"
  WHERE "verificationMethod" <> 'MANUAL_OFFICE' AND "eventType" = 'CHECK_OUT'
  ORDER BY "scheduledJobId", "occurredAt" DESC
) a
WHERE EXISTS (SELECT 1 FROM scheduling."ScheduledJob" j WHERE j.id = a."scheduledJobId")
  AND NOT EXISTS (
    SELECT 1 FROM scheduling."VisitTimelineEvent" e
    WHERE e."scheduledJobId" = a."scheduledJobId" AND e."eventType" = 'clock_out'
      AND e."sourceId" NOT LIKE 'office%');

-- 4. Earlier one-off Log updates worked out the time label as if the stored time were already UK time, which is
--    an hour out for summer (BST) dates. Recalculate the label from the moment itself (stored as UTC) for those rows.
UPDATE scheduling."VisitTimelineEvent"
SET "timeLabel" = to_char(("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'HH24:MI')
WHERE ("sourceId" IN ('office_outcome', 'office_visit_note') OR "eventType" IN ('handover', 'clock_in', 'clock_out'))
  AND "timeLabel" IS DISTINCT FROM to_char(("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'HH24:MI');
