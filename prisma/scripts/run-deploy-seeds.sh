#!/usr/bin/env bash
# Idempotent production seeders — invoked automatically after `prisma migrate deploy` on VPS deploy.
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

echo ">>> [deploy-seed 1/4] prisma db seed (prisma/seed.ts + prisma/seeds/*)"
npx prisma db seed

echo ">>> [deploy-seed 2/4] immigration status catalog (employee visa types + hour caps)"
npx ts-node --transpile-only prisma/scripts/upgrade-employee-visa-catalog.ts

echo ">>> [deploy-seed 3/4] task catalogue (tasks planner visit tasks)"
npx ts-node --transpile-only prisma/scripts/seed-task-catalogue.ts

echo ">>> [deploy-seed 4/4] UK payroll — READY profiles for employees not yet set up"
node prisma/scripts/setup-payroll-employees-ready.mjs

echo "Deploy seeders completed successfully."
