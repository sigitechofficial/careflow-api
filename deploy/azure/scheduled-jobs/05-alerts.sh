#!/usr/bin/env bash
# 05 – Log alerts for the scheduled jobs -> action group ag-careflow-prod.
#
#   alert-sched-container-job-failed   a scheduled Container Apps Job execution failed      (sev 1)
#   alert-sched-function-failed        a timer function invocation failed (App Insights)    (sev 2)
#   alert-sched-jobrun-failed          JobRunner logged status=failed|stale for any job     (sev 2)
#   alert-sched-rolling-rota-stale     no successful rolling-rota run in 26 h               (sev 1)
#   alert-sched-late-visit-alert-stale no successful late-visit-alert run in 30 min         (sev 1)
#
# All rules query the Log Analytics workspace log-careflow-prod. Container Apps console/system logs
# land there, and appi-careflow-prod is workspace-based, so AppRequests are there too.
#
# The JobRunner rules parse the line the API logs for every run (README "Log contract"):
#   [JobRunner] job=<name> status=<success|failed|skipped|already-ran|stale> source=<...> runId=<id|-> durationMs=<n> periodKey=<key>[ error=<text>]
# Nest colours its console output, so ANSI escape codes are stripped before parsing.
#
# Run by: the coordinator (Monitoring Contributor or Contributor on rg-careflow-prod). No RBAC changes.
# When: after the API emits the JobRunner line in production. Create the two "stale" rules only once
#       rolling-rota / late-visit-alert have had a successful run, or they fire straight away.
#       SKIP_STALE=1 skips those two.
# Idempotent: every rule is a PUT (create or replace) of the full definition.
set -euo pipefail

RG=rg-careflow-prod
LOCATION=uksouth
WORKSPACE=log-careflow-prod
ACTION_GROUP=ag-careflow-prod
API_APP=allforcare-api
FUNC_APP=func-careflow-jobs-prod
JOB_PREFIX=job-careflow-
SCHEDULED_JOBS="'job-careflow-rolling-rota','job-careflow-plan-end','job-careflow-learning','job-careflow-care-plan-reviews'"
ALERT_API=2021-08-01
SKIP_STALE="${SKIP_STALE:-0}"

SUB=$(az account show --query id -o tsv)
RG_ID="/subscriptions/$SUB/resourceGroups/$RG"
WS_ID=$(az monitor log-analytics workspace show -g "$RG" -n "$WORKSPACE" --query id -o tsv)
AG_ID=$(az monitor action-group show -g "$RG" -n "$ACTION_GROUP" --query id -o tsv)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# Parsed JobRunner lines from the API container app and the scheduled jobs.
JOB_LINES="ContainerAppConsoleLogs_CL
| where ContainerAppName_s == '$API_APP' or ContainerJobName_s startswith '$JOB_PREFIX'
| where Log_s has 'JobRunner'
| extend L = replace_regex(Log_s, @'\\x1b\\[[0-9;]*m', '')
| where L contains '[JobRunner]' and L contains 'job='
| extend job = extract(@'\\bjob=(\\S+)', 1, L), status = extract(@'\\bstatus=(\\S+)', 1, L),
         source = extract(@'\\bsource=(\\S+)', 1, L), runId = extract(@'\\brunId=(\\S+)', 1, L),
         periodKey = extract(@'\\bperiodKey=(\\S+)', 1, L), emitter = coalesce(ContainerJobName_s, ContainerAppName_s)"

