#!/usr/bin/env bash
# Idempotent production seeders — invoked automatically after `prisma migrate deploy` on VPS deploy.
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

echo ">>> [deploy-seed 1/3] prisma db seed (prisma/seed.ts + prisma/seeds/*)"
npx prisma db seed

echo ">>> [deploy-seed 2/3] immigration status catalog (employee visa types + hour caps)"
npx ts-node --transpile-only prisma/scripts/upgrade-employee-visa-catalog.ts

echo ">>> [deploy-seed 3/3] task catalogue (tasks planner visit tasks)"
npx ts-node --transpile-only prisma/scripts/seed-task-catalogue.ts

echo "Deploy seeders completed successfully."
