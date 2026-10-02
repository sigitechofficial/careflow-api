#!/usr/bin/env bash
# 03 – Create (or converge) the job-trigger Function App:
#        identity  id-careflow-func (user-assigned)
#        plan      asp-careflow-jobs-prod (Flex Consumption FC1, Linux, UK South)
#        app       func-careflow-jobs-prod (Node, 512 MB instances)
#   - host storage (AzureWebJobsStorage): identity-based, account stcareflowprod, no keys
#   - deployment package: blob container in stcareflowprod, accessed with id-careflow-func
#   - App Insights: appi-careflow-prod (workspace-based -> log-careflow-prod)
#   - JOBS_TRIGGER_SECRET: Key Vault reference resolved with id-careflow-func (keyVaultReferenceIdentity)
#
# Uses ARM directly (az rest) rather than `az functionapp create`. With UserAssignedIdentity
# deployment storage, the CLI also tries to create a role assignment, and this script must not
# change RBAC: every grant is in 04-role-assignments.sh, run by a human.
#
# Run by: the coordinator (Contributor on rg-careflow-prod).
# Order: after 01 (secret exists). The app only becomes healthy after 04 (storage + Key Vault
#        roles for id-careflow-func) and a restart. Then deploy the code with the GitHub workflow
#        "Deploy job triggers to Azure Functions".
# Idempotent: creates what is missing; on re-run converges config + app settings (merge, so
#             AzureWebJobs.<name>.Disabled pause flags you added are kept).
set -euo pipefail

RG=rg-careflow-prod
LOCATION=uksouth
APP=func-careflow-jobs-prod
PLAN=asp-careflow-jobs-prod
IDENTITY=id-careflow-func
STORAGE=stcareflowprod
DEPLOY_CONTAINER=deploy-func-careflow-jobs
APPI=appi-careflow-prod
KV=kv-careflow-prod
SECRET_NAME=jobs-trigger-secret
API_APP=allforcare-api
# The contract said Node 20, but Azure Functions support for Node 20 ended 2026-04-30
# (az functionapp list-flexconsumption-runtimes --location uksouth --runtime node).
# The code runs on Node >= 20. Keep this in step with NODE_VERSION in deploy-azure-functions.yml.
NODE_VERSION=22
INSTANCE_MEMORY_MB=512              # smallest Flex size; the functions only make one HTTP call
MAX_INSTANCES=10                    # timers run on a single instance; this is only a cost ceiling
ARM_API=2024-11-01

SUB=$(az account show --query id -o tsv)
RG_ID="/subscriptions/$SUB/resourceGroups/$RG"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT; chmod 700 "$TMP"

# Fail early if Flex Consumption / the runtime is not offered in the region.
az functionapp list-flexconsumption-locations --query "[?name=='$LOCATION'].name" -o tsv | grep -qx "$LOCATION" \
  || { echo "Flex Consumption is not available in $LOCATION"; exit 1; }
az functionapp list-flexconsumption-runtimes --location "$LOCATION" --runtime node --query "[].version" -o tsv | grep -qx "$NODE_VERSION" \
  || { echo "Node $NODE_VERSION is not offered on Flex Consumption in $LOCATION"; exit 1; }

echo "== identity $IDENTITY"
if ! az identity show -g "$RG" -n "$IDENTITY" -o none 2>/dev/null; then
  az identity create -g "$RG" -n "$IDENTITY" -l "$LOCATION" --tags app=careflow component=scheduled-jobs -o none
fi
ID_ID=$(az identity show -g "$RG" -n "$IDENTITY" --query id -o tsv)
ID_CLIENT=$(az identity show -g "$RG" -n "$IDENTITY" --query clientId -o tsv)

echo "== deployment container $STORAGE/$DEPLOY_CONTAINER (control plane - no data role needed)"
if ! az storage container-rm show -g "$RG" --storage-account "$STORAGE" -n "$DEPLOY_CONTAINER" -o none 2>/dev/null; then
  az storage container-rm create -g "$RG" --storage-account "$STORAGE" -n "$DEPLOY_CONTAINER" --public-access off -o none
fi
BLOB_ENDPOINT=$(az storage account show -g "$RG" -n "$STORAGE" --query primaryEndpoints.blob -o tsv)

echo "== Flex Consumption plan $PLAN"
cat > "$TMP/plan.json" <<EOF
{ "location": "$LOCATION", "kind": "functionapp",
  "sku": { "tier": "FlexConsumption", "name": "FC1" },
  "properties": { "reserved": true },
  "tags": { "app": "careflow", "component": "scheduled-jobs" } }
EOF
az rest --method put -o none --body @"$TMP/plan.json" \
  --url "https://management.azure.com$RG_ID/providers/Microsoft.Web/serverfarms/$PLAN?api-version=$ARM_API"
PLAN_ID="$RG_ID/providers/Microsoft.Web/serverfarms/$PLAN"

