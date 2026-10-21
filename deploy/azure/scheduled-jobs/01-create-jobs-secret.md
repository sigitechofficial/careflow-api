# 01 – Create the `jobs-trigger-secret` and give it to the API

The Function App proves itself to the API with a shared secret sent in the
`x-jobs-trigger-secret` header. It lives in Key Vault only:

- **Key Vault** `kv-careflow-prod` → secret `jobs-trigger-secret` (64 random URL-safe characters).
- **API** `allforcare-api` → Container Apps secret `jobs-trigger-secret` (Key Vault reference, identity
  `id-careflow-api`) → env `JOBS_TRIGGER_SECRET=secretref:jobs-trigger-secret`.
- **Function App** `func-careflow-jobs-prod` → app setting `JOBS_TRIGGER_SECRET =
  @Microsoft.KeyVault(SecretUri=https://kv-careflow-prod.vault.azure.net/secrets/jobs-trigger-secret/)`.
  `03-function-app.sh` sets this.

The value is never typed, printed, committed or stored in GitHub.

**Who runs this?** Someone with **Key Vault Secrets Officer** (or Key Vault Administrator) on
`kv-careflow-prod` to write the secret, plus Contributor on `rg-careflow-prod` for the container app.
`id-careflow-api` already has *Key Vault Secrets User* on the whole vault, so the API needs no new role.

**When?** After the API code with `POST /internal/jobs/:name` is deployed. Before that the env var is
harmless, because the API ignores it.

## 1. Create the secret in Key Vault (only if it does not exist yet)

```bash
set -euo pipefail
KV=kv-careflow-prod
NAME=jobs-trigger-secret

if az keyvault secret show --vault-name "$KV" -n "$NAME" --query id -o tsv >/dev/null 2>&1; then
  echo "secret $NAME already exists - not changing it (see 'Rotate' below)"
else
  TMP=$(mktemp); chmod 600 "$TMP"; trap 'rm -f "$TMP"' EXIT
  # 64 URL-safe characters; written to a 0600 temp file so it never appears in argv / shell history.
  openssl rand -base64 96 | tr -d '\n/+=' | cut -c1-64 | tr -d '\n' > "$TMP"
  [ "$(wc -c < "$TMP")" -ge 48 ] || { echo "secret generation failed"; exit 1; }
  az keyvault secret set --vault-name "$KV" -n "$NAME" --file "$TMP" --encoding utf-8 \
    --content-type "text/plain; careflow scheduled-jobs trigger" --query id -o tsv >/dev/null
  echo "created $NAME"
fi
```

## 2. Add it to the API container app as a secretRef env var

```bash
set -euo pipefail
RG=rg-careflow-prod
APP=allforcare-api
KV_URI=https://kv-careflow-prod.vault.azure.net/secrets/jobs-trigger-secret   # no version: picks up rotations
API_ID=$(az identity show -g "$RG" -n id-careflow-api --query id -o tsv)

az containerapp secret set -g "$RG" -n "$APP" \
  --secrets "jobs-trigger-secret=keyvaultref:$KV_URI,identityref:$API_ID" -o none

# New revision with the env var. CRON_MODE stays as it is (internal) until the cut-over in README step 8.
az containerapp update -g "$RG" -n "$APP" \
  --set-env-vars "JOBS_TRIGGER_SECRET=secretref:jobs-trigger-secret" -o none

# Check (names only - never values):
az containerapp show -g "$RG" -n "$APP" \
  --query "properties.template.containers[0].env[?name=='JOBS_TRIGGER_SECRET' || name=='CRON_MODE']" -o table
```

The GitHub deploy pipeline only changes the image (`az containerapp update --image`), so it keeps
this env var on later deploys.

Check that the endpoint is enabled. You should get 401 without the header, not 404 or 503:

```bash
FQDN=$(az containerapp show -g rg-careflow-prod -n allforcare-api --query properties.configuration.ingress.fqdn -o tsv)
curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://$FQDN/internal/jobs/survey-distribution"
```

## Rotate

1. Write a new version: re-run step 1 without the `if` guard.
2. Restart both consumers so they read it at once. Container Apps refreshes Key Vault references in
   about 30 minutes and App Service in about 24 hours, so restart rather than wait:
   ```bash
   REV=$(az containerapp revision list -g rg-careflow-prod -n allforcare-api --query "[?properties.trafficWeight==\`100\`].name | [0]" -o tsv)
   az containerapp revision restart -g rg-careflow-prod -n allforcare-api --revision "$REV"
   az functionapp restart -g rg-careflow-prod -n func-careflow-jobs-prod
   ```

Until both have restarted, the function calls get 401. The function invocation fails and the alert fires.
Rotate in a quiet window.
