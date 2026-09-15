# Version Control Strategy

This document describes how this repository handles versions, branches, and releases across multiple party years.

## One Deployed Branch: `master`

This project uses **GitHub Pages for a personal user site**, which only serves a single branch. There's no separate `deploy` or `staging` branch — `master` is both the development and production branch.

**Benefit:** Simpler workflow. Commit → push → deployed in seconds.  
**Responsibility:** Test thoroughly before pushing to `master`.

## No Year-Specific Branches

Unlike many projects, we don't create `halloween-2026`, `halloween-2027`, etc. branches. Why?

1. **Database is already keyed by year.** The `party_id` in the database is the real year separator. The code itself doesn't change between years — only config and database state change.
2. **Code evolves forward.** New features, bug fixes, and improvements accumulate on `master` where everyone sees them. You don't need to backport.
3. **History is simpler.** One continuous timeline from 2022 → 2026 → 2027 is easier to navigate than many parallel branches.

## Tagging Each Year's Snapshot

Instead of branches, **each year gets a git tag**: `party-2026`, `party-2027`, etc.

A tag is a **frozen pointer** to the exact commit that was live when guests used the app that night. Tags live forever and take up almost no space.

### Creating a Tag (After the Party)

Once the party is done and you've recorded the winner, archive that year's code:

```powershell
./scripts/archive-season.ps1 2026
```

This creates a lightweight annotated tag `party-2026` pointing to `HEAD` with a message, and pushes it to origin. You can also create it manually:

```bash
git tag -a party-2026 -m "Halloween 2026 - snapshot of the site as deployed for the party"
git push origin party-2026
```

### Using a Tag Later

To see exactly what code was live in 2026:

```bash
git show party-2026              # view commit info
git checkout party-2026          # check out that version (read-only state)
git log party-2026 --oneline    # see all commits up to that point
```

To compare 2026 vs 2027:

```bash
git diff party-2026 party-2027  # what changed between years
```

## Commit Message Style

Keep commits **clear and focused**. Each commit should be one logical change:

- `Fix card float animation on hover` — good, specific.
- `Update colors` — vague; should be `Reskin from Halloween to Alice in Wonderland theme`.
- `Stuff` — never acceptable.

Use imperative mood: "Add X" not "Added X". Format:

```
One-line summary under 70 chars

Optional longer explanation if the change is non-obvious.
Reference issue numbers or prior commits if relevant.
```

Example:

```
Refactor group costume joining to use entry_members table

Replaced the old member_names text array with a proper relational
model so each guest has their own row describing their costume/role
within a group, not just free text names. This also doubles as the
persistent costume history for next year's invite list.

See: commit f8ba9ff for the schema migration.
```

## Keeping Personal Config Out of Git

Never commit:

- `secrets.local.md` (real Supabase credentials) — **gitignored**
- `.env` or `.env.local` — **gitignored**
- Database passwords in any form

These are in `.gitignore` for a reason. If you accidentally commit a credential, **rotate it immediately** from Supabase → Project Settings → Database → Reset password.

## Multi-Year Data Model

The **database is designed to remember everything**:

- **`guests`**: never deleted. Persists across parties. Use for invite lists next year.
- **`entries` + `entry_members`**: costume history. "What did Dylan wear in 2025?" is one SQL query.
- **`attendance`**: who showed up each year.
- **`votes`**: **optional to keep**. These can be purged after results are recorded (see README for the cleanup query).

The **code, however, evolves forward**. Don't keep branches per year; just tag the exact version that was live.

## Workflow Summary

1. **During development** (months before the party):
   - Branch off `master` for large features: `git checkout -b feature/group-costumes`
   - Push to origin to share/backup
   - Open a pull request when ready for review
   - Merge back to `master` when done

2. **Before the party**:
   - Make sure `master` is tested and stable
   - Push to deploy

3. **After the party**:
   - Run `./scripts/archive-season.ps1 2026` to tag this year's exact code
   - Optionally clean up votes if you don't want a permanent record: `delete from public.votes where party_id = '2026'`

4. **Next year**:
   - Development continues on `master` (new features, bug fixes, etc.)
   - Update `PARTY_ID` in `config.js` to `'2027'`
   - Supabase: insert a new row into the `parties` table for 2027
   - Push and deploy
   - After the party, tag again: `party-2027`

## Force Push? Never (Usually)

`git push --force` is dangerous on a shared or deployed branch. If you need to rewrite history:

1. Check that no one else is pulling from it
2. Use `--force-with-lease` instead: it fails if someone pushed in the meantime
3. Strongly prefer creating a new commit instead

For this project, force-pushing `master` is never necessary. If you commit something wrong, just commit a fix on top.

## Branch Protection (GitHub Setting)

Consider enabling branch protection on `master`:

- Require pull request reviews before merge
- Require status checks (CI, tests) to pass
- Dismiss stale reviews when new commits are pushed
- Allow force pushes: **No** (you don't need them)

This prevents accidents and keeps the main branch stable.

## Squash vs. Merge

When merging a feature branch back to `master`:

- **Merge commit** (`git merge --no-ff`): Preserves branch history. Clearer if the feature is large or took many commits.
- **Squash** (`git merge --squash`): Collapses all commits into one. Cleaner history if the branch was just iterative work.
- **Rebase and merge** (`git rebase master && git merge --ff-only`): Linear history. Good for small focused features.

For this project, **merge commits** are fine. They show which commits were part of a feature and when it landed.

## Example: Adding a Feature and Tagging a Release

```bash
# Create a feature branch
git checkout -b feature/add-cheshire-cat-easter-egg
git commit -m "Add Cheshire Cat to card animations"
git commit -m "Update colors to match grin emoji"
git push origin feature/add-cheshire-cat-easter-egg

# Open PR, get reviewed, merge on GitHub

# Back on master (pull the merge)
git pull origin master

# Party happens, all works great
# Now freeze this version:
./scripts/archive-season.ps1 2026

# Later, start work on 2027
git checkout -b feature/accessibility-improvements
# ... continue development
```

## Reading Old Commits

Want to know what changed in that one commit?

```bash
git show f8ba9ff               # view full commit + diff
git show f8ba9ff --stat       # just the file stats
git log -p f8ba9ff^..f8ba9ff # same thing
```

Want to see who changed a specific line?

```bash
git blame assets/js/app.js   # every line with its author + commit
git blame -L 200,220 assets/js/app.js  # just lines 200-220
```

## References

- [Git Basics Docs](https://git-scm.com/book/en/v2/Git-Basics-Getting-a-Git-Repository)
- [GitHub Branch Protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)
- [Conventional Commits](https://www.conventionalcommits.org/) (optional but good style guide)
