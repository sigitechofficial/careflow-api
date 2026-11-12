#!/usr/bin/env bash
# 02 – Create (or converge) the 4 schedule-triggered Container Apps Jobs that run the API image
#      as a CLI:  node dist/src/jobs/run-job.js <job-name>
#
# The job definition is GENERATED FROM THE LIVE API (allforcare-api), so env vars, Key Vault
# secret references, the Firebase secret volume, the uploads Azure Files volume, the registry
# identity and the managed identity match the API exactly. Then:
#   - CRON_MODE=external is forced (the CLI also forces it);
#   - env not needed by a CLI run is dropped (TRUST_PROXY_HOPS, JOBS_TRIGGER_SECRET, PORT, HOST);
#   - only secrets still referenced by env/volumes are kept.
#
# Run by: the coordinator (Contributor on rg-careflow-prod). No RBAC changes here (see 04).
# Before: the API image must already contain dist/src/jobs/run-job.js. Deploy the API code first;
#         a job pointing at an older image fails at its first scheduled run.
# Idempotent: creates missing jobs and updates existing ones from the same generated YAML.
#
#   DRY_RUN=1 ./02-container-apps-jobs.sh     # only write out/<job>.yaml for review
#   ./02-container-apps-jobs.sh               # write + create/update
#   IMAGE=acrcareflowprod.azurecr.io/careflow-api:abc1234 ./02-container-apps-jobs.sh
set -euo pipefail

RG=rg-careflow-prod
API_APP=allforcare-api
API_IDENTITY=id-careflow-api
CONTAINER_NAME=job                  # deploy-azure-api.yml updates this container's image
CPU=0.5
MEMORY=1Gi
REPLICA_TIMEOUT=1800                # seconds
REPLICA_RETRY_LIMIT=1
DROP_ENV='["TRUST_PROXY_HOPS","JOBS_TRIGGER_SECRET","PORT","HOST","CRON_MODE"]'
OUT_DIR="$(cd "$(dirname "$0")" && pwd)/out"
DRY_RUN="${DRY_RUN:-0}"

# job resource name | job name (contract) | cron (UTC, 5 fields)
JOBS=(
  "job-careflow-rolling-rota|rolling-rota|0 2 * * *"
  "job-careflow-plan-end|visit-plan-scheduled-end|30 0 * * *"
  "job-careflow-learning|learning-maintenance|30 2 * * *"
  "job-careflow-care-plan-reviews|care-plan-review-reminders|0 6 * * *"
  "job-careflow-over-care|over-care-review|45 2 * * *"
)

command -v jq >/dev/null || { echo "jq is required"; exit 1; }
az account show --query "{subscription:name}" -o tsv >/dev/null

echo "Reading live config of $API_APP ..."
API_JSON=$(az containerapp show -g "$RG" -n "$API_APP" -o json 2>/dev/null)
API_IDENTITY_ID=$(az identity show -g "$RG" -n "$API_IDENTITY" --query id -o tsv)
IMAGE="${IMAGE:-$(jq -r '.properties.template.containers[0].image' <<<"$API_JSON")}"
echo "Image: $IMAGE"

# Every secret must be a Key Vault reference: `show` never returns plain secret values, so a plain
# secret could not be copied (and should not exist in prod).
plain=$(jq -r '[.properties.configuration.secrets[]? | select((.keyVaultUrl // "") == "") | .name] | join(",")' <<<"$API_JSON")
[ -z "$plain" ] || { echo "API has non-Key-Vault secrets ($plain) - cannot copy them; move them to Key Vault first"; exit 1; }

mkdir -p "$OUT_DIR"
existing=$(az containerapp job list -g "$RG" --query "[].name" -o tsv)

