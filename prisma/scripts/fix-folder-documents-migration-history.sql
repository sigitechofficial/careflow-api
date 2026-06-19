-- Remove stale migration history for the renamed folder_documents migration.
-- Safe when 20260715120000_service_user_document_store is already applied.
DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260715120000_service_user_folder_documents';
