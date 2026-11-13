#!/usr/bin/env bash
# 01 – Create (or converge) the Whisper Container Apps Job: manual trigger, scales to zero.
#
# The API (WHISPER_MODE=azure-job) queues each upload in the database and starts one execution of
# this job; the execution runs
#   node dist/src/initial-assessments/run-transcription-worker.js
# from the careflow-whisper image, transcribes everything queued, and exits. Nothing runs (or costs)
# while there is nothing to transcribe.
#
# The job definition is GENERATED FROM THE LIVE API (allforcare-api), like the scheduled jobs, so the
# database settings, Key Vault secret references, the uploads Azure Files volume (the recordings),
# the registry identity and the managed identity match the API exactly. Then:
#   - CRON_MODE=external is forced (the worker also forces it);
#   - env not needed by the worker is dropped, and Whisper settings baked into the image
#     (WHISPER_PYTHON, WHISPER_MODEL, HF_*) are dropped so the image's values win;
#   - only secrets still referenced by env/volumes are kept.
#
# Run by: the coordinator (Contributor on rg-careflow-prod). No RBAC changes here (see 02).
# Before: the careflow-whisper image must exist in ACR (README step 1).
# Idempotent: creates the job if missing, otherwise updates it from the same generated YAML.
#
#   IMAGE=acrcareflowprod.azurecr.io/careflow-whisper:<tag> DRY_RUN=1 ./01-whisper-job.sh   # only write out/
#   IMAGE=acrcareflowprod.azurecr.io/careflow-whisper:<tag> ./01-whisper-job.sh             # write + create/update
set -euo pipefail

RG=rg-careflow-prod
API_APP=allforcare-api
API_IDENTITY=id-careflow-api
JOB_RES=job-careflow-whisper
CONTAINER_NAME=whisper              # deploy-azure-api.yml updates this container's image
CPU=2
MEMORY=4Gi
REPLICA_TIMEOUT=14400               # seconds; one file may take up to 3 h (WHISPER_MAX_RUN_MS)
REPLICA_RETRY_LIMIT=0               # a retry would find its job already claimed; the API reports the failure
DROP_ENV='["TRUST_PROXY_HOPS","JOBS_TRIGGER_SECRET","PORT","HOST","CRON_MODE","WHISPER_MODE","WHISPER_JOB_RESOURCE_ID","WHISPER_PYTHON","WHISPER_MODEL","HF_HOME","HF_HUB_OFFLINE"]'
OUT_DIR="$(cd "$(dirname "$0")" && pwd)/out"
DRY_RUN="${DRY_RUN:-0}"

: "${IMAGE:?set IMAGE=acrcareflowprod.azurecr.io/careflow-whisper:<tag> (README step 1)}"
case "$IMAGE" in */careflow-whisper:*) ;; *) echo "IMAGE must be a careflow-whisper image, got $IMAGE"; exit 1;; esac

command -v jq >/dev/null || { echo "jq is required"; exit 1; }
az account show --query "{subscription:name}" -o tsv >/dev/null

echo "Reading live config of $API_APP ..."
API_JSON=$(az containerapp show -g "$RG" -n "$API_APP" -o json 2>/dev/null)
API_IDENTITY_ID=$(az identity show -g "$RG" -n "$API_IDENTITY" --query id -o tsv)
echo "Image: $IMAGE"

plain=$(jq -r '[.properties.configuration.secrets[]? | select((.keyVaultUrl // "") == "") | .name] | join(",")' <<<"$API_JSON")
[ -z "$plain" ] || { echo "API has non-Key-Vault secrets ($plain) - cannot copy them; move them to Key Vault first"; exit 1; }

mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/$JOB_RES.yaml"

jq --arg image "$IMAGE" --arg res "$JOB_RES" \
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
      tags: {app: "careflow", component: "whisper-worker"},
      identity: {type: "UserAssigned", userAssignedIdentities: {($identity): {}}},
      properties: {
        environmentId: ($p.environmentId // $p.managedEnvironmentId),
        workloadProfileName: ($p.workloadProfileName // "Consumption"),
        configuration: {
          triggerType: "Manual",
          replicaTimeout: $timeout,
          replicaRetryLimit: $retries,
          manualTriggerConfig: {parallelism: 1, replicaCompletionCount: 1},
          registries: [$p.configuration.registries[]? | {server, identity}],
          secrets: [$p.configuration.secrets[]? | select(.name as $n | $used | index($n)) | {name, keyVaultUrl, identity}]
        },
        template: {
          containers: [{
            name: $container,
            image: $image,
            command: ["node"],
            args: ["dist/src/initial-assessments/run-transcription-worker.js"],
            env: $env,
            resources: {cpu: ($cpu | tonumber), memory: $memory},
            volumeMounts: [$c.volumeMounts[]? | {volumeName, mountPath}]
          }],
          volumes: [$p.template.volumes[]? | {name, storageType, storageName, mountOptions, secrets}]
        }
      }
    } | nonull' <<<"$API_JSON" > "$FILE"

jq -e '.properties.template.containers[0].env | map(.name) | (index("DATABASE_URL") and index("CRON_MODE"))' "$FILE" >/dev/null \
  || { echo "$FILE is missing DATABASE_URL / CRON_MODE"; exit 1; }
jq -e '[.properties.template.containers[0].volumeMounts[].mountPath] | index("/app/uploads")' "$FILE" >/dev/null \
  || { echo "$FILE has no /app/uploads mount - the worker could not read the recordings"; exit 1; }

echo "== $JOB_RES (manual trigger, $CPU vCPU / $MEMORY) -> $FILE"
jq -r '"   env: " + ([.properties.template.containers[0].env[].name] | join(" ")),
       "   secrets: " + ([.properties.configuration.secrets[].name] | join(" ")),
       "   mounts: " + ([.properties.template.containers[0].volumeMounts[] | .volumeName + ":" + .mountPath] | join(" "))' "$FILE"

if [ "$DRY_RUN" = "1" ]; then echo; echo "DRY_RUN=1: nothing created. Review $FILE"; exit 0; fi
if az containerapp job show -g "$RG" -n "$JOB_RES" --query name -o tsv >/dev/null 2>&1; then
  echo "   updating existing job"
  az containerapp job update -g "$RG" -n "$JOB_RES" --yaml "$FILE" -o none
else
  echo "   creating job"
  az containerapp job create -g "$RG" -n "$JOB_RES" --yaml "$FILE" -o none
fi
az containerapp job show -g "$RG" -n "$JOB_RES" \
  --query "{name:name, id:id, trigger:properties.configuration.triggerType, image:properties.template.containers[0].image}" -o table

cat <<EOF

Done. Next: 02-role-assignments.sh (human), then README step 4.
WHISPER_JOB_RESOURCE_ID for the API:
  $(az containerapp job show -g "$RG" -n "$JOB_RES" --query id -o tsv)
EOF