for entry in "${JOBS[@]}"; do
  IFS='|' read -r JOB_RES JOB_NAME CRON <<<"$entry"
  FILE="$OUT_DIR/$JOB_RES.yaml"

  # JSON is valid YAML; `az containerapp job create/update --yaml` accepts it.
  jq --arg image "$IMAGE" --arg job "$JOB_NAME" --arg res "$JOB_RES" --arg cron "$CRON" \
     --arg container "$CONTAINER_NAME" --arg cpu "$CPU" --arg memory "$MEMORY" \
     --arg identity "$API_IDENTITY_ID" --argjson drop "$DROP_ENV" \
     --argjson timeout "$REPLICA_TIMEOUT" --argjson retries "$REPLICA_RETRY_LIMIT" '
    def nonull: walk(if type == "object" then with_entries(select(.value != null)) else . end);
    .properties as $p
    | $p.template.containers[0] as $c
    | ([$c.env[]? | select(.name as $n | $drop | index($n) | not) | if .secretRef then {name, secretRef} else {name, value} end]
       + [{name: "CRON_MODE", value: "external"}]) as $env
    | ([$env[] | .secretRef // empty] + [$p.template.volumes[]? | .secrets[]? | .secretRef]) as $used
    | {
        name: $res,
        type: "Microsoft.App/jobs",
        location: .location,
        tags: {app: "careflow", component: "scheduled-job", job: $job},
        identity: {type: "UserAssigned", userAssignedIdentities: {($identity): {}}},
        properties: {
          environmentId: ($p.environmentId // $p.managedEnvironmentId),
          workloadProfileName: ($p.workloadProfileName // "Consumption"),
          configuration: {
            triggerType: "Schedule",
            replicaTimeout: $timeout,
            replicaRetryLimit: $retries,
            scheduleTriggerConfig: {cronExpression: $cron, parallelism: 1, replicaCompletionCount: 1},
            registries: [$p.configuration.registries[]? | {server, identity}],
            secrets: [$p.configuration.secrets[]? | select(.name as $n | $used | index($n)) | {name, keyVaultUrl, identity}]
          },
          template: {
            containers: [{
              name: $container,
              image: $image,
              command: ["node"],
              args: ["dist/src/jobs/run-job.js", $job],
              env: $env,
              resources: {cpu: ($cpu | tonumber), memory: $memory},
              volumeMounts: [$c.volumeMounts[]? | {volumeName, mountPath}]
            }],
            volumes: [$p.template.volumes[]? | {name, storageType, storageName, mountOptions, secrets}]
          }
        }
      } | nonull' <<<"$API_JSON" > "$FILE"

  # Sanity checks on what we generated (names only).
  jq -e '.properties.template.containers[0].env | map(.name) | (index("DATABASE_URL") and index("FIELD_ENCRYPTION_KEY") and index("CRON_MODE"))' "$FILE" >/dev/null \
    || { echo "$FILE is missing DATABASE_URL / FIELD_ENCRYPTION_KEY / CRON_MODE"; exit 1; }
  jq -e '[.properties.template.containers[0].volumeMounts[].mountPath] | (index("/app/uploads") and index("/mnt/firebase"))' "$FILE" >/dev/null \
    || echo "WARNING: $JOB_RES has no /app/uploads or /mnt/firebase mount (the API has none either?)"

  echo "== $JOB_RES  ($JOB_NAME, cron '$CRON' UTC)  -> $FILE"
  jq -r '"   env: " + ([.properties.template.containers[0].env[].name] | join(" ")),
         "   secrets: " + ([.properties.configuration.secrets[].name] | join(" ")),
         "   mounts: " + ([.properties.template.containers[0].volumeMounts[] | .volumeName + ":" + .mountPath] | join(" "))' "$FILE"

  if [ "$DRY_RUN" = "1" ]; then continue; fi
  if grep -qx "$JOB_RES" <<<"$existing"; then
    echo "   updating existing job"
    az containerapp job update -g "$RG" -n "$JOB_RES" --yaml "$FILE" -o none
  else
    echo "   creating job"
    az containerapp job create -g "$RG" -n "$JOB_RES" --yaml "$FILE" -o none
  fi
  az containerapp job show -g "$RG" -n "$JOB_RES" --query "{name:name, trigger:properties.configuration.triggerType, cron:properties.configuration.scheduleTriggerConfig.cronExpression, image:properties.template.containers[0].image, args:join(' ', properties.template.containers[0].args)}" -o table
done

if [ "$DRY_RUN" = "1" ]; then echo; echo "DRY_RUN=1: nothing created. Review $OUT_DIR/*.yaml"; exit 0; fi
cat <<EOF

Done. Next:
  - 04-role-assignments.sh (human) grants id-careflow-github-deploy 'Container Apps Jobs Contributor' on these jobs,
    so deploy-azure-api.yml can move them to each new image.
  - Optional smoke run (runs the REAL job against production; idempotent per UTC date):
      az containerapp job start -g $RG -n job-careflow-plan-end
      az containerapp job execution list -g $RG -n job-careflow-plan-end -o table
EOF
