-- Run against production DB when deploy fails with P3009 / drift on medication_status_codes.
-- Example:
--   psql "$DATABASE_URL" -f prisma/scripts/reconcile-failed-migrations.sql

-- 1) Remove orphan migration applied on server but removed from the repo
DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260604120000_medication_status_codes';

-- 2) Show failed / drift rows (inspect before resolving)
SELECT migration_name, finished_at, rolled_back_at, started_at, logs
FROM "_prisma_migrations"
WHERE migration_name LIKE '%medication_status%'
   OR finished_at IS NULL
   OR rolled_back_at IS NOT NULL
ORDER BY started_at DESC;