# rule <name> <severity> <frequency> <window> <override-range|""> <description> <dimension|""> <query>
# Fires when the query returns more than 0 rows (per dimension value if a dimension is given).
rule() {
  local name=$1 sev=$2 freq=$3 window=$4 override=$5 desc=$6 dim=$7 query=$8
  jq -n --arg loc "$LOCATION" --arg ws "$WS_ID" --arg ag "$AG_ID" --arg desc "$desc" --arg q "$query" \
        --argjson sev "$sev" --arg freq "$freq" --arg win "$window" --arg ovr "$override" --arg dim "$dim" '{
    location: $loc,
    kind: "LogAlert",
    tags: { app: "careflow", component: "scheduled-jobs" },
    properties: ({
      description: $desc, severity: $sev, enabled: true,
      scopes: [$ws], evaluationFrequency: $freq, windowSize: $win,
      criteria: { allOf: [{
        query: $q, timeAggregation: "Count", operator: "GreaterThan", threshold: 0,
        dimensions: (if $dim == "" then [] else [{ name: $dim, operator: "Include", values: ["*"] }] end),
        failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 } }] },
      autoMitigate: true,
      actions: { actionGroups: [$ag], customProperties: { component: "scheduled-jobs" } }
    } + (if $ovr == "" then {} else { overrideQueryTimeRange: $ovr } end))
  }' > "$TMP/$name.json"
  az rest --method put -o none --body @"$TMP/$name.json" \
    --url "https://management.azure.com$RG_ID/providers/Microsoft.Insights/scheduledQueryRules/$name?api-version=$ALERT_API"
  echo "  ok  $name"
}

echo "Creating/updating scheduled-job alerts in $RG (scope $WORKSPACE, action group $ACTION_GROUP)"

# 1. Container Apps Job execution failed: non-zero exit, retries exhausted, replica timeout, image/mount errors.
rule alert-sched-container-job-failed 1 PT15M PT30M "" \
  "A scheduled Container Apps Job (rolling rota / plan end / learning / care-plan reviews) execution failed" \
  JobName_s \
  "ContainerAppSystemLogs_CL
| where JobName_s in ($SCHEDULED_JOBS)
| where Reason_s in ('BackoffLimitExceeded', 'DeadlineExceeded', 'ErrImagePull', 'ImagePullBackOff', 'FailedMount')
     or (Reason_s == 'ProcessExited' and Log_s has 'failed container')
| project TimeGenerated, JobName_s, ExecutionName_s, Reason_s, Log_s"

# 2. Function invocation failed (the helper throws on 4xx, timeout, job failure, and 5xx after retry).
rule alert-sched-function-failed 2 PT5M PT10M "" \
  "A job-trigger function in $FUNC_APP failed (see AppRequests / AppTraces for the [jobs] line)" \
  OperationName \
  "AppRequests
| where AppRoleName =~ '$FUNC_APP'
| where Success == false
| project TimeGenerated, OperationName, ResultCode, DurationMs, OperationId"

# 3. Any job run recorded as failed (or a stale 'running' row closed as failed), from any trigger source.
rule alert-sched-jobrun-failed 2 PT15M PT30M "" \
  "A scheduled job run failed (JobRunner status=failed/stale); see admin System jobs for the error" \
  job \
  "$JOB_LINES
| where status in ('failed', 'stale')
| project TimeGenerated, job, status, source, runId, periodKey, emitter, L"

if [ "$SKIP_STALE" = "1" ]; then
  echo "  SKIP_STALE=1: not creating the 'no success' rules"
else
  # 4. Rolling rota: no success in 26 h (daily at 02:00 UTC + 2 h grace). 'skipped' (no active plans) counts as healthy.
  rule alert-sched-rolling-rota-stale 1 PT1H PT1H P2D \
    "No successful rolling-rota run in the last 26 hours - future visits may not be generated" \
    "" \
    "$JOB_LINES
| where TimeGenerated > ago(26h)
| where job == 'rolling-rota' and status in ('success', 'skipped')
| summarize successes = count()
| where successes == 0"

  # 5. Late visit alerts: runs every 5 min; no success in 30 min means carers'/office alerts have stopped.
  rule alert-sched-late-visit-alert-stale 1 PT10M PT30M "" \
    "No successful late-visit-alert run in the last 30 minutes - late/missed visit alerts are not being sent" \
    "" \
    "$JOB_LINES
| where job == 'late-visit-alert' and status in ('success', 'skipped')
| summarize successes = count()
| where successes == 0"
fi

echo
az monitor scheduled-query list -g "$RG" --query "[?starts_with(name, 'alert-sched-')].{name:name, severity:severity, enabled:enabled, every:evaluationFrequency}" -o table 2>/dev/null || true
