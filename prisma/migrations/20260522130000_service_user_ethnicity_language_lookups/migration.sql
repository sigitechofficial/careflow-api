-- CreateTable
CREATE TABLE "service_users"."ServiceUserEthnicity" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUserEthnicity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserLanguage" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUserLanguage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserEthnicity_code_key" ON "service_users"."ServiceUserEthnicity"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserLanguage_code_key" ON "service_users"."ServiceUserLanguage"("code");
