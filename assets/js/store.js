/* =====================================================================
   Data layer.

   Talks to Supabase over its plain REST endpoints — no SDK, no CDN, so
   there is nothing extra to download on flaky party wifi.

   If config.js has no Supabase credentials, everything below falls back
   to DEMO MODE against localStorage so the full flow is clickable.
   ===================================================================== */

const CFG = window.PARTY_CONFIG || {};

export const PARTY_ID = CFG.PARTY_ID || '2026';
export const IS_LIVE = Boolean(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);

const BASE = String(CFG.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = CFG.SUPABASE_ANON_KEY || '';
const BUCKET = 'costumes';


/* ── Supabase REST ───────────────────────────────────────────────────── */

function authHeaders(extra) {
  return Object.assign({ apikey: KEY, Authorization: `Bearer ${KEY}` }, extra || {});
}

async function rpc(fn, params) {
  if (!navigator.onLine) {
    throw new Error('You look offline. Check your wifi and try again.');
  }

  let res;
  try {
    res = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify(params || {})
    });
  } catch {
    throw new Error('Could not reach the server. Check your wifi and try again.');
  }

  const raw = await res.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { /* non-JSON error page */ }

  if (!res.ok) {
    const msg = (body && (body.message || body.error_description || body.error || body.hint))
      || raw
      || `Request failed (${res.status}).`;
    throw new Error(friendlyError(String(msg), res.status));
  }
  return body;
}

// Turn database/PostgREST noise into something a guest can act on.
function friendlyError(msg, status) {
  if (/Could not find the function|does not exist/i.test(msg)) {
    return 'The database is not set up yet — run supabase/schema.sql in the Supabase SQL editor.';
  }
  if (/Unknown party/i.test(msg)) {
    return `No party row for "${PARTY_ID}". Check PARTY_ID in config.js against the database.`;
  }
  if (/JWT|apikey|Invalid API key/i.test(msg) || status === 401) {
    return 'The Supabase key in config.js is not valid.';
  }
  if (/duplicate key|unique constraint/i.test(msg)) {
    return 'That was already saved.';
  }
  return msg.replace(/\s*\(SQLSTATE.*\)$/, '');
}


/* ── Photos ──────────────────────────────────────────────────────────── */

