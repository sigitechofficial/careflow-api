# Scheduled jobs on Azure: set-up runbook

This moves the API's 11 in-process `@Cron` jobs out of the always-on API container:

- **7 frequent jobs**: Azure Functions timer triggers in `func-careflow-jobs-prod` (Flex Consumption).
  Each calls `POST /internal/jobs/<name>` on the API. Code: `functions/`. Deploy:
  `.github/workflows/deploy-azure-functions.yml`.
- **4 daily jobs**: Container Apps Jobs that run the API image as a CLI
  (`node dist/src/jobs/run-job.js <name>`). They get the new image on every API deploy
  (`deploy-azure-api.yml`, last step).

All job logic and exactly-once protection stay in the API, in the `platform.JobRun` table with a unique
`(jobName, periodKey)`. So the old in-process cron and the new triggers can safely run side by side
during the switch.

| Container Apps Job | Job name | Cron (UTC) |
|---|---|---|
| `job-careflow-rolling-rota` | `rolling-rota` | `0 2 * * *` |
| `job-careflow-plan-end` | `visit-plan-scheduled-end` | `30 0 * * *` |
| `job-careflow-learning` | `learning-maintenance` | `30 2 * * *` |
| `job-careflow-care-plan-reviews` | `care-plan-review-reminders` | `0 6 * * *` |
| `job-careflow-over-care` | `over-care-review` | `45 2 * * *` |

Each job uses 0.5 vCPU / 1 GiB, parallelism 1, `replicaRetryLimit` 1 and `replicaTimeout` 1800 s. It uses
identity `id-careflow-api` and copies the env, Key Vault secrets and volumes of `allforcare-api`
(generated from the live config), with `CRON_MODE=external`.

## Order of operations

None of these scripts has been run. Every script is idempotent, so you can re-run it safely.

| # | Step | Who | Needs |
|---|---|---|---|
| 0 | Merge and deploy the API code (JobRunner, `/internal/jobs/:name`, `run-job.js`, `CRON_MODE`). Leave `CRON_MODE` unset, so it is `internal`. | pipeline | – |
| 1 | `01-create-jobs-secret.md`: create the Key Vault secret and add `JOBS_TRIGGER_SECRET` to the API | coordinator, **or a human** if the coordinator lacks the Key Vault data role | Key Vault Secrets Officer on `kv-careflow-prod`, Contributor on the RG |
| 2 | `DRY_RUN=1 ./02-container-apps-jobs.sh`, review `out/*.yaml`, then `./02-container-apps-jobs.sh` | coordinator | Contributor on the RG |
| 3 | `./03-function-app.sh` | coordinator | Contributor on the RG |
| 4 | `./04-role-assignments.sh` | **HUMAN** (RBAC) | Owner / User Access Administrator / RBAC Administrator on the RG |
| 5 | `az functionapp restart -g rg-careflow-prod -n func-careflow-jobs-prod`, then run the GitHub workflow **Deploy job triggers to Azure Functions** | coordinator | – |
| 6 | Verify (below) | coordinator | – |
| 7 | `./05-alerts.sh`. Use `SKIP_STALE=1` until rolling-rota and late-visit-alert have each succeeded once, then run it again without | coordinator | Monitoring Contributor or Contributor on the RG |
| 8 | Switch over: `az containerapp update -g rg-careflow-prod -n allforcare-api --set-env-vars CRON_MODE=external`. Then set the GitHub repo variable `SCHEDULED_JOBS_REQUIRED=true` | coordinator | – |

Between steps 2 and 8, every job may be triggered twice: by the API's own cron and by Azure. JobRun lets
only the first run go ahead; the second is logged `already-ran`. This relies on both sources computing
the same `periodKey`.

### Verify (step 6)

```bash
RG=rg-careflow-prod
az functionapp function list -g $RG -n func-careflow-jobs-prod --query "[].name" -o tsv     # 7 functions
az rest --method get --url "https://management.azure.com/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RG/providers/Microsoft.Web/sites/func-careflow-jobs-prod/config/configreferences/appsettings/JOBS_TRIGGER_SECRET?api-version=2024-11-01" --query properties.status -o tsv   # Resolved
```

Then open the admin **System jobs** screen. Function jobs should show runs with source `function`.
In Log Analytics:

