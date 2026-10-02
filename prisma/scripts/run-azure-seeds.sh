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
if [ "${SEED_SAMPLE_BILLING_CARDS:-}" = "true" ]; then
  echo "Refusing to run: SEED_SAMPLE_BILLING_CARDS=true is not allowed for Azure production seeding." >&2
  exit 1
fi
export SEED_SAMPLE_PEOPLE=false
export SEED_SAMPLE_BRANCHES=false
export SEED_SAMPLE_BILLING_CARDS=false
export SEED_DEMO_DATA=false

echo ">>> [azure-seed 1/4] prisma db seed (reference data + real branches; sample people/branches/rate cards disabled)"
npx prisma db seed

# Same as cPanel deploy: the seed's legacy IA catalogue import can re-activate retired questions.
# Template-only (default Enterprise IA template); answers on retired questions are carried over.
echo ">>> [azure-seed 2/4] IA template cleanup (after seed)"
npx ts-node --transpile-only prisma/scripts/ia-template-cleanup.ts

echo ">>> [azure-seed 3/4] immigration status catalog (employee visa types + hour caps)"
npx ts-node --transpile-only prisma/scripts/upgrade-employee-visa-catalog.ts

echo ">>> [azure-seed 4/4] UK payroll — PAYE tax code catalogue"
node prisma/scripts/seed-payroll-tax-codes.mjs

echo "Azure reference seeders completed successfully."
