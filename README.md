# 🎃 Halloween Costume Contest

A phone-first web app for the party: guests scan a QR code, check in with
their name and phone number, enter their costume (solo or group), and vote
for the best one. You get a private host page with live results and a
countdown you control.

Live at whatever URL GitHub Pages serves this repo from (Settings → Pages).

## How it works for guests

1. **Check in** — real name + phone number. This builds a master guest list
   that persists across years.
2. **Enter a costume** — name, an optional photo, and (optional) the real
   names of anyone else in the group. A group costume is voted on as one
   entry; only one person in the group needs to enter it.
3. **Vote** — one vote per person, changeable until the deadline. You can't
   vote for your own costume (solo or group). Results stay hidden until
   voting closes, when the countdown flips the page over to show them.

## The host page (`admin.html`)

PIN-gated. Shows live vote counts (even while hidden from guests), the
master guest list with a "voted?" column, a CSV export, controls to push
the deadline or reveal results early, and the ability to delete a bad entry.
After the deadline it needs no PIN — anyone (i.e. you) can open it and see
the winner.

## One-time setup (Supabase — free)

The app needs somewhere to store guests, costumes, and votes. It's built
for [Supabase](https://supabase.com) (a free hosted Postgres + file
storage), and works from GitHub Pages with no server of your own.

1. **Create a project** at supabase.com (free tier is plenty for a house
   party).
2. Open **SQL Editor** in the Supabase dashboard, paste the entire contents
   of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. This
   creates every table, locks them all down with row-level security, and
   creates the guest/vote/photo functions the app calls. It also seeds one
   party row — edit the two marked lines at the bottom of that file first
   (the voting deadline and your admin PIN) if you want to set them at
   creation instead of from the host page later.
3. Open **Project Settings → Data API** and copy the **Project URL**.
   Open **Project Settings → API Keys** and copy the **anon / public** key.
   (This key is meant to be public — every table is locked by row-level
   security and the party rules live in the database functions, not in the
   browser.)
4. Paste both into [`config.js`](config.js):
   ```js
   SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
   SUPABASE_ANON_KEY: 'eyJ...',
   ```
5. Commit and push. GitHub Pages redeploys automatically.

Until you do this, the site runs in **demo mode**: fully clickable on one
phone, but nothing is shared between phones and no votes are real. A banner
says so on every page in that mode.

## Changing the party each year

Everything year-specific lives in [`config.js`](config.js):

- `PARTY_ID` — must match a row id in the `parties` table. To start a new
  year without losing old guests, insert a new party row (see the SEED
  block in `supabase/schema.sql` for the shape) and bump `PARTY_ID` to
  match. The master guest list (`guests` table) is shared across every
  `PARTY_ID`.
- `PARTY_TITLE` / `PARTY_YEAR` — shown in the header.

The voting deadline and admin PIN live in the database, not in this repo —
change them from the host page (`admin.html`) any time, no redeploy needed.

## Files

| Path | What it is |
|---|---|
| `index.html` / `assets/js/app.js` | The guest-facing app: check in → costume → vote |
| `admin.html` / `assets/js/admin.js` | The PIN-gated host page |
| `assets/js/store.js` | All data access — Supabase REST calls, plus the localStorage demo-mode fallback |
| `assets/css/app.css` | Shared mobile-first styling for both pages |
| `config.js` | The only file you edit per party/year |
| `supabase/schema.sql` | Paste-once database setup |

## Design notes

- No build step, no npm — plain HTML/CSS/JS so GitHub Pages serves it as-is.
- No frontend framework or CDN dependency; talks to Supabase over its plain
  REST endpoints so there's nothing to download on spotty party wifi.
- Every party rule (one vote each, no self-voting, results hidden until
  close, PIN-gated admin actions) is enforced in Postgres functions, not
  just in the browser — a guest editing the page's JS can't cheat.
- Photos are resized to ~1400px on the phone before upload, so a 10MB
  camera photo becomes a few hundred KB.
- Tap targets, type sizes, and layout are tuned for one-handed phone use in
  a dark room; the countdown clock's numbers come from the Supabase
  server clock, not the phone's, so a wrong device clock can't lie about
  when voting closes.