```kusto
AppTraces | where AppRoleName =~ 'func-careflow-jobs-prod' and Message startswith '[jobs]' | take 50
```

Optional: start a daily job by hand. This runs the **real** job against production; it is idempotent per
UTC date:

```bash
az containerapp job start -g rg-careflow-prod -n job-careflow-plan-end
```

### Rollback

`az containerapp update -g rg-careflow-prod -n allforcare-api --set-env-vars CRON_MODE=internal`
brings the in-process crons back. The Azure triggers can stay on, because JobRun deduplicates. To pause
one function, set `AzureWebJobs.<name>.Disabled=true` on the Function App (no redeploy needed).

## Log contract for alerts (must match the API)

`05-alerts.sh` parses this line. The API logs it once per JobRunner run, at **log level LOG or higher,
including successes**, through Nest `Logger` with context `JobRunner`:

```
[JobRunner] job=<name> status=<success|failed|skipped|already-ran|stale> source=<internal|function|container-job|manual> runId=<uuid|-> durationMs=<n|-> periodKey=<key>[ error=<text>]
```

- It is emitted by `allforcare-api`, so `ContainerAppConsoleLogs_CL.ContainerAppName_s`, and by the jobs, so
  `ContainerJobName_s` starting with `job-careflow-`.
- ANSI colour codes are stripped before parsing, and keys are matched one by one, so their order does
  not matter.
- Tokens must not contain spaces: `job`, `status`, `source`, `runId` and `periodKey` are `\S+`. Only
  `error=` may contain spaces, and it must come last.
- `rolling-rota` "no active visit plans" must log `status=skipped` or `status=success`. Both count as healthy.
- The Function side logs `[jobs] job=<name> outcome=<ran|already-ran|failed|retrying> status=… runId=…
  durationMs=… elapsedMs=… attempts=…` to App Insights `AppTraces`. The alerts use `AppRequests.Success`
  instead of this line.

| Alert | Severity | Fires when |
|---|---|---|
| `alert-sched-container-job-failed` | 1 | `ContainerAppSystemLogs_CL` shows a failed container, `BackoffLimitExceeded`, `DeadlineExceeded` or an image/mount error for the 4 jobs (window 30 min, every 15 min, split by job) |
| `alert-sched-function-failed` | 2 | `AppRequests` for `func-careflow-jobs-prod` with `Success == false` (window 10 min, every 5 min, split by function) |
| `alert-sched-jobrun-failed` | 2 | a JobRunner line with `status=failed` or `stale` (window 30 min, every 15 min, split by job) |
| `alert-sched-rolling-rota-stale` | 1 | no `rolling-rota` success or skipped in 26 h (checked hourly) |
| `alert-sched-late-visit-alert-stale` | 1 | no `late-visit-alert` success or skipped in 30 min (checked every 10 min) |

A function job that fails raises both `function-failed` and `jobrun-failed`. That is deliberate: the
first means the trigger failed, the second that the job's logic failed.

## Notes

- **Node version.** Azure Functions support for Node 20 ended on 2026-04-30
  (`az functionapp list-flexconsumption-runtimes`), so the Function App runs **Node 22**. The code supports
  Node 20 and later. The API image is unaffected.
- **Identity-based host storage.** The Function App uses no storage keys: `AzureWebJobsStorage__*` and
  the deployment container both use `id-careflow-func`. It needs **Storage Blob Data Owner** on
  `stcareflowprod`. Timer triggers only use blobs (locks and schedule status), so no Queue or Table roles are needed.
  Until step 4 is done the host cannot start. That is expected.
- **Why ARM (`az rest`) in 03.** `az functionapp create --deployment-storage-auth-type UserAssignedIdentity`
  quietly tries to create a role assignment. Using ARM keeps all RBAC in 04.
- **Retries on the daily jobs.** `replicaRetryLimit 1`: if the first replica fails after JobRun recorded
  `failed`, the retry sees `already-ran` and exits 0. The execution then looks "Succeeded" in Azure even
  though the run failed. The `jobrun-failed` and `container-job-failed` (failed container) alerts still catch it.
- Never print the values of the API's Key Vault secrets. The scripts only handle names and Key Vault references.
