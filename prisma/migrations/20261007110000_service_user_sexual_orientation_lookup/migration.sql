-- CreateTable
CREATE TABLE "service_users"."ServiceUserSexualOrientation" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUserSexualOrientation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserSexualOrientation_code_key" ON "service_users"."ServiceUserSexualOrientation"("code");


-- Default options.
INSERT INTO "service_users"."ServiceUserSexualOrientation" ("id", "name", "code", "isActive", "createdAt", "updatedAt") VALUES
    (gen_random_uuid(), 'Heterosexual', 'HETEROSEXUAL', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Female Homosexual', 'FEMALE_HOMOSEXUAL', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Male Homosexual', 'MALE_HOMOSEXUAL', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Bisexual', 'BISEXUAL', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Sexually attracted to neither gender', 'NEITHER', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Sexual orientation unknown', 'UNKNOWN', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Sexual orientation undecided', 'UNDECIDED', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Sexual orientation not given – person refused', 'NOT_GIVEN', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
