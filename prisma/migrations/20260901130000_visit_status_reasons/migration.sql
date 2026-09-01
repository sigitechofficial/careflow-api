-- Visit status reasons for office Record visit (Settings lookups).

CREATE TABLE "lookups"."VisitStatusReason" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "VisitStatusReason_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitStatusReason_name_key" ON "lookups"."VisitStatusReason"("name");
