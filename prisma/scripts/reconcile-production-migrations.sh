#!/usr/bin/env bash
# Fix P3009 failed migration + orphan 20260604120000 on the VPS before redeploying.
# Usage (on server, from live backend folder):
#   cd /home/sigisolutions/careflowbackend.sigisolutions.net
#   bash prisma/scripts/reconcile-production-migrations.sh

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if [ ! -f "$ROOT/.env" ]; then
  echo "Missing .env in $ROOT"
  exit 1
fi

set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set in .env"
  exit 1
fi

echo "Removing orphan migration record 20260604120000_medication_status_codes (not in repo)..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20260604120000_medication_status_codes';"

TABLE_EXISTS="$(psql "$DATABASE_URL" -tAc \
  "SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'service_users' AND table_name = 'MedicationStatusCode'
  );")"

echo "MedicationStatusCode table exists: $TABLE_EXISTS"

if [ "$TABLE_EXISTS" = "t" ]; then
  echo "Marking failed migration as applied: 20260528185000_medication_status_codes"
  npx prisma migrate resolve --applied 20260528185000_medication_status_codes
else
  echo "Marking failed migration as rolled back (will re-apply on deploy): 20260528185000_medication_status_codes"
  npx prisma migrate resolve --rolled-back 20260528185000_medication_status_codes
fi

echo "Applying pending migrations..."
npx prisma migrate deploy

echo "Migration status:"
npx prisma migrate status || true

echo "Done. Redeploy via GitHub Actions or reload PM2 if code is already synced."
