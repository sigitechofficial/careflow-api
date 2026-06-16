SELECT
  su.id,
  su."firstName",
  su."lastName",
  a.id AS address_id,
  a.latitude,
  a.longitude
FROM "service_users"."ServiceUser" su
LEFT JOIN "service_users"."ServiceUserAddress" a
  ON a."serviceUserId" = su.id AND a."deletedAt" IS NULL
WHERE su."deletedAt" IS NULL
ORDER BY su."createdAt";
