#!/usr/bin/env bash
# 04 – RBAC grants for the scheduled-jobs setup. ONLY role assignments live here.
#
# RUN BY A HUMAN with Owner / User Access Administrator / Role Based Access Control Administrator
# on rg-careflow-prod. The coordinator and the GitHub deploy identity cannot (and must not) grant roles.
#
# Run after 02 (jobs exist) and 03 (identity + function app exist). Safe to re-run: existing
# assignments are left as they are, and a resource that does not exist yet is skipped with a WARNING
# (re-run once it exists).
#
# Grants:
#   id-careflow-func           Key Vault Secrets User          kv-careflow-prod   (resolve JOBS_TRIGGER_SECRET)
#   id-careflow-func           Storage Blob Data Owner         stcareflowprod     (identity-based AzureWebJobsStorage:
#                                                                                  timer locks + schedule monitor blobs;
#                                                                                  also covers the deployment container)
#   id-careflow-github-deploy  Website Contributor             func-careflow-jobs-prod   (Azure/functions-action deploy,
#                                                                                         list functions / settings)
#   id-careflow-github-deploy  Container Apps Jobs Contributor each of the 4 scheduled jobs (image update on deploy)
#
# Federated credential: none needed. The existing credential "github-careflow-api-azure"
# (repo:sigitechofficial/careflow-api:ref:refs/heads/azure) on id-careflow-github-deploy already
# covers deploy-azure-functions.yml (push to azure + workflow_dispatch on azure). You would need a new
# one only if a workflow ran from another branch, a tag, a pull request or a GitHub `environment:`.
set -euo pipefail

RG=rg-careflow-prod
FUNC_IDENTITY=id-careflow-func
DEPLOY_IDENTITY=id-careflow-github-deploy
KV=kv-careflow-prod
STORAGE=stcareflowprod
FUNC_APP=func-careflow-jobs-prod
SCHEDULED_JOBS=(job-careflow-rolling-rota job-careflow-plan-end job-careflow-learning job-careflow-care-plan-reviews)

SUB=$(az account show --query id -o tsv)
RG_ID="/subscriptions/$SUB/resourceGroups/$RG"
skipped=0

principal() { az identity show -g "$RG" -n "$1" --query principalId -o tsv 2>/dev/null || true; }

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

# exists <resource id>
exists() { az resource show --ids "$1" --query id -o tsv >/dev/null 2>&1; }

FUNC_PID=$(principal "$FUNC_IDENTITY")
DEPLOY_PID=$(principal "$DEPLOY_IDENTITY")
[ -n "$DEPLOY_PID" ] || { echo "identity $DEPLOY_IDENTITY not found"; exit 1; }

echo "== $FUNC_IDENTITY"
if [ -z "$FUNC_PID" ]; then
  echo "  WARNING: $FUNC_IDENTITY does not exist yet (created by 03-function-app.sh) - skipped"; skipped=1
else
  grant "$FUNC_PID" "Key Vault Secrets User" "$RG_ID/providers/Microsoft.KeyVault/vaults/$KV" "$KV"
  grant "$FUNC_PID" "Storage Blob Data Owner" "$RG_ID/providers/Microsoft.Storage/storageAccounts/$STORAGE" "$STORAGE"
fi

echo "== $DEPLOY_IDENTITY"
FUNC_ID="$RG_ID/providers/Microsoft.Web/sites/$FUNC_APP"
if exists "$FUNC_ID"; then
  grant "$DEPLOY_PID" "Website Contributor" "$FUNC_ID" "$FUNC_APP"
else
  echo "  WARNING: $FUNC_APP does not exist yet (03-function-app.sh) - skipped"; skipped=1
fi
for J in "${SCHEDULED_JOBS[@]}"; do
  JOB_ID="$RG_ID/providers/Microsoft.App/jobs/$J"
  if exists "$JOB_ID"; then
    grant "$DEPLOY_PID" "Container Apps Jobs Contributor" "$JOB_ID" "$J"
  else
    echo "  WARNING: $J does not exist yet (02-container-apps-jobs.sh) - skipped"; skipped=1
  fi
done

echo
if [ "$skipped" = 1 ]; then
  echo "Some grants were skipped - re-run this script after the missing resources are created."
else
  echo "All grants in place. Role assignments can take a few minutes to apply. Then:"
  echo "  az functionapp restart -g $RG -n $FUNC_APP"
fi
