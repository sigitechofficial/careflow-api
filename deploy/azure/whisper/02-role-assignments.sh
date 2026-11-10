#!/usr/bin/env bash
# 02 – RBAC for the Whisper job. ONLY role definitions/assignments live here.
#
# RUN BY A HUMAN with Owner / User Access Administrator on rg-careflow-prod. Run after 01 (job exists).
# Safe to re-run: existing definitions and assignments are left as they are.
#
# Grants:
#   id-careflow-api            "CareFlow Whisper Job Starter" (custom)  job-careflow-whisper
#                              = read the job + start an execution. Nothing else: it cannot change,
#                              delete or stop the job, or touch any other resource.
#   id-careflow-github-deploy  Container Apps Jobs Contributor          job-careflow-whisper
#                              (deploy-azure-api.yml moves the job to each new image)
set -euo pipefail

RG=rg-careflow-prod
API_IDENTITY=id-careflow-api
DEPLOY_IDENTITY=id-careflow-github-deploy
JOB_RES=job-careflow-whisper
ROLE_NAME="CareFlow Whisper Job Starter"

SUB=$(az account show --query id -o tsv)
RG_ID="/subscriptions/$SUB/resourceGroups/$RG"
JOB_ID="$RG_ID/providers/Microsoft.App/jobs/$JOB_RES"

az resource show --ids "$JOB_ID" --query id -o tsv >/dev/null 2>&1 \
  || { echo "$JOB_RES does not exist yet - run 01-whisper-job.sh first"; exit 1; }

principal() { az identity show -g "$RG" -n "$1" --query principalId -o tsv; }

# grant <principalId> <role> <scope> <label>
grant() {
  local pid=$1 role=$2 scope=$3 label=$4
  if [ -n "$(az role assignment list --assignee-object-id "$pid" --role "$role" --scope "$scope" --query "[0].id" -o tsv 2>/dev/null)" ]; then
    echo "  = $role on $label (already assigned)"
  else
    az role assignment create --assignee-object-id "$pid" --assignee-principal-type ServicePrincipal \
      --role "$role" --scope "$scope" -o none
    echo "  + $role on $label"
  fi
}

echo "== custom role '$ROLE_NAME'"
if [ -n "$(az role definition list --custom-role-only true --name "$ROLE_NAME" --scope "$RG_ID" --query "[0].id" -o tsv)" ]; then
  echo "  = exists"
else
  az role definition create -o none --role-definition "$(cat <<JSON
{
  "Name": "$ROLE_NAME",
  "Description": "Start executions of the CareFlow Whisper Container Apps Job (used by the API's managed identity).",
  "Actions": ["Microsoft.App/jobs/read", "Microsoft.App/jobs/start/action"],
  "NotActions": [],
  "AssignableScopes": ["$RG_ID"]
}
JSON
)"
  echo "  + created (it can take a minute before it can be assigned)"
fi

echo "== $API_IDENTITY"
grant "$(principal "$API_IDENTITY")" "$ROLE_NAME" "$JOB_ID" "$JOB_RES"

echo "== $DEPLOY_IDENTITY"
grant "$(principal "$DEPLOY_IDENTITY")" "Container Apps Jobs Contributor" "$JOB_ID" "$JOB_RES"

echo
echo "All grants in place. Role assignments can take a few minutes to apply."
