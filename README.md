# 🎃 Halloween Costume Contest

A phone-first web app for the party: guests scan a QR code, check in with
their name and phone number, enter their costume (solo or group), and vote
for the best one. You get a private host page with live results and a
countdown you control.

Live at whatever URL GitHub Pages serves this repo from (Settings → Pages).

## How it works for guests

1. **Check in** — real name + phone number. This builds a master guest list
   that persists across years.
2. **Enter a costume.** Three ways in:
   - **Going solo** — just a costume name and a required photo.
   - **Starting a group** — a group name (e.g. "Alice in Wonderland") and
     your own individual costume/role within it (e.g. "Mad Hatter"), plus
     a photo for the whole group.
   - **Joining a group** — see everyone already entered on your check-in
     screen; tap "Join" on your group and enter your own costume/role
     (e.g. "White Rabbit"). No need to know who's starting it in advance —
     whoever gets there first starts it, everyone else joins.
   A group is voted on as one entry no matter how many people are in it.
   Anyone can edit their own costume name later, the group's starter can
   rename the group or change its photo, and anyone can leave to switch
   groups (the group's starter can only leave if no one else has joined).
3. **Vote** — one vote per person, changeable until the deadline. You can't
   vote for your own costume, solo or group (nor for anyone else in your
   group). Results stay hidden until voting closes, when the countdown
   flips the page over to show them.
4. **Take party photos** — after checking in, open **Party photos** from the
   menu. The camera page makes a normal copy and a film-look copy of each
   candid photo, uploads both, and provides explicit save links for the phone.

## The host page (`admin.html`)

PIN-gated. Shows live vote counts (even while hidden from guests), the
master guest list with a "voted?" column, a CSV export, controls to push
the deadline or reveal results early, the ability to delete a bad entry, a
PIN-protected party-photo download section, and a PIN-protected "Clear all
testing data" control for pre-party testing.
After the deadline it needs no PIN — anyone (i.e. you) can open it and see
the winner.

The testing reset clears the selected party's attendance, entries,
entry-members, votes, party-photo records, and guests who are not associated
with another party. It does not remove uploaded Storage objects, so delete
test photos from the Supabase Storage dashboard when needed.
It leaves party settings intact. Set `ENABLE_TEST_RESET: false` in
[`config.js`](config.js), and set `testing_reset_enabled = false` on the
party row in Supabase, before the event.

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
3. Open **Project Settings → Data API** and copy the **Project URL** (just
   the bare `https://xxxxxxxx.supabase.co` — no `/rest/v1` on the end).
   Open **Project Settings → API Keys** and copy the **Publishable** key
   (starts with `sb_publishable_`; this is Supabase's current name for what
   used to be called the "anon" key — an older project's legacy `anon` key,
   a long `eyJ...` JWT, works here too). This key is meant to be public —
   every table is locked by row-level security and the party rules live in
   the database functions, not in the browser.
4. Paste both into [`config.js`](config.js):
   ```js
   SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
   SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_...',
   ```
5. Commit and push. GitHub Pages redeploys automatically.

Until you do this, the site runs in **demo mode**: fully clickable on one
phone, but nothing is shared between phones and no votes are real. A banner
says so on every page in that mode.

## Multi-year usage

This is meant to be reused every year (it's on its 5th annual as of 2026) —
both the app and the underlying data are designed around that.

### What persists automatically, in the database

Nothing here needs any yearly reset — it's all already keyed by `party_id`
so old years are simply never touched by a new one:

- **`guests`** — the master list of real name + phone number, one row per
  person, forever. This is also your **invite list**: `admin_guests` /
  the CSV export on the host page pulls every guest who has ever attended,
  with a `years` column showing which parties (`party_id`s) they were at.
- **`entries` + `entry_members`** — every costume and group, every year,
  with each guest's own individual costume/role inside it. Since these are
  linked to a specific guest (not just a name), this is a real per-guest
  costume history, not just free text. There's a ready-made query for it —
  `admin_guest_history(pin, guest_id)` — for whenever you want to build a
  "what was I last year?" view; it's not wired into the host page yet.
- **`attendance`** — who actually showed up each year (vs. just being on
  the invite list from a prior year).
- **Costume photos** — each costume entry keeps a normal JPEG and a film-look
  JPEG in the `costumes` Storage bucket. They are resized to a maximum edge of
  2800 pixels, which is suitable for ordinary 8×11 prints while still being
  reasonable for phone gallery cards.

Party candids are intentionally separate from the durable costume/history
data:

- **`party_photos`** — lightweight metadata for the temporary party-photo
  wall. The image files live in the `party-photos` Storage bucket, with both
  normal and film versions. After the party, use the host page's download
  links to save the versions you want to your computer, then remove the
  temporary files from Storage. This bucket is public while it is in use so
  the photo wall can load for checked-in guests. The guest photo wall and
  upload API close at the party deadline; treat the download-and-delete step
  as the end of the online life of those photos.

The browser cannot silently write into a phone's Photos library. The app
therefore gives the person who took each photo clear **Save normal** and
**Save film** actions. On iPhone, the browser may show the normal share/save
sheet; that extra tap is required by the phone's security model.

**`votes` is the one table that's deliberately *not* meant to be kept
forever** — it's per-party ballots, not part of anyone's personal record.
Once you've read a year's winner off the host page, it's safe to clear that
year's votes from the Supabase SQL Editor if you'd rather not keep a
permanent log of who voted for what:

```sql
delete from public.votes where party_id = '2026';
```

(Entries and guests are untouched by this — only the ballots.)

### Starting a new year

1. In the Supabase SQL Editor, insert a new party row rather than editing
   the old one — this is also in a comment at the bottom of
   `supabase/schema.sql`:
   ```sql
   insert into public.parties (id, name, voting_closes_at, admin_pin)
   values ('2027', 'Halloween 2027',
           (timestamp '2027-10-30 22:00') at time zone 'America/Denver',
           '2468')
   on conflict (id) do nothing;
   ```
2. Bump `PARTY_ID` (and `PARTY_TITLE`/`PARTY_YEAR`) in [`config.js`](config.js)
   to match, commit, and push.
3. That's it — `guests` carries over automatically; `entries` starts empty
   for the new `party_id` so last year's costumes don't show up as this
   year's entrants.

### Archiving each year's code

The app itself (this repo) will keep evolving year to year, so it's worth
snapshotting what was actually live for a given party. This repo doesn't
use separate deploy branches (GitHub Pages for a user site like this one
only serves a single branch), so the convention is: keep building on
`master`, and tag the commit that was live on party night.

```sh
git tag party-2026
git push origin party-2026
```

That gives you a permanent pointer (`git show party-2026`, or
`git checkout party-2026` to look at it) to exactly what guests used that
year, without branching your ongoing work. [`scripts/archive-season.ps1`](scripts/archive-season.ps1)
does the same thing — run it after the party with the year as the argument:

```powershell
./scripts/archive-season.ps1 2026
```

### The admin PIN and voting deadline

These live in the database, not this repo, so they don't need a redeploy —
change them any time from the host page (`admin.html`), or directly in
Supabase.

## Files

| Path | What it is |
|---|---|
| `index.html` / `assets/js/app.js` | The guest-facing app: check in → costume → vote |
| `party.html` / `assets/js/party.js` | The separate temporary party camera and photo wall |
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
- Photos are resized to a maximum 2800px edge on the phone before upload.
  Each upload gets a normal JPEG and a film-look JPEG; this keeps the files
  useful for ordinary 8×11 prints without sending original 10MB camera files
  to the server.
- Tap targets, type sizes, and layout are tuned for one-handed phone use in
  a dark room; the countdown clock's numbers come from the Supabase
  server clock, not the phone's, so a wrong device clock can't lie about
  when voting closes.