/** Public URL for a stored photo (or the data URL itself, in demo mode). */
export function photoUrl(path) {
  if (!path) return '';
  if (path.startsWith('data:') || path.startsWith('http')) return path;
  return `${BASE}/storage/v1/object/public/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

async function decode(file) {
  // createImageBitmap honours EXIF rotation, so photos taken sideways on a
  // phone come out the right way up. Older Safari needs the <img> fallback.
  if (window.createImageBitmap) {
    try {
      return { src: await createImageBitmap(file, { imageOrientation: 'from-image' }), free: (b) => b.close?.() };
    } catch { /* fall through */ }
    try {
      return { src: await createImageBitmap(file), free: (b) => b.close?.() };
    } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((ok, fail) => {
    img.onload = ok;
    img.onerror = () => fail(new Error("That file could not be read as an image."));
    img.src = url;
  });
  return { src: img, free: () => URL.revokeObjectURL(url) };
}

/**
 * Shrink a phone photo before it ever leaves the device: a 12MB HEIC/JPEG
 * off a modern camera becomes a ~200KB JPEG, which matters a lot when
 * thirty people upload at once over house wifi.
 */
export async function shrinkPhoto(file, maxEdge, quality) {
  maxEdge = maxEdge || CFG.PHOTO_MAX_EDGE || 1400;
  quality = quality || CFG.PHOTO_QUALITY || 0.82;

  const { src, free } = await decode(file);
  try {
    const w0 = src.width, h0 = src.height;
    if (!w0 || !h0) throw new Error('That image looks empty.');

    const scale = Math.min(1, maxEdge / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);

    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not process that photo.');
    return blob;
  } finally {
    try { free(src); } catch { /* nothing to free */ }
  }
}

function blobToDataUrl(blob) {
  return new Promise((ok, fail) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result);
    fr.onerror = () => fail(new Error('Could not read that photo.'));
    fr.readAsDataURL(blob);
  });
}


/* ── Remembered session (this phone) ─────────────────────────────────── */

const SESSION_KEY = `hp:${PARTY_ID}:me`;

export const session = {
  get() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  },
  set(me) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(me)); } catch { /* private mode */ }
  },
  clear() {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
  }
};


/* ── Demo mode ───────────────────────────────────────────────────────── */

const DEMO_KEY = `hp:${PARTY_ID}:demo`;

function demoRead() {
  let db;
  try { db = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); } catch { db = null; }
  if (!db) {
    db = {
      guests: [],
      entries: [],
      votes: {},
      closes_at: CFG.FALLBACK_CLOSES_AT || '2026-10-24T22:00:00-04:00',
      results_public: false
    };
  }
  return db;
}

function demoWrite(db) {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(db));
  } catch {
    throw new Error('This phone ran out of demo storage. Clear it from the menu, or set up Supabase.');
  }
}

const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const normPhone = (s) => {
  const d = String(s || '').replace(/\D/g, '');
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d;
};
const cleanText = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

const demo = {
  partyInfo() {
    const db = demoRead();
    const now = new Date();
    const closes = new Date(db.closes_at);
    return {
      id: PARTY_ID,
      name: `${CFG.PARTY_TITLE || 'Halloween'} ${CFG.PARTY_YEAR || ''}`.trim(),
      closes_at: db.closes_at,
      revealed: db.results_public || now > closes,
      open: now <= closes,
      server_now: now.toISOString(),
      entry_count: db.entries.length,
      guest_count: db.guests.length,
      vote_count: Object.keys(db.votes).length
    };
  },

  joinParty(name, phone) {
    const db = demoRead();
    const fullName = cleanText(name);
    const ph = normPhone(phone);
    if (fullName.length < 2 || !fullName.includes(' ')) throw new Error('Please enter your first and last name.');
    if (ph.length !== 10) throw new Error('Please enter a 10-digit US phone number.');

    let g = db.guests.find((x) => x.phone === ph);
    if (g) g.full_name = fullName;
    else { g = { id: uid(), full_name: fullName, phone: ph }; db.guests.push(g); }
    demoWrite(db);

    const entry = db.entries.find((e) => e.owner_id === g.id) || null;
    const listed = db.entries.find(
      (e) => e.owner_id !== g.id && (e.member_names || []).some((m) => normName(m) === normName(g.full_name))
    );

    return {
      guest: g,
      entry: entry && {
        id: entry.id, title: entry.title,
        photo_path: entry.photo_path, member_names: entry.member_names
      },
      voted_entry_id: db.votes[g.id] || null,
      listed_in: listed
        ? { id: listed.id, title: listed.title, owner_name: (db.guests.find((x) => x.id === listed.owner_id) || {}).full_name }
        : null
    };
  },

  async saveEntry(guestId, title, photoBlob, existingPath, members) {
    const db = demoRead();
    const t = cleanText(title);
    if (t.length < 2) throw new Error('Give your costume a name.');

    let path = existingPath || null;
    if (photoBlob) path = await blobToDataUrl(photoBlob);

    const me = db.guests.find((g) => g.id === guestId);
    const clean = [...new Set((members || []).map(cleanText).filter((m) => m.length > 1 && normName(m) !== normName(me?.full_name)))];

    let e = db.entries.find((x) => x.owner_id === guestId);
    if (e) Object.assign(e, { title: t, photo_path: path, member_names: clean });
    else { e = { id: uid(), owner_id: guestId, title: t, photo_path: path, member_names: clean }; db.entries.push(e); }

    demoWrite(db);
    return e;
  },

  listEntries(guestId) {
    const db = demoRead();
    const info = demo.partyInfo();
    const me = db.guests.find((g) => g.id === guestId);
    const myName = normName(me?.full_name);

    const rows = db.entries.map((e) => {
      const votes = Object.values(db.votes).filter((v) => v === e.id).length;
      return {
        id: e.id,
        title: e.title,
        photo_path: e.photo_path,
        member_names: e.member_names || [],
        owner_name: (db.guests.find((g) => g.id === e.owner_id) || {}).full_name || '',
        is_group: (e.member_names || []).length > 0,
        is_mine: e.owner_id === guestId || (myName && (e.member_names || []).some((m) => normName(m) === myName)),
        votes: info.revealed ? votes : null,
        _votes: votes
      };
    });

    return info.revealed ? rows.sort((a, b) => b._votes - a._votes) : rows;
  },

  castVote(guestId, entryId) {
    const db = demoRead();
    if (new Date() > new Date(db.closes_at) && !db.results_public) throw new Error('Voting is closed.');
    const e = db.entries.find((x) => x.id === entryId);
    if (!e) throw new Error('That costume is no longer listed.');
    const me = db.guests.find((g) => g.id === guestId);
    if (e.owner_id === guestId || (e.member_names || []).some((m) => normName(m) === normName(me?.full_name))) {
      throw new Error('You cannot vote for your own costume.');
    }
    db.votes[guestId] = entryId;
    demoWrite(db);
    return { voted_entry_id: entryId };
  },

  results() {
    const db = demoRead();
    const info = demo.partyInfo();
    const entries = demo.listEntries(null)
      .map((e) => ({ ...e, votes: e._votes, voters: [] }))
      .sort((a, b) => b.votes - a.votes || a.title.localeCompare(b.title));
    return {
      party: { id: PARTY_ID, name: info.name, closes_at: db.closes_at, results_public: db.results_public, revealed: info.revealed, server_now: info.server_now },
      is_admin: true,
      guest_count: db.guests.length,
      vote_count: Object.keys(db.votes).length,
      entries
    };
  },

  setClose(iso) { const db = demoRead(); db.closes_at = iso; demoWrite(db); return { closes_at: iso }; },
  setReveal(on) { const db = demoRead(); db.results_public = !!on; demoWrite(db); return { results_public: !!on }; },
  deleteEntry(id) {
    const db = demoRead();
    db.entries = db.entries.filter((e) => e.id !== id);
    for (const k of Object.keys(db.votes)) if (db.votes[k] === id) delete db.votes[k];
    demoWrite(db);
    return { deleted: id };
  },
  guests() {
    const db = demoRead();
    return db.guests.map((g) => ({
      id: g.id, full_name: g.full_name, phone: g.phone,
      first_seen: new Date().toISOString(),
      years: [PARTY_ID],
      here_now: true,
      entry: (db.entries.find((e) => e.owner_id === g.id) || {}).title || null,
      voted: Boolean(db.votes[g.id])
    })).sort((a, b) => a.full_name.localeCompare(b.full_name));
  },
  wipe() { try { localStorage.removeItem(DEMO_KEY); } catch { /* private mode */ } }
};

export const demoStore = demo;


/* ── One public API for the UI, whichever mode we're in ──────────────── */

export const api = {
  partyInfo() {
    return IS_LIVE ? rpc('party_info', { p_party: PARTY_ID }) : Promise.resolve(demo.partyInfo());
  },

  joinParty(name, phone) {
    return IS_LIVE
      ? rpc('join_party', { p_party: PARTY_ID, p_name: name, p_phone: phone })
      : Promise.resolve(demo.joinParty(name, phone));
  },

  /**
   * @param {Blob|null} photoBlob  already shrunk; null means "keep what's there"
   * @param {string|null} existingPath  current stored path, or null to clear
   */
  async saveEntry(guestId, title, photoBlob, existingPath, members) {
    if (!IS_LIVE) return demo.saveEntry(guestId, title, photoBlob, existingPath, members);

    let path = existingPath || null;
    if (photoBlob) {
      const name = `${PARTY_ID}/${guestId}-${Date.now()}.jpg`;
      let res;
      try {
        res = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${name}`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'image/jpeg', 'cache-control': 'public, max-age=31536000' }),
          body: photoBlob
        });
      } catch {
        throw new Error('The photo upload could not reach the server. Check your wifi.');
      }
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        if (/Bucket not found/i.test(t)) {
          throw new Error('The "costumes" storage bucket is missing — run supabase/schema.sql.');
        }
        throw new Error(friendlyError(t || `Photo upload failed (${res.status}).`, res.status));
      }
      path = name;
    }

    return rpc('save_entry', {
      p_party: PARTY_ID,
      p_guest: guestId,
      p_title: title,
      p_photo_path: path,
      p_members: members || []
    });
  },

  listEntries(guestId) {
    return IS_LIVE
      ? rpc('list_entries', { p_party: PARTY_ID, p_guest: guestId || null })
      : Promise.resolve(demo.listEntries(guestId));
  },

  castVote(guestId, entryId) {
    return IS_LIVE
      ? rpc('cast_vote', { p_party: PARTY_ID, p_guest: guestId, p_entry: entryId })
      : Promise.resolve(demo.castVote(guestId, entryId));
  },

  results(pin) {
    return IS_LIVE
      ? rpc('get_results', { p_party: PARTY_ID, p_pin: pin || null })
      : Promise.resolve(demo.results());
  },

  adminSetClose(pin, iso) {
    return IS_LIVE
      ? rpc('admin_set_close', { p_party: PARTY_ID, p_pin: pin, p_closes_at: iso })
      : Promise.resolve(demo.setClose(iso));
  },

  adminSetReveal(pin, on) {
    return IS_LIVE
      ? rpc('admin_set_reveal', { p_party: PARTY_ID, p_pin: pin, p_reveal: !!on })
      : Promise.resolve(demo.setReveal(on));
  },

  adminDeleteEntry(pin, entryId) {
    return IS_LIVE
      ? rpc('admin_delete_entry', { p_party: PARTY_ID, p_pin: pin, p_entry: entryId })
      : Promise.resolve(demo.deleteEntry(entryId));
  },

  adminGuests(pin) {
    return IS_LIVE
      ? rpc('admin_guests', { p_party: PARTY_ID, p_pin: pin })
      : Promise.resolve(demo.guests());
  }
};
