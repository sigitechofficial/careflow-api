-- One access-instructions field: Home & access (ServiceUserAddress."accessInstructions"), the one the carer app shows.
-- Copy the old DOM Care "Access Instruction" text into it: fill it when empty, add it on a new paragraph when the
-- address text does not already contain it. The DOM Care column is kept as it was (nothing is cleared or dropped).
-- Service users with no address row are left alone (the admin can add the address in Home & access).
UPDATE service_users."ServiceUserAddress" AS a
SET "accessInstructions" = CASE
      WHEN COALESCE(btrim(a."accessInstructions"), '') = '' THEN btrim(d."accessInstruction")
      ELSE a."accessInstructions" || E'\n\n' || btrim(d."accessInstruction")
    END,
    "updatedAt" = CURRENT_TIMESTAMP
FROM service_users."ServiceUserDomCare" AS d
WHERE d."serviceUserId" = a."serviceUserId"
  AND a."deletedAt" IS NULL
  AND btrim(d."accessInstruction") <> ''
  AND position(btrim(d."accessInstruction") IN COALESCE(a."accessInstructions", '')) = 0;
