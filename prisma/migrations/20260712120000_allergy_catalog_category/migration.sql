-- CreateEnum
CREATE TYPE "service_users"."AllergyCatalogCategory" AS ENUM ('FOOD', 'DRINK', 'ENVIRONMENTAL', 'MEDICATION', 'OTHER');

-- AlterTable
ALTER TABLE "service_users"."AllergyCatalog" ADD COLUMN "category" "service_users"."AllergyCatalogCategory" NOT NULL DEFAULT 'OTHER';

-- CreateIndex
CREATE INDEX "AllergyCatalog_category_idx" ON "service_users"."AllergyCatalog"("category");
