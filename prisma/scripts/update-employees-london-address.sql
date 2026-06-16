UPDATE "employees"."EmployeePersonalDetail"
SET
  "addressLine1" = '10 Downing Street',
  "addressLine2" = NULL,
  "town" = 'London',
  "county" = 'Greater London',
  "country" = 'United Kingdom',
  "postcode" = 'SW1A 2AA',
  "latitude" = 51.5034000,
  "longitude" = -0.1276000,
  "updatedAt" = NOW()
WHERE "deletedAt" IS NULL;
