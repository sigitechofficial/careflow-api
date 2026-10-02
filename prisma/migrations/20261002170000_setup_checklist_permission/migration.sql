-- Permission: setup checklist is visible to Super Admin and Admin only.
INSERT INTO "identity"."Permission" ("id", "key", "description", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'setup_checklist.read', 'View the organisation setup checklist', true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "identity"."Permission" p WHERE p."key" = 'setup_checklist.read');

INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Super Admin', 'Admin')
  AND p."key" = 'setup_checklist.read'
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );
