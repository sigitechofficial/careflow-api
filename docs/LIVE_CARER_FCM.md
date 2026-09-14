# Live carer FCM + PM2 (incident notes)

How Careflow sends carer phone pushes on live, what broke in September 2026, and the exact server steps that fixed it.

**Live API**

- URL: `https://careflowbackend.sigisolutions.net/`
- Folder: `/home/sigisolutions/careflowbackend.sigisolutions.net`
- PM2 app name: `main`
- Port: `3043` (cPanel proxies HTTPS here)

Do **not** put `serviceAccount.json` on the admin site. Admin office alerts are PostgreSQL + REST + Socket.IO. Only the **API** sends FCM to the carer app.

---

## Two different notification systems

| Who | Mechanism | Firebase? |
| --- | --- | --- |
| Admin office (bell / toast) | API → Postgres + Socket.IO | No |
| Carer phone | API → Firebase Admin → FCM | Yes |

If the admin bell count goes up but the carer phone is silent, Firebase on the **API server** is the usual cause. The Flutter app saving a device token is not enough by itself.

---

## What went wrong

### 1. Carer push not sent — Firebase not configured

Admin SOS **Acknowledge** toast:

> SOS acknowledged — Carer push was not sent — Firebase is not configured on the server.

**Cause:** live API had no Firebase service account. `serviceAccount.json` is gitignored, so a `main` deploy never copies it.

The API looks for the file at startup (`FcmPushService`):

- Env `FIREBASE_SERVICE_ACCOUNT_PATH`, or default `./serviceAccount.json`
- Path is resolved with `process.cwd()`, not the git repo root

GitHub deploy / PM2 historically used cwd:

```text
/home/sigisolutions/careflowbackend.sigisolutions.net/dist/src
```

So a file only in the site **root** is invisible. The process looks for:

```text
/home/sigisolutions/careflowbackend.sigisolutions.net/dist/src/serviceAccount.json
```

Putting the file in File Manager at the site root was not enough until we copied it into `dist/src` **or** started PM2 with `--cwd` set to the site root.

Firebase is loaded **once** when Node starts. Uploading the file without restarting PM2 does nothing.

### 2. Admin login Failed to fetch / app HTTP 503

After `pm2 restart main` from the **cPanel Terminal**, the API process stayed “online” (~200 MB) but **did not listen on 3043**.

```text
curl http://127.0.0.1:3043/   → Connection refused
https://careflowbackend.sigisolutions.net/  → 503
```

**Cause:** cPanel shell default Node is **v16.20.2**. Nest `@nestjs/schedule` needs the global `crypto` (Node 19+). Boot died with:

```text
ReferenceError: crypto is not defined
    at SchedulerOrchestrator.addCron
```

`listen()` never ran. Apache/cPanel still proxied to 3043 → 503. Admin showed `Failed to fetch`.

GitHub Actions deploy already runs `ensure_node20` then `pm2 reload`. Restarting PM2 from a Node 16 shell **replaces** that good process with Node 16.

---

## What we did (working sequence)

### A. Put the service account on the API server

1. Copy local `careflow-api/serviceAccount.json` (Firebase project `care-b013a`) to the live API folder. **Do not commit it.**
2. Confirm it exists:

```bash
ls -l /home/sigisolutions/careflowbackend.sigisolutions.net/serviceAccount.json
```

3. If PM2 `exec cwd` is `dist/src`, also copy there (or set an absolute path in `.env` — see below):

```bash
cp /home/sigisolutions/careflowbackend.sigisolutions.net/serviceAccount.json \
   /home/sigisolutions/careflowbackend.sigisolutions.net/dist/src/serviceAccount.json
```

### B. Never restart `main` with Node 16

cPanel Terminal default is Node 16. Always switch to 20 first:

```bash
node -v
# if this prints v16.x, continue:

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20
node -v
# must print v20.x
```

Then start PM2 **with that interpreter** and site-root cwd (so `.env` and `serviceAccount.json` at the site root are found):

```bash
cd /home/sigisolutions/careflowbackend.sigisolutions.net
pm2 delete main
pm2 start dist/src/main.js --name main \
  --cwd /home/sigisolutions/careflowbackend.sigisolutions.net \
  --interpreter "$(which node)"
pm2 save
```

Wait ~60s (Nest maps a lot of routes before it listens). Then:

```bash
curl -sS -o /dev/null -w "local:%{http_code}\n" http://127.0.0.1:3043/
grep -i FCM /home/sigisolutions/.pm2/logs/main-out.log | tail -5
```

Healthy:

- `local:200` / `401` / `404` (not `000` / connection refused)
- log: `Firebase Admin initialised for FCM`

Then admin login and SOS Acknowledge should work. Toast **Push notification sent to the carer** means FCM send ran.

### C. Confirm FCM after a restart

```bash
pm2 show main | grep -i "exec cwd"
pm2 logs main --lines 80 --nostream
grep -i FCM /home/sigisolutions/.pm2/logs/main-out.log | tail -10
```

Ignore older lines like `service account not found` if the **latest** PID says initialised.

SOS ack push is **first acknowledge only**. Re-acking the same SOS does not send FCM again (`NOT_FIRST_ACK`).

---

## Admin Acknowledge toasts

Returned on `PATCH /ecm/exceptions/:id/acknowledge` as `data.fcm.reason`:

| Reason | Meaning |
| --- | --- |
| `SENT` | FCM accepted at least one device |
| `FIREBASE_NOT_READY` | Service account missing / invalid, or Firebase not initialised |
| `NO_DEVICE_TOKEN` | Carer has no registered FCM token |
| `NO_EMPLOYEE` | SOS context has no employee id |
| `SEND_FAILED` | Firebase send failed |
| `NOT_FIRST_ACK` | Already acknowledged; no second push |

---

## Safer `.env` (optional)

If you keep the JSON at the site root, set an **absolute** path so cwd no longer matters:

```bash
FIREBASE_SERVICE_ACCOUNT_PATH=/home/sigisolutions/careflowbackend.sigisolutions.net/serviceAccount.json
```

Then `pm2 restart main --update-env` **only after** `nvm use 20`.

---

## After the next GitHub deploy

`rsync --delete` does **not** exclude `serviceAccount.json`. A deploy can wipe `dist/src/serviceAccount.json` (and a root copy if it was not excluded). `.env` is excluded and survives.

After deploy:

1. Confirm `serviceAccount.json` is still on disk (root and/or `dist/src`).
2. Confirm PM2 `main` is still Node 20 and listening on 3043.
3. Confirm log `Firebase Admin initialised for FCM`.

If the file vanished, copy it back and reload with Node 20 as in section B. Do not `pm2 restart` from a Node 16 shell.

---

## Quick checks

| Symptom | Check |
| --- | --- |
| Toast: Firebase not configured | File missing at `cwd` + restart; grep `FCM skipped` |
| `Failed to fetch` / public 503 | `curl 127.0.0.1:3043` — refused means Node not listening |
| `crypto is not defined` | PM2 started with Node 16 |
| Carer token toast on login, still no SOS ack push | Token store OK; look at FCM send on API |
| Admin bell works, no carer push | Expected if Firebase down — admin does not use FCM |

Related: [DEPLOY_FAILURES.md](./DEPLOY_FAILURES.md) (Node 20 on VPS, migrate/seed, SSH timeouts).
