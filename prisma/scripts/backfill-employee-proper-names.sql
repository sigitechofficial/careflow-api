-- Assign realistic display names to E2E / placeholder employees.
-- Run: Get-Content prisma/scripts/backfill-employee-proper-names.sql | npx prisma db execute --stdin --schema prisma/schema.prisma

UPDATE employees."EmployeePersonalDetail" AS pd
SET
  "firstName" = mapping."firstName",
  "lastName" = mapping."lastName",
  "updatedAt" = NOW()
FROM (
  VALUES
    ('c121b37a-0314-42bb-83bf-4fef5b5c8f54'::uuid, 'Sarah', 'Mitchell'),
    ('f6336871-dc17-4f2a-bd90-74f3d504d32e'::uuid, 'James', 'Thornton'),
    ('06cae58e-79bf-4a46-87bf-4fcfcf1f2ef6'::uuid, 'Priya', 'Sharma'),
    ('9de5521d-893a-45a8-8f11-6b5a700a612a'::uuid, 'Michael', 'OBrien'),
    ('275b0a42-2a8a-4146-951d-1dd75eebff7e'::uuid, 'Emma', 'Richardson'),
    ('c7226e78-e11c-43df-8a47-3ecea2f26c1e'::uuid, 'David', 'Campbell'),
    ('99b4e29b-f267-45bf-840a-2c98dcd3c458'::uuid, 'Lisa', 'Henderson'),
    ('bca75f73-5702-443d-944d-8779ed05d681'::uuid, 'Ryan', 'Patel'),
    ('d9b025a1-6da4-45f1-8488-895d1d3e27c6'::uuid, 'Chloe', 'Williams'),
    ('7b6334da-d4ad-4765-9c5b-3834a64395a2'::uuid, 'Daniel', 'Brooks'),
    ('47fedc5e-4091-4500-bdc1-ed0d196eadf7'::uuid, 'Sophie', 'Clarke'),
    ('05f15b1f-ce2b-456a-a530-048f071f7cc0'::uuid, 'Thomas', 'Green'),
    ('498681dd-9940-4fc7-b4b8-ca864083da0a'::uuid, 'Amelia', 'Foster'),
    ('8c82b5a3-34d2-4940-88eb-244ac57bfb96'::uuid, 'Oliver', 'Hughes'),
    ('d1b9a5b9-26c3-4e51-af72-848a1c2bca4a'::uuid, 'Charlotte', 'Price'),
    ('d2868fad-7b1a-49e3-9f9d-123713ee1144'::uuid, 'Nathan', 'Cox')
) AS mapping("employeeId", "firstName", "lastName")
WHERE pd."employeeId" = mapping."employeeId"
  AND pd."deletedAt" IS NULL;
