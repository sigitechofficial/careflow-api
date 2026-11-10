-- The medical alerts screens check service_users.medical_alerts.*, but no migration created those permissions,
-- so only a super admin could use them. Create them, and give each to every role that already has the matching
-- medical conditions permission (read with read, create with create, and so on). Additive only.

INSERT INTO "identity"."Permission" ("id", "key", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), k, true, NOW(), NOW()
FROM unnest(ARRAY[
  'service_users.medical_alerts.read',
  'service_users.medical_alerts.create',
  'service_users.medical_alerts.update',
  'service_users.medical_alerts.delete'
]::text[]) AS k
WHERE NOT EXISTS (SELECT 1 FROM "identity"."Permission" p WHERE p."key" = k);

INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), rp."roleId", alert."id", NOW()
FROM "identity"."RolePermission" rp
JOIN "identity"."Permission" cond ON cond."id" = rp."permissionId"
JOIN "identity"."Permission" alert
  ON alert."key" = replace(cond."key", 'service_users.medical_conditions.', 'service_users.medical_alerts.')
WHERE cond."key" LIKE 'service_users.medical_conditions.%'
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" x WHERE x."roleId" = rp."roleId" AND x."permissionId" = alert."id"
  );
