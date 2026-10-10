-- CreateTable
CREATE TABLE "service_users"."ServiceUserSex" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUserSex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserSex_code_key" ON "service_users"."ServiceUserSex"("code");


-- Default options. INTERSEX / UNKNOWN keep the codes of the old hard-coded list so values
-- already saved as "Intersex" / "Unknown" still match an option.
INSERT INTO "service_users"."ServiceUserSex" ("id", "name", "code", "isActive", "createdAt", "updatedAt") VALUES
    (gen_random_uuid(), 'Male', 'MALE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Female', 'FEMALE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Indeterminate (unable to be classified as either male or female)', 'INTERSEX', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Not Known (not recorded)', 'UNKNOWN', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
