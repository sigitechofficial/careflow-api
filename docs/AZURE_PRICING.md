# Azure Pricing (platform costs)

Admin area **Azure Pricing** (`/azure-pricing`) backed by `src/platform-costs/`. It shows what the
Careflow Azure subscription actually costs and what it would cost under a different architecture.

## What it does

| Data | Source (read-only) | Refresh |
|---|---|---|
| Daily actual cost per resource group / service / resource / meter category (previous + current month) | Cost Management `query` (ActualCost, daily) | every 6 h |
| Month-end forecast | Cost Management `forecast`; linear projection from stored rows while Azure has too little history | after each cost sync |
| Budget (amount, thresholds, spend) | Consumption `budgets` (subscription scope, falls back to each RG) | after each cost sync |
| Cost anomalies | computed from stored daily totals | after each cost sync |
| List prices (GBP, UK South; Static Web Apps West Europe; Private Link Global) | public Azure Retail Prices API | daily |
| Advisor cost recommendations | Advisor `recommendations` (`Category eq 'Cost'`) | daily |
| Monthly report e-mail (HTML + CSV) | stored data | 1st of the month, 08:00 org timezone |

* Azure is **never called per page view**. Every endpoint answers from the `platform` schema.
* Strictly **read-only** towards Azure: GETs plus the read-only Cost Management POST query/forecast.
  Nothing in Azure is created, changed or deleted. Budget notification e-mail addresses are not stored.
* Cost Management throttling: `429` + `x-ms-ratelimit-microsoft.costmanagement-*-retry-after` is
  honoured (max 3 retries, 60 s per-attempt timeout).
* Every sync writes a row to `platform."AzureSyncRun"` (visible on the page). Failures are logged and
  recorded there; they never crash the API.
* Manual "Sync now" (`POST /platform-costs/sync`) is limited to once per 5 minutes, checked against
  persisted sync runs (survives restarts) → `429` otherwise.
* Anomaly rule: a day's cost > 7-day average × (1 + threshold %) **and** the increase ≥ the minimum
  daily increase (defaults 50 % and £1, editable). Needs ≥ 3 days of history. One anomaly per date;
  in-app notification + e-mail to every user holding `platform_costs.read` (and Super Admins).
* Unit economics: month cost ÷ active service users / active carers (employees) / completed visits;
  `null` when the divisor is 0.
* Estimator: baseline (current architecture) and what-if, priced from the stored retail prices. All
  assumptions (730 h month, Container Apps free grant, HA = 2× DB compute + storage, Log Analytics
  5 GB free, …) are returned in `assumptions[]`.

Permissions: `platform_costs.read` (view) and `platform_costs.manage` (settings, manual sync, CSV
export, report preview/test, acknowledge anomalies). Seeded with the other permission keys; only
**Super Admin** receives them (automatically). Grant them to other roles in Settings → Roles if needed.

Endpoints: see the contract (`/platform-costs/overview`, `breakdown`, `prices`, `estimate/baseline`,
`estimate`, `recommendations`, `unit-economics`, `anomalies`, `anomalies/:id/acknowledge`,
`settings`, `sync`, `sync-runs`, `export`, `reports/monthly/preview`, `reports/monthly/send-test`).

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `AZURE_COST_ENABLED` | `false` | Turns on the sync jobs and Azure calls. When `false` endpoints still answer from the DB with `enabled:false`. |
| `AZURE_COST_SUBSCRIPTION_ID` | – | Subscription GUID (required when enabled, unless `AZURE_COST_SCOPE` is set). |
| `AZURE_COST_SCOPE` | `/subscriptions/${AZURE_COST_SUBSCRIPTION_ID}` | Cost query/forecast scope. |
| `AZURE_COST_RESOURCE_GROUPS` | `rg-careflow-prod,rg-careflow-prod-cae-infra` | Resource groups to include (case-insensitive). |
| `AZURE_COST_REGION` | `uksouth` | Retail price region. |
| `AZURE_COST_CURRENCY` | `GBP` | Retail price currency. |
| `AZURE_CLIENT_ID` | (already set for ACS e-mail) | Client id of the user-assigned managed identity `id-careflow-api`; `DefaultAzureCredential` uses it on Azure. |

Locally `DefaultAzureCredential` falls back to the developer's `az login` (the `az` CLI must be on `PATH`).

## Azure access required in production (document only — not assigned by this change)

Assign to the API's user-assigned managed identity **`id-careflow-api`**:

| Role | Scope | Why |
|---|---|---|
| **Cost Management Reader** | subscription `0142b441-6200-4c01-924e-a1f2ffbcfa51` (or each of `rg-careflow-prod`, `rg-careflow-prod-cae-infra`) | Cost query, forecast, budgets |
| **Reader** | same scope | Advisor recommendations |

Subscription scope is recommended (budgets and Advisor are listed at subscription level). If you scope to
the resource groups instead, set `AZURE_COST_SCOPE=/subscriptions/<id>/resourceGroups/rg-careflow-prod`
(one RG per scope) — the cost query then covers only that RG.

Example (run by an Owner / User Access Administrator, **not** by the app):

```bash
PRINCIPAL_ID=$(az identity show -g rg-careflow-prod -n id-careflow-api --query principalId -o tsv)
az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
  --role "Cost Management Reader" --scope /subscriptions/0142b441-6200-4c01-924e-a1f2ffbcfa51
az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
  --role "Reader" --scope /subscriptions/0142b441-6200-4c01-924e-a1f2ffbcfa51
```

Then set `AZURE_COST_ENABLED=true` and `AZURE_COST_SUBSCRIPTION_ID=…` on the container app.

## Operational notes

* Cost data in Azure lags 8–24 h; the latest day is usually partial.
* Jobs run on an hourly tick (`:05`) and decide what is due from the last successful sync run, so a
  restart neither skips nor double-runs. Single replica today — with more than one replica add a
  Postgres advisory lock around the tick (`TODO(job-lock)` in `platform-costs-sync.service.ts`).
* The monthly report goes to `monthlyReportRecipients` (Reports & settings tab); nothing is sent when
  the list is empty or the report is disabled. "Send test" sends only to the requesting user.
* Data lives in the `platform` schema (`AzureCostDaily`, `AzureRetailPrice`, `AzureBudgetSnapshot`,
  `AzureForecastSnapshot`, `AzureAdvisorRecommendation`, `AzureCostAnomaly`, `AzureSyncRun`,
  `PlatformCostSettings`). Migration `20261001090000_platform_costs` is additive only.
