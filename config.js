/* =====================================================================
   Party config — this is the only file you need to edit each year.

   Leave SUPABASE_URL and SUPABASE_ANON_KEY blank to run the app in
   DEMO MODE: the whole thing works on your phone using local browser
   storage, so you can try the flow before setting up the database.
   Nothing is shared between phones in demo mode.

   Setup instructions are in README.md.
   ===================================================================== */

window.PARTY_CONFIG = {
  // Supabase → Project Settings → Data API → Project URL
  // e.g. 'https://abcdefghijklm.supabase.co'
  SUPABASE_URL: '',

  // Supabase → Project Settings → API Keys → anon / public key.
  // This key is meant to be public. Every table is locked by RLS and the
  // party rules are enforced in the database, not here.
  SUPABASE_ANON_KEY: '',

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
