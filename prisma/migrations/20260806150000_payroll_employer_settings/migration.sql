-- T01: Singleton HMRC employer PAYE identity for future FPS/EPS submissions.
CREATE TABLE "payroll"."PayrollEmployerSettings" (
    "id" UUID NOT NULL,
    "hmrcOfficeNumber" TEXT,
    "employerPayeReference" TEXT,
    "accountsOfficeReference" TEXT,
    "taxDistrict" TEXT,
    "employerTradingName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "PayrollEmployerSettings_pkey" PRIMARY KEY ("id")
);
