-- "Find anything": the text inside uploaded documents, so searching finds a document by what it says.
ALTER TABLE "service_users"."ServiceUserDocumentRecord" ADD COLUMN IF NOT EXISTS "searchText" TEXT;
ALTER TABLE "service_users"."ServiceUserDocumentRecord" ADD COLUMN IF NOT EXISTS "searchTextAt" TIMESTAMP(3);
ALTER TABLE "employees"."EmployeeDocument" ADD COLUMN IF NOT EXISTS "searchText" TEXT;
ALTER TABLE "employees"."EmployeeDocument" ADD COLUMN IF NOT EXISTS "searchTextAt" TIMESTAMP(3);
