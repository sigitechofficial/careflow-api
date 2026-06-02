INSERT INTO "service_users"."ServiceUserStatus" ("id", "name", "code", "description", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'Pre-admission',
  'PRE_ADMISSION',
  'Pre-admission assessment or setup before service starts',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
