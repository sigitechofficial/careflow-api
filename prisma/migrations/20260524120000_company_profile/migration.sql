-- CreateTable
CREATE TABLE "identity"."CompanyProfile" (
    "id" UUID NOT NULL,
    "groupName" TEXT,
    "companyName" TEXT NOT NULL,
    "odsCsCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "displayLogoUrl" TEXT,
    "displayLogoFileName" TEXT,
    "companyLogoUrl" TEXT,
    "companyLogoFileName" TEXT,
    "companyWebsite" TEXT,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "companyNumber" TEXT,
    "vatNumber" TEXT,
    "bankName" TEXT,
    "bankSortCode" TEXT,
    "bankAccountNumber" TEXT,
    "numberOfCarers" INTEGER NOT NULL DEFAULT 0,
    "numberOfServiceUsers" INTEGER NOT NULL DEFAULT 0,
    "activeModules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "identity"."CompanyProfile" ADD CONSTRAINT "CompanyProfile_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
