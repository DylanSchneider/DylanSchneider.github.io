# The rabbit-hole homepage

The normal homepage is the Three.js scene, including on the old `?v2=1` URL.
Scroll or swipe to travel; the invitation dialog appears at the final doorway
if the guest has not checked in. “Your invitation” opens it earlier. “Skip
journey” provides the short fade route. Returning guests still follow the
existing saved-session routing.
Use `?replayTunnel=1` to replay the opening with an existing saved guest; their
details are prefilled without deleting the saved session.

## Code and ownership

- `rabbit-v2-loader.js`: eagerly imports the scene; creates the fixed canvas
  host, invitation dialog and overlays; supplies the independent fallback.
- `rabbit-v2.js`: camera choreography, a single progress controller, one RAF
  scheduler, ScrollTrigger, lighting, quality and lifecycle.
- `tunnel-world.js`: solid procedural architecture and prop factories. No
  raster scenery, video, canvas-2D textures or billboard architecture.
- `tunnel.css`: minimal controls, full viewport layout, dialog and overlays.
- `app.js`: validates the existing check-in, guards duplicate submissions,
  captures the current transition controller, and activates the existing
  costume view only after both check-in and blackout finish.

The obsolete `rabbit-fall.js` renderer has been removed. The old sentinel
submission handler in `wonderland.js` is disabled on this homepage.

## Camera and transition

One position spline spans approximately 107.5 metres. A separate authored
target spline anticipates the next room and glances toward hero objects.
An up vector transported along the route avoids the vertical-shaft flip;
roll is sampled deterministically from authored milestones.

One ScrollTrigger tween scrubs progress through 0–0.92 over 7,500 CSS pixels
with 0.35-second smoothing. The canvas stays fixed; its DOM node never moves.
A native-scroll implementation remains available if GSAP fails to load.

At the scrubbed 0.92 pose, scroll control relinquishes ownership. If check-in
is needed, the invitation dialog holds the shot. Submission captures the
camera position, quaternion and target. The same camera follows the remaining
spline with an accelerating time mapping, travelling about 18.3 metres.
The cut-out keyhole is at 0.966; the route continues roughly ten metres beyond
it. The ivory flash follows physical crossing, black covers the destination
switch, then a 250ms fade reveals the costume UI. The fall reaches blackout
at 1.25 seconds and hands control to the app at 1.35 seconds. Slow network
responses hold black with a status message.

Only `frame()` advances scene animation. Hidden tabs stop the renderer and
freeze cinematic time. Completion stops RAF and scroll updates. Geometry is
retained for the existing Back button; reentry resets the tween and progress.
WebGL context loss or a switch to reduced motion disposes GPU resources and
uses the accessible fallback. Shared geometries/materials are disposed once.

## Scene and replacement assets

Named `ENV_*` roots contain architecture; `LOC_*` roots hold world placement;
`PROP_*` roots contain sculptures. Moving door leaves use explicit hinge
bindings. Card bodies, engraved borders and raised suits are instanced solid
geometry. Static procedural submeshes are batched by material inside their
replaceable roots. This baker is only for procedural meshes: it deliberately
does not preserve UVs, skins or animation clips.

The looking glass has a thick ornamented frame. Its dark convex surface
slides aside as the camera approaches, so the camera passes through an actual
opening. The rabbit crosses behind a physical doorway. The final keyhole is
cut out of an extruded slab, with recessed ribs and a continuing shaft behind.

Future assets belong in `assets/models/`: `rabbit.glb`, `keyhole_door.glb`,
`pocket_watch.glb`, `cards.glb`, `teapot.glb`, `chess.glb`, `mushrooms.glb`,
`looking_glass.glb`, `lantern.glb`, `crooked_arch.glb`, or a consolidated
`alice_tunnel_v01.glb`. Replace factory visuals, preserving metre scale,
placement roots, +Z-facing convention, and explicitly named animation pivots.
Do not batch imported models through the procedural baker. Rebind a replaced
door hinge or mirror surface explicitly; don't rely on child order. No GLB
is requested until supplied, so missing future models cannot break this build.

## Quality and accessibility

HIGH uses DPR up to 1.75, 60 cards and 500 particles. MEDIUM uses DPR up to 1.5,
48 cards and 280 particles. LOW uses DPR 1, 32 cards, 140 particles, fewer
arches/secondary props and one local light. A low hemisphere contribution and
two moving pools of light reveal shapes without shadow maps or postprocessing.
Frustum and distance culling avoid drawing distant detail; fog alone does not
reduce draw calls. Sustained frames under 32 FPS step down secondary quality.
Phones default to real 3D MEDIUM, not a static fallback.

Reduced motion, unavailable WebGL and module-load failure use a local static
entrance and 180ms fades. Optional `PARTY_CONFIG.TUNNEL_POSTER` may point to
`assets/fallback/tunnel_poster.webp`; otherwise the included vector poster is
used **only in fallback mode**. It is never normal 3D scenery.

Debug: `?debugTunnel=1`; optional `&tunnelHelpers=1` shows both camera curves.
Force a tier with `&tunnelQuality=high`, `medium`, `low`, or `fallback`.
The debug overlay reports FPS, mode, progress, camera/target, draw calls and
triangles. The debug object is absent on normal production URLs.

## Local verification

Run `node tests/tunnel-smoke.cjs` with Playwright installed, or pass its module
directory as the first argument. The script serves the repository locally,
replaces config with demo settings, and blocks Supabase requests. Screenshots
go to ignored `.tmp/tunnel-tests/`.

Checks cover portrait widths 320/375/390/430, orientation changes, reverse
scroll, fast scroll, exact captured pose and object identity, real doorway
crossing, activation under black, stopped rendering, reentry, failed check-in
and retry, saved-session routing, reduced motion, WebGL/CDN/GSAP failures,
LOW quality and context loss during the fall.

Headless Chromium uses software rendering for reproducibility. Its FPS is
not a real-device performance guarantee. Final phone testing should assess
touch momentum, GPU frame rate, and the watch/door near passes. The procedural
models are complete working stand-ins; production GLBs remain the next visual
upgrade, particularly the rabbit, ornamented architecture and teapot.

Measured in the local 390×844 MEDIUM software-rendering run: sampled shots
ranged from 11–114 draw calls and 20,204–71,412 triangles, with approximately
20–60 FPS after shader warm-up. These are development-machine measurements,
not mobile GPU measurements. All listed functional checks passed, including
zero position discontinuity at capture, matching camera/canvas identity,
18.29 metres of autonomous travel, and zero queued render frames after exit.
