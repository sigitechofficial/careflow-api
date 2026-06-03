# Backend deploy failures (GitHub Actions → VPS)

If deploy exits with code 1 and rolls back **files**, the database is **not** restored automatically.

## Find the real error

SSH to the server and read:

```bash
tail -100 /home/sigisolutions/deployments/careflow-api/logs/last-migrate-deploy.log
tail -100 /home/sigisolutions/deployments/careflow-api/logs/last-seed.log
tail -50 /home/sigisolutions/deployments/careflow-api/logs/deployments.log
```

Or re-run the GitHub Actions job and expand the **Deploy backend release** step (with `set -x` tracing).

## Common causes

### 1. `prisma migrate deploy` failed (P3009)

**Typical log:**

```
Error: P3009 migrate found failed migrations
The `20260528185000_medication_status_codes` migration ... failed
```

Plus drift:

```
The migration from the database are not found locally:
20260604120000_medication_status_codes
```

**Fix on the VPS** (SSH, then):

```bash
cd /home/sigisolutions/careflowbackend.sigisolutions.net
bash prisma/scripts/reconcile-production-migrations.sh
```

Or manually:

```bash
# Remove orphan DB-only migration (deleted from git)
psql "$DATABASE_URL" -c "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20260604120000_medication_status_codes';"

# If MedicationStatusCode table already exists:
npx prisma migrate resolve --applied 20260528185000_medication_status_codes

# If table does NOT exist:
npx prisma migrate resolve --rolled-back 20260528185000_medication_status_codes

npx prisma migrate deploy
```

Then push latest backend (idempotent migration SQL) and re-run GitHub Actions deploy.

- **Failed migration** (other cases):

  ```bash
  cd /home/sigisolutions/careflowbackend.sigisolutions.net
  npx prisma migrate status
  ```

  If a migration is listed as failed, either fix the DB and mark applied:

  ```bash
  npx prisma migrate resolve --applied 20260603180000_initial_assessment_care_plan_rules
  ```

  or roll it back and redeploy:

  ```bash
  npx prisma migrate resolve --rolled-back 20260603180000_initial_assessment_care_plan_rules
  npx prisma migrate deploy
  ```

- **Restore DB** from the backup path printed in the deploy log, e.g.
  `deployments/careflow-api/db-backups/db-before-release-*.dump`

### 2. `prisma migrate status` (older workflow)

Newer deploy treats status as informational only. If you still use an old workflow, a non-zero status fails the job.

### 3. `prisma db seed` failed

Deploy now **continues** if seed fails (logged under `last-seed.log`). Fix seed locally, then on server:

```bash
cd /home/sigisolutions/careflowbackend.sigisolutions.net
npx prisma db seed
```

### 4. Smoke check failed (HTTP 5xx)

API returned 500+ after deploy. Check PM2:

```bash
pm2 logs main --lines 100
```

Often caused by app crash (missing env, DB connection, or schema mismatch). After file rollback, DB may still have new tables from a successful migrate — usually safe.

## Care plan recommendation rules migration

Migration: `20260603180000_initial_assessment_care_plan_rules`

Creates `InitialAssessmentCarePlanRecommendationRule` in schema `service_users`.

After a successful deploy, optional starter rules are seeded (non-fatal if seed fails).
