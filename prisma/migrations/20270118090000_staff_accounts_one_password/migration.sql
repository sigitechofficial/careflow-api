-- Staff accounts from the staff record, welcome emails and one password for both sign-ins.
--
-- 1. When the person chose their own password (null = invited, link not used yet). Accounts that already
--    exist are counted as set, so nobody is shown as "invited" after this runs.
ALTER TABLE "identity"."User" ADD COLUMN IF NOT EXISTS "passwordSetAt" TIMESTAMP(3);
ALTER TABLE "employees"."EmployeePortalAccount" ADD COLUMN IF NOT EXISTS "passwordSetAt" TIMESTAMP(3);
UPDATE "identity"."User" SET "passwordSetAt" = "createdAt" WHERE "passwordSetAt" IS NULL;
UPDATE "employees"."EmployeePortalAccount" SET "passwordSetAt" = "createdAt" WHERE "passwordSetAt" IS NULL;

-- 2. The same person's office login, for one password across the website and the Care app.
ALTER TABLE "employees"."EmployeePortalAccount" ADD COLUMN IF NOT EXISTS "userId" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeePortalAccount_userId_key" ON "employees"."EmployeePortalAccount"("userId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmployeePortalAccount_userId_fkey') THEN
    ALTER TABLE "employees"."EmployeePortalAccount"
      ADD CONSTRAINT "EmployeePortalAccount_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Link existing pairs that sign in with the same email (each email is unique in both tables). Passwords are not
-- touched: they come into step the next time either password is set.
UPDATE "employees"."EmployeePortalAccount" p
SET "userId" = u."id"
FROM "identity"."User" u
WHERE p."userId" IS NULL
  AND p."deletedAt" IS NULL
  AND u."deletedAt" IS NULL
  AND lower(u."email") = lower(p."email")
  AND NOT EXISTS (SELECT 1 FROM "employees"."EmployeePortalAccount" o WHERE o."userId" = u."id");

-- 3. Set-password links can be for an office login, a Care app account, or both (one link, one password).
ALTER TABLE "identity"."PasswordResetToken" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "identity"."PasswordResetToken" ADD COLUMN IF NOT EXISTS "employeePortalAccountId" UUID;
CREATE INDEX IF NOT EXISTS "PasswordResetToken_employeePortalAccountId_createdAt_idx"
  ON "identity"."PasswordResetToken"("employeePortalAccountId", "createdAt");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PasswordResetToken_employeePortalAccountId_fkey') THEN
    ALTER TABLE "identity"."PasswordResetToken"
      ADD CONSTRAINT "PasswordResetToken_employeePortalAccountId_fkey" FOREIGN KEY ("employeePortalAccountId")
      REFERENCES "employees"."EmployeePortalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PasswordResetToken_account_check') THEN
    ALTER TABLE "identity"."PasswordResetToken"
      ADD CONSTRAINT "PasswordResetToken_account_check" CHECK ("userId" IS NOT NULL OR "employeePortalAccountId" IS NOT NULL);
  END IF;
END $$;
