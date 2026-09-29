#!/usr/bin/env bash
# Azure production seeders — REFERENCE DATA ONLY (roles, permissions, catalogues, forms).
# Invoked after `prisma migrate deploy`. Unlike run-deploy-seeds.sh (cPanel), this never
# creates or edits people: no Greenwich roster, no demo office logins, no payroll backfills
# (those write placeholder DOB/address/NINO data into real employee records).
#
# Required env: DATABASE_URL, NODE_ENV=production
# First run only: ADMIN_SEED_EMAIL + ADMIN_SEED_PASSWORD (creates the super admin once).
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

if [ "${SEED_SAMPLE_PEOPLE:-}" = "true" ]; then
  echo "Refusing to run: SEED_SAMPLE_PEOPLE=true is not allowed for Azure production seeding." >&2
  exit 1
fi
if [ "${SEED_SAMPLE_BRANCHES:-}" = "true" ]; then
  echo "Refusing to run: SEED_SAMPLE_BRANCHES=true is not allowed for Azure production seeding." >&2
  exit 1
fi
export SEED_SAMPLE_PEOPLE=false
export SEED_SAMPLE_BRANCHES=false
export SEED_DEMO_DATA=false

echo ">>> [azure-seed 1/3] prisma db seed (reference data + real branches; sample people/branches disabled)"
npx prisma db seed

echo ">>> [azure-seed 2/3] immigration status catalog (employee visa types + hour caps)"
npx ts-node --transpile-only prisma/scripts/upgrade-employee-visa-catalog.ts

echo ">>> [azure-seed 3/3] UK payroll — PAYE tax code catalogue"
node prisma/scripts/seed-payroll-tax-codes.mjs

echo "Azure reference seeders completed successfully."