API_FQDN=$(az containerapp show -g "$RG" -n "$API_APP" --query properties.configuration.ingress.fqdn -o tsv)
KV_URI=$(az keyvault show -n "$KV" --query properties.vaultUri -o tsv)
SECRET_REF="@Microsoft.KeyVault(SecretUri=${KV_URI}secrets/$SECRET_NAME/)"
# Not printed. (The App Insights connection string is an ingestion key, not a credential, but keep it out of logs.)
APPI_CS=$(az monitor app-insights component show -g "$RG" -a "$APPI" --query connectionString -o tsv)
[ -n "$APPI_CS" ] || { echo "could not read $APPI connection string"; exit 1; }

FUNC_CONFIG=$(jq -n --arg blob "${BLOB_ENDPOINT}${DEPLOY_CONTAINER}" --arg id "$ID_ID" --arg node "$NODE_VERSION" \
  --argjson mem "$INSTANCE_MEMORY_MB" --argjson max "$MAX_INSTANCES" '{
    deployment: { storage: { type: "blobContainer", value: $blob,
      authentication: { type: "UserAssignedIdentity", userAssignedIdentityResourceId: $id } } },
    scaleAndConcurrency: { instanceMemoryMB: $mem, maximumInstanceCount: $max },
    runtime: { name: "node", version: $node } }')

# Flex Consumption: no FUNCTIONS_WORKER_RUNTIME / FUNCTIONS_EXTENSION_VERSION (runtime is in functionAppConfig).
jq -n --arg acct "$STORAGE" --arg client "$ID_CLIENT" --arg cs "$APPI_CS" \
      --arg api "https://$API_FQDN" --arg secret "$SECRET_REF" '[
  { name: "AzureWebJobsStorage__accountName", value: $acct },
  { name: "AzureWebJobsStorage__credential",  value: "managedidentity" },
  { name: "AzureWebJobsStorage__clientId",    value: $client },
  { name: "APPLICATIONINSIGHTS_CONNECTION_STRING", value: $cs },
  { name: "JOBS_API_BASE_URL",   value: $api },
  { name: "JOBS_TRIGGER_SECRET", value: $secret }
]' > "$TMP/settings.json"
echo "== function app $APP"
if ! az functionapp show -g "$RG" -n "$APP" -o none 2>/dev/null; then
  jq -n --arg loc "$LOCATION" --arg plan "$PLAN_ID" --arg id "$ID_ID" --argjson fac "$FUNC_CONFIG" \
        --slurpfile settings "$TMP/settings.json" '{
    location: $loc, kind: "functionapp,linux",
    tags: { app: "careflow", component: "scheduled-jobs" },
    identity: { type: "UserAssigned", userAssignedIdentities: { ($id): {} } },
    properties: {
      serverFarmId: $plan, httpsOnly: true, keyVaultReferenceIdentity: $id,
      functionAppConfig: $fac,
      siteConfig: { minTlsVersion: "1.2", ftpsState: "Disabled", http20Enabled: true, appSettings: $settings[0] }
    } }' > "$TMP/site.json"
  az rest --method put -o none --body @"$TMP/site.json" \
    --url "https://management.azure.com$RG_ID/providers/Microsoft.Web/sites/$APP?api-version=$ARM_API"
else
  echo "   exists - converging identity, Key Vault identity and Flex config"
  jq -n --arg id "$ID_ID" --argjson fac "$FUNC_CONFIG" '{
    identity: { type: "UserAssigned", userAssignedIdentities: { ($id): {} } },
    properties: { httpsOnly: true, keyVaultReferenceIdentity: $id, functionAppConfig: $fac } }' > "$TMP/site-patch.json"
  az rest --method patch -o none --body @"$TMP/site-patch.json" \
    --url "https://management.azure.com$RG_ID/providers/Microsoft.Web/sites/$APP?api-version=$ARM_API"
fi

echo "== app settings (merge; values not printed)"
az functionapp config appsettings set -g "$RG" -n "$APP" --settings @"$TMP/settings.json" -o none
# A connection-string AzureWebJobsStorage (if one was ever added) would win over the identity-based one.
if az functionapp config appsettings list -g "$RG" -n "$APP" --query "[?name=='AzureWebJobsStorage'].name" -o tsv | grep -q .; then
  az functionapp config appsettings delete -g "$RG" -n "$APP" --setting-names AzureWebJobsStorage -o none
fi

echo
az functionapp show -g "$RG" -n "$APP" --query "{name:name, state:properties.state, host:properties.defaultHostName, sku:properties.sku, kvIdentity:properties.keyVaultReferenceIdentity}" -o table
az functionapp config appsettings list -g "$RG" -n "$APP" --query "[].name" -o tsv | sort | sed 's/^/   setting: /'
cat <<EOF

Done. Next:
  1. A human runs 04-role-assignments.sh: Key Vault Secrets User + Storage Blob Data Owner for $IDENTITY,
     and Website Contributor on $APP for id-careflow-github-deploy.
  2. az functionapp restart -g $RG -n $APP
  3. Run the GitHub workflow "Deploy job triggers to Azure Functions" (workflow_dispatch) to deploy the code.
  4. Check the Key Vault reference resolved (expect "Resolved"):
     az rest --method get --url "https://management.azure.com$RG_ID/providers/Microsoft.Web/sites/$APP/config/configreferences/appsettings/JOBS_TRIGGER_SECRET?api-version=$ARM_API" --query properties.status -o tsv
EOF
