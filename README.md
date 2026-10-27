# Dylan's apps

A home for independent apps in one repository. The app directory is hosted at
**https://dylanschneider.github.io/**. Each published app gets its own URL at
`https://dylanschneider.github.io/apps/<slug>/`.

## Repository layout

```text
apps/
  halloween-party/       Reusable Halloween app, currently offline
    assets/
    supabase/            Database schema and migrations, not published
    config.js
    index.html
    party.html
    admin.html
    README.md
apps.json               App directory and explicit publishing list
site/                   Shared homepage and 404 page
scripts/                Site builder, checks, and annual tagging helper
.github/workflows/      GitHub Pages deployment
```

## Halloween archive

The 2026 Alice in Wonderland app is preserved in two ways:

- [`apps/halloween-party/`](apps/halloween-party/) is the working app folder.
  Keep improving this same folder for future years.
- The annotated tag [`2026_AliceInWonderland`](https://github.com/DylanSchneider/DylanSchneider.github.io/tree/2026_AliceInWonderland)
  points to `6918ec5d054fd89e25a38643452121dd90bd11b6`, the exact deployed version
  before the repository was reorganized. Paths in that tag are at the repo root.

Halloween has `published: false`. Its pages, JavaScript, config, assets, and SQL
are excluded from the deployed site. Old `/admin.html` and `/party.html` URLs
show the site's 404 page. This retires the frontend; it does not disable the
Supabase API or remove any database records or Storage objects.

**Git archives code, not party data.** Guests, votes, replies, costumes, and photos
remain in Supabase. Keep database exports and downloaded photos in private
storage, outside this public repo. No database reset is part of archiving.

## Add another app

1. Create `apps/my-app/` with an `index.html` and its assets. Use relative URLs
   inside the app, such as `assets/app.css`, so it works at its own subpath.
2. Add an entry to [`apps.json`](apps.json):

   ```json
   {
     "slug": "my-app",
     "name": "My app",
     "description": "What this app does.",
     "published": true,
     "files": ["index.html", "assets"]
   }
   ```

3. Build and preview, then commit and push to `master`. GitHub Actions publishes
   the app at `/apps/my-app/` and adds an **Open app** link to the homepage.

Only paths in `files` are copied for published apps. List browser assets, never
SQL, private exports, credentials, or server source. The builder rejects hidden
files, symlinks, and non-web file types. For a compiled frontend, add its build
command to the workflow first, and place or copy the output into the app folder
with `index.html` at its root. Server code needs a separate backend, as the
Halloween app uses Supabase.

Setting `published` to `false` removes an app from the next deployment while
keeping its source. The homepage displays it as archived. An optional
`edition` labels the version, and `archive_tag` links to its frozen code.

GitHub Pages and this repository are public. Apps needing private data must
enforce authentication and access rules in their backend. Apps on this domain
share an origin; prefix browser-storage keys with the app name.

## Build and preview locally

Python 3 is the only build dependency; there are no packages to install.

```powershell
python -m unittest discover -s scripts -p 'test_*.py'
python scripts/build-site.py
python -m http.server 8000 --bind 127.0.0.1 --directory _site
```

Open `http://localhost:8000`. `_site/` is generated and ignored by Git.
To preview the archived app directly, serve `apps/halloween-party/` instead.
Its existing config still connects to the 2026 database; use blank Supabase
settings in an uncommitted local copy for isolated demo testing.

## Hosting

GitHub Pages uses **GitHub Actions** as its publishing source. The
[`Publish apps`](.github/workflows/pages.yml) workflow checks and builds every
push and pull request targeting `master`; only `master` deploys. It uploads
`_site/`, never the whole repository. Keep **Settings → Pages → Source** set to
**GitHub Actions** so archived app source stays outside the hosted website.

This follows GitHub's [custom Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Next Halloween

Use the same [`apps/halloween-party/`](apps/halloween-party/) folder for the next
theme and improvements. Add a new party ID in Supabase without editing or
resetting 2026, update that app's config, test it, then set `published: true`.
The guest URL will be `/apps/halloween-party/`; update invitations and QR codes.
See the [app guide](apps/halloween-party/README.md) and
[release workflow](VERSIONING.md) for details.
