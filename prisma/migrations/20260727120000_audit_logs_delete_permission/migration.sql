-- audit_logs.delete permission for clearing the admin audit log
INSERT INTO "identity"."Permission" ("id", "key", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'audit_logs.delete', true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "identity"."Permission" WHERE "key" = 'audit_logs.delete'
);

UPDATE "identity"."Permission"
SET "isActive" = true, "deletedAt" = NULL, "updatedAt" = NOW()
WHERE "key" = 'audit_logs.delete';

INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Super Admin', 'Admin')
  AND r."deletedAt" IS NULL
  AND p."key" = 'audit_logs.delete'
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );
