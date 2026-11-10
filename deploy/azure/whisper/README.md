# Whisper on Azure: set-up runbook

Initial Assessment "Conversation to text" runs Whisper (faster-whisper) on a recording. On Azure it runs
in a separate **Container Apps Job** that only exists while there is something to transcribe:

1. A user uploads or records a conversation. The API saves the recording (Azure Files, `/app/uploads`),
   adds a row to `service_users.InitialAssessmentTranscriptionJob` (`QUEUED`) and starts one execution of
   `job-careflow-whisper` through ARM (`jobs/start`), signed in as its managed identity.
2. The execution (image `careflow-whisper`, 2 vCPU / 4 GiB) claims queued rows one at a time
   (`FOR UPDATE SKIP LOCKED`, so parallel executions never take the same row), runs Whisper, saves the
   transcript attachment and marks the row `DONE` or `FAILED`. It sends a heartbeat every 30 s and exits
   when the queue is empty.
3. The admin app polls the API as before. The response has the same shape as local mode, so the admin
   app needs no change.

This only applies when the API has `WHISPER_MODE=azure-job`. Without it the API keeps the original
behaviour (Whisper inside the API process, jobs in memory), which is what the cPanel VPS and developer
machines use.

## Safety

- **Opt-in.** Nothing changes until `WHISPER_MODE=azure-job` is set on `allforcare-api` (step 4), and
  nothing about this job is built or deployed until the repo variable `WHISPER_JOB_ENABLED=true` (step 5).
- **The audio stays in your Azure.** The model is baked into the image, and `HF_HUB_OFFLINE=1` stops it
  from downloading anything at run time. Audio never leaves the environment.
- **Least privilege.** The API identity gets a custom role on this one job that can only read it and
  start an execution.
- **Nothing gets stuck.** If the job cannot be started, the API fails the transcription at once with a
  clear message (the recording stays saved). A row nobody picked up in 20 minutes, or whose worker went
  quiet for 5 minutes, is marked `FAILED` when it is next polled.
- **Data.** Rows (including the transcript text) are deleted 2 hours after they finish, as in local
  mode. The transcript itself stays as a private attachment of the assessment.

## Order of operations

None of these steps has been run.

| # | Step | Who | Needs |
|---|---|---|---|
| 0 | Merge and deploy the API code. This includes the migration `20261231090000_initial_assessment_transcription_jobs`. Leave `WHISPER_MODE` unset. | pipeline | – |
| 1 | Build the first worker image (below) | coordinator | AcrPush on `acrcareflowprod` |
| 2 | `IMAGE=… DRY_RUN=1 ./01-whisper-job.sh`, review `out/job-careflow-whisper.yaml`, then run it again without `DRY_RUN` | coordinator | Contributor on the RG |
| 3 | `./02-role-assignments.sh` | **HUMAN** (RBAC) | Owner / User Access Administrator on the RG |
| 4 | Switch the API over (below) | coordinator | – |
| 5 | Set the GitHub repo variable `WHISPER_JOB_ENABLED=true`, so every deploy builds, tests and rolls out the worker image | repo admin | – |
| 6 | Verify (below) | coordinator | – |

### Step 1: first image

Run from the `careflow-api` folder, on the commit that is deployed:

```bash
TAG=$(git rev-parse --short=7 HEAD)
az acr build -r acrcareflowprod --target whisper-worker -t careflow-whisper:$TAG .
```

The image is about 1 GB larger than the API image, mostly Python, CTranslate2 and the `small` model.
To use another model, add `--build-arg WHISPER_MODEL=medium`. Bigger models are more accurate and much
slower, and medium needs more memory than 4 GiB to be safe.

### Step 4: switch the API over

```bash
JOB_ID=$(az containerapp job show -g rg-careflow-prod -n job-careflow-whisper --query id -o tsv)
az containerapp update -g rg-careflow-prod -n allforcare-api \
  --set-env-vars WHISPER_MODE=azure-job WHISPER_JOB_RESOURCE_ID="$JOB_ID"
```

### Step 6: verify

Record or upload a short conversation on an Initial Assessment, under **Conversation to text**. It first
shows queued while the job starts (about 30–90 s), then running, then the transcript.

```bash
az containerapp job execution list -g rg-careflow-prod -n job-careflow-whisper -o table
```

In Log Analytics:

```kusto
ContainerAppConsoleLogs_CL
| where ContainerJobName_s == 'job-careflow-whisper'
| where Log_s has 'TranscriptionWorker' or Log_s has 'transcription-worker'
| take 50
```

Each execution logs `Transcription <id> done: <n>s of audio in <n>s` per file and ends with
`done=<n> failed=<n>`. On the API side, `could not start the Whisper job` means the ARM start failed.
That is usually the step 3 role (`AuthorizationFailed`) or a wrong `WHISPER_JOB_RESOURCE_ID`.

## Rollback

```bash
az containerapp update -g rg-careflow-prod -n allforcare-api --remove-env-vars WHISPER_MODE
```

This puts the API back to local mode. Note that the API image has no Python, so on Azure that means
"Whisper is not installed", the same as before this change. The job and the role can stay; they cost
nothing while unused. To stop rolling out the worker image, set `WHISPER_JOB_ENABLED` to anything other
than `true`.

## Cost

Consumption plan, UK South list prices: 2 vCPU + 4 GiB is about **$0.30 an hour while it runs**, and
nothing while idle. Each upload starts its own execution, so several uploads at once run in parallel,
each billed separately. The time per file depends on the recording length. The `small` model on 2 vCPU
took about 13 s for 8 s of speech in local testing, but that was not measured on Azure.

## Notes

- **Image and code must match.** The worker is the API code plus Python. The deploy rolls it out after
  the API revision, from the same commit, so the queue table and the worker always agree.
- **`replicaRetryLimit 0`.** A retry would find its row already claimed. A crashed execution leaves its row
  `RUNNING`; after 5 minutes without a heartbeat the API reports it as failed and the user can try again.
- **Timeout.** `replicaTimeout` is 4 h. A single file is stopped after 3 h (`WHISPER_MAX_RUN_MS`).
