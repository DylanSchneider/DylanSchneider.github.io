# Archived hero-quality 3D tunnel

This folder preserves the complete newest procedural tunnel implementation
from commit `e70d15f` before the site returned to the original v2 homepage.

It is intentionally outside the website's active paths. Nothing in the live
HTML references this folder.

The snapshot includes the tunnel scene, loader, procedural geometry factories,
homepage integration, tunnel styles, fallback poster, browser smoke tests, and
implementation notes. The removed legacy `assets/js/rabbit-fall.js` renderer
was restored from the previous commit when the original v2 was brought back;
the v3 implementation itself remains available here and in Git history.

To revisit it later, restore the archived integration files together with the
matching scene files, or use commit `e70d15f` as the starting point.
