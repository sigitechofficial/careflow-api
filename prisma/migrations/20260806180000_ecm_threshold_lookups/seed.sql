INSERT INTO lookups."EcmThresholdLookup" (id, code, label, description, "groupCode", "relatedTile", "valueInt", unit, "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
(gen_random_uuid(), 'dueNowWindowMinutes', 'Due now window', 'Not checked in, planned start within ± this many minutes of now (and not missed) → Due now tile.', 'DASHBOARD', 'dueNow', 15, 'minutes', 10, true, NOW(), NOW()),
(gen_random_uuid(), 'startingSoonMinutes', 'Starting soon window', 'Not checked in, planned start in the future within this many minutes → Starting soon tile.', 'DASHBOARD', 'startingSoon', 30, 'minutes', 20, true, NOW(), NOW()),
(gen_random_uuid(), 'lateArrivalToleranceMinutes', 'Late arrival tolerance', 'Check-in later than this after planned start → Late tile / LATE_ARRIVAL.', 'ARRIVAL', 'lateArrival', 15, 'minutes', 30, true, NOW(), NOW()),
(gen_random_uuid(), 'veryLateThresholdMinutes', 'Very late threshold', 'Check-in later than this after planned start → Very late tile / VERY_LATE_ARRIVAL.', 'ARRIVAL', 'veryLateArrival', 30, 'minutes', 40, true, NOW(), NOW()),
(gen_random_uuid(), 'earlyArrivalToleranceMinutes', 'Early arrival tolerance', 'Check-in earlier than this before planned start is classified as early arrival.', 'ARRIVAL', NULL, 10, 'minutes', 50, true, NOW(), NOW()),
(gen_random_uuid(), 'missedVisitThresholdMinutes', 'Potential missed threshold', 'No check-in and planned start this many minutes ago → Potential missed tile.', 'MISSED', 'potentialMissed', 60, 'minutes', 60, true, NOW(), NOW()),
(gen_random_uuid(), 'shortVisitToleranceMinutes', 'Short visit tolerance', 'Actual duration shorter than planned by more than this → short visit.', 'DURATION', NULL, 5, 'minutes', 70, true, NOW(), NOW()),
(gen_random_uuid(), 'shortVisitTolerancePercent', 'Short visit tolerance (%)', 'Also treat as short if under this percent of planned duration.', 'DURATION', NULL, 10, 'percent', 80, true, NOW(), NOW()),
(gen_random_uuid(), 'longVisitToleranceMinutes', 'Long visit tolerance', 'Actual duration longer than planned by more than this → long visit.', 'DURATION', NULL, 15, 'minutes', 90, true, NOW(), NOW()),
(gen_random_uuid(), 'excessiveOverrunMinutes', 'Excessive overrun', 'Actual duration overrun beyond this → excessive overrun.', 'DURATION', NULL, 45, 'minutes', 100, true, NOW(), NOW()),
(gen_random_uuid(), 'geofenceRadiusMeters', 'Geofence radius', 'Check-in outside this radius → Outside geofence tile.', 'GEOFENCE', 'outsideGeofence', 100, 'meters', 110, true, NOW(), NOW())
ON CONFLICT (code) DO NOTHING;
