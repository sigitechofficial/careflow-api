-- A service user is active unless their status says care has ended (Discharged, Deceased, Inactive).
-- Deleted records keep isActive = false as before.
UPDATE service_users."ServiceUser" u
SET "isActive" = (s.code IS NULL OR s.code NOT IN ('DISCHARGED', 'DECEASED', 'INACTIVE'))
FROM (SELECT u2.id, st.code
      FROM service_users."ServiceUser" u2
      LEFT JOIN service_users."ServiceUserStatus" st ON st.id = u2."statusId") s
WHERE s.id = u.id
  AND u."deletedAt" IS NULL;
