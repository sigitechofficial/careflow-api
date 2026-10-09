-- CreateEnum
CREATE TYPE "lookups"."AllocationItemCategory" AS ENUM ('EQUIPMENT', 'PPE', 'UNIFORM', 'OTHER');

-- CreateEnum
CREATE TYPE "employees"."EmployeeAllocationStatus" AS ENUM ('ISSUED', 'RETURNED', 'LOST', 'DAMAGED');

-- CreateTable
CREATE TABLE "lookups"."AllocationItemType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "lookups"."AllocationItemCategory" NOT NULL DEFAULT 'EQUIPMENT',
    "returnable" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationItemType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."EmployeeAllocation" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "itemTypeId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "size" TEXT,
    "serialNumber" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "issuedById" UUID,
    "expectedReturnAt" TIMESTAMP(3),
    "status" "employees"."EmployeeAllocationStatus" NOT NULL DEFAULT 'ISSUED',
    "returnedAt" TIMESTAMP(3),
    "returnNotes" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "EmployeeAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AllocationItemType_name_key" ON "lookups"."AllocationItemType"("name");

-- CreateIndex
CREATE INDEX "AllocationItemType_isActive_idx" ON "lookups"."AllocationItemType"("isActive");

-- CreateIndex
CREATE INDEX "EmployeeAllocation_employeeId_idx" ON "employees"."EmployeeAllocation"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeAllocation_itemTypeId_idx" ON "employees"."EmployeeAllocation"("itemTypeId");

-- CreateIndex
CREATE INDEX "EmployeeAllocation_status_idx" ON "employees"."EmployeeAllocation"("status");

-- CreateIndex
CREATE INDEX "EmployeeAllocation_deletedAt_idx" ON "employees"."EmployeeAllocation"("deletedAt");

-- AddForeignKey
ALTER TABLE "employees"."EmployeeAllocation" ADD CONSTRAINT "EmployeeAllocation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeAllocation" ADD CONSTRAINT "EmployeeAllocation_itemTypeId_fkey" FOREIGN KEY ("itemTypeId") REFERENCES "lookups"."AllocationItemType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Default items (admins can edit in Settings → Allocation items)
INSERT INTO "lookups"."AllocationItemType" ("id", "name", "category", "returnable", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'Laptop', 'EQUIPMENT', true, 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Mobile phone', 'EQUIPMENT', true, 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Tablet', 'EQUIPMENT', true, 30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SIM card', 'EQUIPMENT', true, 40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Charger', 'EQUIPMENT', true, 50, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ID badge', 'EQUIPMENT', true, 60, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Disposable gloves', 'PPE', false, 110, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Aprons', 'PPE', false, 120, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Face masks', 'PPE', false, 130, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Hand sanitiser', 'PPE', false, 140, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Eye protection / visor', 'PPE', false, 150, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Shoe covers', 'PPE', false, 160, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Uniform tunic', 'UNIFORM', false, 210, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Uniform trousers', 'UNIFORM', false, 220, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Fleece / jacket', 'UNIFORM', false, 230, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Work shoes', 'UNIFORM', false, 240, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Torch', 'OTHER', false, 310, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
