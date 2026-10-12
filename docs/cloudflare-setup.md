# Cloudflare setup: private site with cloud backup

This moves the app from GitHub Pages to Cloudflare Pages, puts Cloudflare Access in
front of it so only the people you list can open it, and saves every entry to a
Cloudflare D1 database. All of it is on Cloudflare's free plans.

You'll do this once in the Cloudflare dashboard. Keep the GitHub Pages site running
until step 6 is done, because your mum's current entries are stored under that
address on her phone.

## 1. Create the database
Workers & Pages → **D1 SQL Database** → **Create**. Name it `daily-tracker`.
The app creates its tables itself on first use.

## 2. Create the Pages project
Workers & Pages → **Create** → **Pages** → **Connect to Git** → pick
`josh-gree/daily-tracker`.
- Production branch: `main`
- Framework preset: None
- Build command: leave empty
- Build output directory: `/`

Note the address it gives you, e.g. `daily-tracker-abc.pages.dev`.

## 3. Connect the database
In the Pages project: **Settings → Bindings → Add → D1 database**.
Variable name `DB`, database `daily-tracker`. Add it for both Production and Preview.

## 4. Lock the site with Cloudflare Access
Open **Zero Trust** from the dashboard sidebar. The first time, it asks you to
pick a team name (this gives you `<team>.cloudflareaccess.com`) and a plan: choose
**Free** (up to 50 users). Cloudflare may ask for a card to activate the free plan;
it isn't charged.

Then **Access → Applications → Add an application → Self-hosted**:
- Application domain: your Pages address (`daily-tracker-abc.pages.dev`). Add a
  second domain `*.daily-tracker-abc.pages.dev` so preview builds are private too.
- Session duration: **1 month** (how often she has to enter a new email code).
- Policy: Action **Allow**, Include → **Emails** → your mum's email and yours.
- Login method: **One-time PIN** (on by default; she gets a code by email).

Save, then open the application again and copy its **Application Audience (AUD) Tag**.

## 5. Tell the app who's allowed
Pages project → **Settings → Variables and Secrets**, for Production and Preview:

| Name | Value |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | the AUD tag from step 4 |
| `ALLOWED_EMAILS` | the same emails as the Access policy, comma-separated |

The server checks these on every save as well, so the data stays private even if
Access is ever switched off. If any are missing it refuses all requests.

Then **Deployments → Retry deployment** (or push to `main`) so the settings apply.

Check it: open the address in a private window. You should see a Cloudflare sign-in
page, not the app.

## 6. Move your mum's entries across
On her phone:
1. Open the **old** app (the GitHub Pages one) → History → **Export backup**.
2. Open the new address in Chrome, enter her email, then the code from her inbox.
3. History → **Import backup**, pick the file you just saved.
4. Install the new app (⋮ → Install app) and remove the old one from her home screen.

Under the Day page she should now see **"Saved and backed up ✓"**.

Once that's done, turn off the old site: GitHub repo → Settings → Pages → Unpublish
(or set Source to None).

## What she'll see
- **Saved and backed up ✓**: everything is in the cloud.
- **Saved on this phone · will back up when online**: no signal; it catches up by itself.
- **Saved on this phone · tap here to sign in and back up**: her monthly sign-in ran
  out. Tapping it shows the email-code screen again. Nothing is lost meanwhile.

## Getting data back
- **New or reset phone**: open the address and sign in; everything downloads.
- **Something got overwritten**: D1 → `daily-tracker` → **Time Travel** restores the
  whole database to any minute in the last 7 days.
- **Older than that**: the `snapshots` table keeps a full copy of the tracker as it
  was at the start of each day it was used. In D1 → Console:
  `SELECT taken_on FROM snapshots ORDER BY taken_on DESC;` then
  `SELECT data FROM snapshots WHERE taken_on = '2026-10-01';` gives a JSON copy.
  Save it as `{"days": <that JSON>}` in a `.json` file and use History → Import backup.
