# Import legacy gallery images

## ePlan Care icons (`login.eplancare.com`)

URLs are listed in `gallery-legacy-urls.txt`. The server returns **403** without a logged-in session.

**Option A — Playwright (recommended)**

```powershell
cd care-admin
node scripts/download-eplancare-gallery.mjs --login
# Log in in the browser window, press Enter, then:
node scripts/download-eplancare-gallery.mjs
cd ../careadmin-backend
npm run prisma:seed
```

**Option B — Direct fetch** (only if your network allows unauthenticated access):

```powershell
cd careadmin-backend
npm run import:gallery-urls
npm run prisma:seed
```

## Local gallery (already working)

Standard icons are stored under `uploads/care-pathway/standard/` and seeded into the DB.
Form Builder and the Gallery tab load **all** icons (paginated API, limit 100).

```powershell
cd careadmin-backend
npm run sync:gallery-public   # copy Figma SVGs from care-admin/public
npm run prisma:seed
```

## If you only have a narrow screenshot

Screenshots that show `https://log...` are **not enough** — the full URL is cut off. Use the browser console on the legacy gallery page:

```js
copy([...document.querySelectorAll('img[src^="http"]')].map(i => i.src).join('\n'))
```

Then paste into `gallery-legacy-urls.txt` (one URL per line).

## Import steps

```powershell
cd careadmin-backend
npm run import:gallery-urls
npm run prisma:seed
```

Restart the backend and refresh **Settings → Care Pathway → Gallery**.

If the Care Admin gallery tab already shows `http://localhost:3000/uploads/...` icons, you do **not** need to import — those files are local.

To scrape **remote** legacy URLs from the running gallery tab (when img src is a LogiCare blob URL):

```powershell
cd care-admin
node scripts/scrape-gallery-urls.mjs
cd ../careadmin-backend
npm run import:gallery-urls
npm run prisma:seed
```

## Without legacy URLs

Seeded SVG icons are already used:

```powershell
npm run prisma:seed
```

Form Builder picks icons from the same gallery API.
