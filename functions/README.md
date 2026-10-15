# Careflow scheduled-job triggers (Azure Functions)

Seven thin **timer-triggered** functions. Each one just asks the Careflow API to run a job:

```
POST ${JOBS_API_BASE_URL}/internal/jobs/<name>
x-jobs-trigger-secret: ${JOBS_TRIGGER_SECRET}
```

All job logic, exactly-once protection (the `platform.JobRun` table) and run history live in the API.
This package is a separate deployable (own `package.json`/lockfile). It is excluded from the API
Docker build (`.dockerignore`) and the API TypeScript build (`tsconfig*.json`).

| Function (= job name) | NCRONTAB (UTC) | When |
|---|---|---|
| `survey-distribution` | `0 * * * * *` | every minute |
| `visit-start-reminder` | `0 */2 * * * *` | every 2 minutes |
| `late-visit-alert` | `0 */5 * * * *` | every 5 minutes |
| `ecm-missed-visit` | `0 */5 * * * *` | every 5 minutes |
| `ecm-missing-checkout` | `0 */15 * * * *` | every 15 minutes |
| `platform-costs-sync` | `0 5 * * * *` | hourly at :05 |
| `employee-payout-auto` | `0 0 * * * *` | hourly at :00 |

All use `runOnStartup: false` and `useMonitor: true`. The 4 daily jobs (rolling rota, plan end,
learning maintenance, care-plan review reminders) are **not** here. They run as Container Apps Jobs
(see `deploy/azure/scheduled-jobs/`).

## How a trigger behaves (`src/trigger.ts`)

- 200 s timeout per attempt. A timeout is **not** retried, because the API may still be running the job.
- One retry after 5 s on a network error or HTTP 5xx, but only if it still fits in the 5-minute
  `functionTimeout`.
- 401/403 (wrong secret), 404/503 (endpoint disabled because the API has no `JOBS_TRIGGER_SECRET`)
  and other 4xx fail at once.
- `outcome: "already-ran"` counts as success, because another trigger already ran this period.
  The one exception: our own retry finds the run our first attempt started, and that run failed.
- `outcome: "failed"` (the job threw inside the API) makes the invocation fail.
- Each invocation logs one line. A failure also throws, so Application Insights records it as failed:
  ```
  [jobs] job=late-visit-alert outcome=ran status=success runId=… durationMs=812 elapsedMs=901 attempts=1
  [jobs] job=late-visit-alert outcome=failed status=- runId=- durationMs=- elapsedMs=200004 attempts=1 error=timed out after 200000 ms …
  ```
  The secret is never logged.

## App settings

| Setting | Value |
|---|---|
| `JOBS_API_BASE_URL` | `https://allforcare-api.livelypond-835cab73.uksouth.azurecontainerapps.io` (prod) |
| `JOBS_TRIGGER_SECRET` | `@Microsoft.KeyVault(SecretUri=https://kv-careflow-prod.vault.azure.net/secrets/jobs-trigger-secret/)` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | from `appi-careflow-prod` |
| `AzureWebJobs.<name>.Disabled` | `true` pauses one function without a redeploy (e.g. `AzureWebJobs.platform-costs-sync.Disabled`) |

The production values are set by `deploy/azure/scheduled-jobs/03-function-app.sh`.

## Develop and test

```bash
cd functions
npm ci
npm test        # tsc build + node:test unit tests (fake fetch + a real local HTTP server)
npm run build   # output in dist/ (entry point: dist/src/functions/*.js)
```

## Run locally against a local API

You need [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
(`func`) and a storage emulator for the timer-trigger locks
([Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite)).

1. Start the API on port 3993. Put these in the API's `.env`:
   ```
   PORT=3993
   CRON_MODE=external                 # the API's own @Cron handlers stand down
   JOBS_TRIGGER_SECRET=<any long random string, e.g. `openssl rand -base64 48`>
   ```
2. Start the storage emulator in another terminal: `npx azurite --silent --location /tmp/azurite`.
3. Configure the functions:
   ```bash
   cd functions
   cp local.settings.example.json local.settings.json   # git-ignored
   # set JOBS_TRIGGER_SECRET in local.settings.json to the same value as the API's .env
   ```
4. Run `npm start`. This builds the package and runs `func start`. Each timer fires on its schedule. You
   can also fire one at once with the admin endpoint of the Functions host:
   ```bash
   curl -X POST http://localhost:7071/admin/functions/survey-distribution \
        -H 'content-type: application/json' -d '{}'
   ```
5. Check the run in the API: on the admin **System jobs** screen, or in `platform."JobRun"`. Use
   `source=function` for these runs.

To try one call without Core Tools:

```bash
curl -sS -X POST http://localhost:3993/internal/jobs/survey-distribution \
     -H "x-jobs-trigger-secret: $JOBS_TRIGGER_SECRET"
```

## Deploy

`.github/workflows/deploy-azure-functions.yml` runs on every push to `azure` that touches `functions/**`,
or when started manually. It tests and builds the package, deploys it to the Flex Consumption app
`func-careflow-jobs-prod` (`Azure/functions-action` with OIDC), and checks that all 7 functions are
registered.
