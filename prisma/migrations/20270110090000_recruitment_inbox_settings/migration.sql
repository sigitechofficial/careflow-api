-- Recruitment inbox settings: screening before Claude reads an email (one row; with no row the defaults apply).
CREATE TABLE "employees"."RecruitmentInboxSettings" (
    "id" UUID NOT NULL,
    "screening" JSONB,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentInboxSettings_pkey" PRIMARY KEY ("id")
);
