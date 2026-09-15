/* =====================================================================
   Party config — this is the only file you need to edit each year.

   Leave SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY blank to run the app in
   DEMO MODE: the whole thing works on your phone using local browser
   storage, so you can try the flow before setting up the database.
   Nothing is shared between phones in demo mode.

   Setup instructions are in README.md.
   ===================================================================== */

window.PARTY_CONFIG = {
  // Supabase → Project Settings → Data API → Project URL.
  // Just the bare origin — no /rest/v1 on the end, the app adds that itself.
  // e.g. 'https://abcdefghijklm.supabase.co'
  SUPABASE_URL: 'https://dxwbyqazbozpkyygcgnv.supabase.co',

  // Supabase → Project Settings → API Keys → Publishable key (starts with
  // "sb_publishable_"). This is the new name for what used to be called the
  // "anon" key — it's meant to be public. Every table is locked by RLS and
  // the party rules are enforced in the database, not here. An older
  // project's legacy "anon" key (a long eyJ... JWT) works here too.
  SUPABASE_PUBLISHABLE_KEY: '',

  // Must match the party row id in the database (the SEED block in schema.sql).
  PARTY_ID: '2026',

  // Shown in the header.
  PARTY_TITLE: 'Halloween',
  PARTY_YEAR: '2026',

  // Only used in demo mode, and as a placeholder while the real close
  // time is still loading. The database is the source of truth.
  FALLBACK_CLOSES_AT: '2026-10-24T22:00:00-04:00',

  // Longest edge of an uploaded photo, in pixels, after phone-side resizing.
  PHOTO_MAX_EDGE: 1400,
  PHOTO_QUALITY: 0.82
};
