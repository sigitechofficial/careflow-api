-- Office staff need a role of their own (the list only had Carer and Senior Carer), and Mx is a standard UK title.
-- Only adds what is missing; nothing is renamed or removed.
INSERT INTO lookups."EmployeeRoleLookup" (id, name, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.name, true, now(), now()
FROM (VALUES ('Care Coordinator'), ('Field Supervisor'), ('Office Administrator'), ('Branch Manager'), ('Registered Manager')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM lookups."EmployeeRoleLookup" r WHERE lower(r.name) = lower(v.name));

INSERT INTO lookups."Title" (id, name, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Mx', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM lookups."Title" t WHERE lower(t.name) = 'mx');

INSERT INTO service_users."ServiceUserTitle" (id, name, code, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Mx', 'MX', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM service_users."ServiceUserTitle" t WHERE t.code = 'MX' OR lower(t.name) = 'mx');
