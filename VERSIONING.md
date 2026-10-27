# Apps and annual releases

`master` holds the current source for every app. Each app lives in
`apps/<slug>/`; [`apps.json`](apps.json) decides which ones are published.
There are no year-specific app folders or permanent branches. Reuse the
Halloween folder each year, and use tags for frozen annual versions.

## 2026 archive

| Item | Value |
| --- | --- |
| App | `apps/halloween-party/` |
| Theme | Alice in Wonderland |
| Annotated tag | `2026_AliceInWonderland` |
| Deployed commit | `6918ec5d054fd89e25a38643452121dd90bd11b6` |
| Hosting status | Archived; excluded from the website |

The tag was created before moving the files, so the historical app lives at
the repository root in that version. Current app files live in the folder
above. A tag snapshots the entire repo, including any other apps present at
that commit. It does not snapshot Supabase data or uploaded photos.

Inspect the old version without switching your working tree:

```powershell
git show 2026_AliceInWonderland
git show 2026_AliceInWonderland:config.js
git ls-tree -r --name-only 2026_AliceInWonderland
```

To create a separate checkout inside the ignored experiments folder:

```powershell
git worktree add --detach r-and-d/halloween-2026 2026_AliceInWonderland
```

## Next year

1. Develop in `apps/halloween-party/`, on a feature branch if useful. Change
   the theme and functionality there; leave the 2026 tag untouched.
2. Test against demo mode or a separate test backend while developing.
3. Insert a new `parties` row in Supabase for the new year. Preserve existing
   guests and all 2026 records and photos. See the app README for an example.
4. Update `PARTY_ID`, `PARTY_YEAR`, `PARTY_TITLE`, and the fallback deadline in
   `apps/halloween-party/config.js`. Disable the frontend test reset and the
   database's `testing_reset_enabled` flag before the event.
5. Update the app's `edition` in `apps.json`, set `published: true`, and test
   `_site/apps/halloween-party/`. Push to `master` to deploy. The prior
   `archive_tag` may remain until the new event is archived; it isn't shown
   while the app is published.
6. After the party, confirm the intended commit deployed successfully and
   tag it **before** changing the app or taking it offline:

   ```powershell
   ./scripts/archive-season.ps1 -Year 2027 -Theme 'NextTheme' -Push
   ```

7. Set `published: false`, update `archive_tag` to `2027_NextTheme`, and push
   those changes to take the app offline again.

## Tagging safely

`archive-season.ps1` creates an annotated `<year>_<theme>` tag. It refuses
uncommitted changes, existing tags, and failed Git operations. Without
`-Push`, it only creates a local tag and prints the command to push it later.
It never commits files or resets data. Do not move or overwrite annual tags.

```powershell
./scripts/archive-season.ps1 -Year 2027 -Theme 'NextTheme'
git push origin refs/tags/2027_NextTheme
```

## Hosting and data

The publishing workflow builds the homepage plus apps explicitly marked
`published: true`. Tags are historical references and never trigger a
deployment. A push to `master` deploys the whole selected collection.

Keep secrets, private exports, and downloaded party photos outside the public
repository. The code archive leaves the live Supabase database and Storage
untouched. Take separate private backups if you want an event-data snapshot.
