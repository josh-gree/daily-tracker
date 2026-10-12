# My Daily Tracker — PWA

An installable, offline-first Android PWA for the "My Daily Tracker" CFS/health
worksheet. Plain HTML/CSS/JS, no build step.

Live: https://josh-gree.github.io/daily-tracker/

## What it does
- One entry per date (prev/next, date picker, "back to today").
- Morning and evening energy 1–10 (tap again to clear).
- Water glasses counter.
- Time slots (7AM breakfast, 10AM snack, 12 noon lunch, 2PM snack, 7PM dinner, 9PM),
  each with Nutrition / Rest-movement-activities / How I feel.
  The time slots are fixed. Tapping any note box (including the review questions)
  opens a pop-up editor; notes save as you type.
- Review: worked well / didn't work / focus for tomorrow.
- History: 14-day energy chart, list of logged days, JSON backup export/import, CSV export.
- Export as PDF: one A4 page per logged day in a date range (or "Export this day as PDF"
  on the Day tab), drawn in the style of the printed worksheet. On Android it opens the
  It downloads straight to the device. An empty day exports as a blank sheet for printing.
  Long days continue onto extra pages. Uses the built-in Helvetica font, so emoji are
  dropped and non-Latin scripts show as "?".
- About: the worksheet's intro and its example day.
- Data is stored in `localStorage` on the device only; it autosaves on every change.

## Files
`index.html`, `app.css`, `app.js`, `pdf-export.js` (PDF layout), `manifest.webmanifest`,
`sw.js` (network-first service worker with an offline cache — bump `VERSION` here and `APP_VERSION` in `app.js` after changing any file), `icons/`,
`vendor/pdf-lib.min.js` ([pdf-lib](https://pdf-lib.js.org) 1.17.1, MIT, loaded only when exporting).

## Run locally
    python3 -m http.server 8000   # then open http://localhost:8000

## Install on Android
A PWA must be served over HTTPS. Host this folder on any static host (GitHub
Pages, Netlify Drop, Cloudflare Pages), open the URL in Chrome on the phone,
then tap **Install** in the app bar (or ⋮ → *Add to Home screen* / *Install app*).
