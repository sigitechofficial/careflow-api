#!/usr/bin/env bash
# Idempotent production seeders — invoked automatically after `prisma migrate deploy` on VPS deploy.
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

echo ">>> [deploy-seed 1/9] prisma db seed (prisma/seed.ts + prisma/seeds/*)"
npx prisma db seed

echo ">>> [deploy-seed 1b/9] IA template cleanup (after seed — the legacy catalog import can re-activate retired questions)"
npx ts-node --transpile-only prisma/scripts/ia-template-cleanup.ts

echo ">>> [deploy-seed 2/9] immigration status catalog (employee visa types + hour caps)"
npx ts-node --transpile-only prisma/scripts/upgrade-employee-visa-catalog.ts

echo ">>> [deploy-seed 3/9] task catalogue (tasks planner visit tasks)"
npx ts-node --transpile-only prisma/scripts/seed-task-catalogue.ts

echo ">>> [deploy-seed 4/9] UK payroll — READY profiles for employees not yet set up"
node prisma/scripts/setup-payroll-employees-ready.mjs

echo ">>> [deploy-seed 5/9] UK payroll — FPS RTI identity backfill (DOB, address, NINO, hours band)"
node prisma/scripts/setup-payroll-fps-employee-data.mjs

echo ">>> [deploy-seed 6/9] UK payroll — PAYE tax code catalogue"
node prisma/scripts/seed-payroll-tax-codes.mjs

echo ">>> [deploy-seed 7/9] Greenwich council branch staff (idempotent)"
npx ts-node --transpile-only prisma/scripts/seed-greenwich-branch-users.ts

echo ">>> [deploy-seed 8/9] Greenwich council in-service service users (idempotent)"
npx ts-node --transpile-only prisma/scripts/seed-greenwich-service-users.ts

echo ">>> [deploy-seed 9/9] Greenwich manager attention (IAs, care plans, assessments, notifications)"
npx ts-node --transpile-only prisma/scripts/seed-greenwich-manager-attention.ts

echo "Deploy seeders completed successfully."
