/* =====================================================================
   Data layer.

   Talks to Supabase over its plain REST endpoints — no SDK, no CDN, so
   there is nothing extra to download on flaky party wifi.

   If config.js has no Supabase credentials, everything below falls back
   to DEMO MODE against localStorage so the full flow is clickable.

   Costume model: an "entry" is the thing being voted on (a solo costume,
   or a group costume like "Alice in Wonderland"). Each guest who's part
   of an entry has their own row describing their individual costume/role
   within it (e.g. "Mad Hatter") — see entry_members in supabase/schema.sql.
   ===================================================================== */

const CFG = window.PARTY_CONFIG || {};

export const PARTY_ID = CFG.PARTY_ID || '2026';
export const IS_LIVE = Boolean(CFG.SUPABASE_URL && CFG.SUPABASE_PUBLISHABLE_KEY);

// Accept either the bare project URL or one with /rest/v1 already on the
// end (Supabase's dashboard shows both forms in different places), so a
// pasted value works either way.
const BASE = String(CFG.SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
// The "publishable" key is Supabase's current name for what used to be
// called the "anon" key — same public, RLS-scoped key, used the same way.
const KEY = CFG.SUPABASE_PUBLISHABLE_KEY || '';
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

async function uploadPhoto(guestId, blob) {
  const name = `${PARTY_ID}/${guestId}-${Date.now()}.jpg`;
  let res;
  try {
    res = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${name}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'image/jpeg', 'cache-control': 'public, max-age=31536000' }),
      body: blob
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
  return name;
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
      entries: [],    // {id, owner_id, title, photo_path}
      members: [],    // {guest_id, entry_id, costume_name, is_owner}
      votes: {},      // voter_id -> entry_id
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

const cleanText = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const normPhone = (s) => {
  const d = String(s || '').replace(/\D/g, '');
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d;
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

function demoRoster(db, entryId) {
  return db.members
    .filter((m) => m.entry_id === entryId)
    .map((m) => ({
      name: (db.guests.find((g) => g.id === m.guest_id) || {}).full_name || '',
      costume_name: m.costume_name,
      is_owner: m.is_owner
    }))
    .sort((a, b) => (b.is_owner - a.is_owner) || a.name.localeCompare(b.name));
}

function demoMembership(db, guestId) {
  const m = db.members.find((x) => x.guest_id === guestId);
  if (!m) return null;
  const e = db.entries.find((x) => x.id === m.entry_id);
  if (!e) return null;
  return {
    entry_id: e.id, title: e.title, photo_path: e.photo_path,
    is_owner: m.is_owner, costume_name: m.costume_name, members: demoRoster(db, e.id)
  };
}

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

    return {
      guest: g,
      membership: demoMembership(db, g.id),
      voted_entry_id: db.votes[g.id] || null
    };
  },

  createEntry(guestId, title, costumeName, photoPath) {
    const db = demoRead();
    if (db.members.some((m) => m.guest_id === guestId)) {
      throw new Error('You already have a costume entered this year — edit it from the menu instead.');
    }
    const t = cleanText(title);
    if (t.length < 2) throw new Error('Give your costume (or group) a name.');
    const costume = cleanText(costumeName) || t;

    const e = { id: uid(), owner_id: guestId, title: t, photo_path: photoPath || null };
    db.entries.push(e);
    db.members.push({ guest_id: guestId, entry_id: e.id, costume_name: costume, is_owner: true });
    demoWrite(db);
    return { entry_id: e.id, title: e.title, photo_path: e.photo_path, costume_name: costume, is_owner: true, members: demoRoster(db, e.id) };
  },

  joinEntry(guestId, entryId, costumeName) {
    const db = demoRead();
    if (db.members.some((m) => m.guest_id === guestId)) {
      throw new Error('You already have a costume entered this year — edit it from the menu instead.');
    }
    const e = db.entries.find((x) => x.id === entryId);
    if (!e) throw new Error('That costume group no longer exists.');
    const costume = cleanText(costumeName);
    if (costume.length < 1) throw new Error('What are you dressed as in this group?');

    db.members.push({ guest_id: guestId, entry_id: e.id, costume_name: costume, is_owner: false });
    demoWrite(db);
    return { entry_id: e.id, title: e.title, photo_path: e.photo_path, costume_name: costume, is_owner: false, members: demoRoster(db, e.id) };
  },

  updateEntry(guestId, title, photoPath) {
    const db = demoRead();
    const m = db.members.find((x) => x.guest_id === guestId);
    if (!m) throw new Error('You have not entered a costume yet.');
    if (!m.is_owner) throw new Error('Only the person who started this group can rename it or change its photo.');
    const t = cleanText(title);
    if (t.length < 2) throw new Error('Give your costume (or group) a name.');

    const e = db.entries.find((x) => x.id === m.entry_id);
    e.title = t;
    e.photo_path = photoPath || null;
    demoWrite(db);
    return { entry_id: e.id, title: e.title, photo_path: e.photo_path, members: demoRoster(db, e.id) };
  },

  updateMyCostume(guestId, costumeName) {
    const db = demoRead();
    const costume = cleanText(costumeName);
    if (costume.length < 1) throw new Error('What are you dressed as?');
    const m = db.members.find((x) => x.guest_id === guestId);
    if (!m) throw new Error('You have not entered a costume yet.');
    m.costume_name = costume;
    demoWrite(db);
    return { costume_name: costume, members: demoRoster(db, m.entry_id) };
  },

  leaveEntry(guestId) {
    const db = demoRead();
    const m = db.members.find((x) => x.guest_id === guestId);
    if (!m) throw new Error('You have not entered a costume yet.');
    const rest = db.members.filter((x) => x.entry_id === m.entry_id && x.guest_id !== guestId);
    if (m.is_owner && rest.length > 0) {
      throw new Error(`You started this group and ${rest.length} other ${rest.length === 1 ? 'person has' : 'people have'} already joined it — remove the entry from the host page instead of leaving.`);
    }
    if (m.is_owner) {
      db.entries = db.entries.filter((e) => e.id !== m.entry_id);
      db.members = db.members.filter((x) => x.entry_id !== m.entry_id);
      for (const k of Object.keys(db.votes)) if (db.votes[k] === m.entry_id) delete db.votes[k];
    } else {
      db.members = db.members.filter((x) => x.guest_id !== guestId);
    }
    demoWrite(db);
    return { left: true };
  },

  listEntries(guestId) {
    const db = demoRead();
    const info = demo.partyInfo();

    const rows = db.entries.map((e) => {
      const votes = Object.values(db.votes).filter((v) => v === e.id).length;
      const members = demoRoster(db, e.id);
      return {
        id: e.id,
        title: e.title,
        photo_path: e.photo_path,
        members,
        is_group: members.length > 1,
        is_mine: db.members.some((m) => m.entry_id === e.id && m.guest_id === guestId),
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
    if (db.members.some((m) => m.entry_id === entryId && m.guest_id === guestId)) {
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
    db.members = db.members.filter((m) => m.entry_id !== id);
    for (const k of Object.keys(db.votes)) if (db.votes[k] === id) delete db.votes[k];
    demoWrite(db);
    return { deleted: id };
  },
  guests() {
    const db = demoRead();
    return db.guests.map((g) => {
      const m = db.members.find((x) => x.guest_id === g.id);
      const e = m ? db.entries.find((x) => x.id === m.entry_id) : null;
      return {
        id: g.id, full_name: g.full_name, phone: g.phone,
        first_seen: new Date().toISOString(),
        years: [PARTY_ID],
        here_now: true,
        entry: e ? e.title : null,
        costume_name: m ? m.costume_name : null,
        voted: Boolean(db.votes[g.id])
      };
    }).sort((a, b) => a.full_name.localeCompare(b.full_name));
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

  /** Start a brand-new solo or group entry. photoBlob may be null (no photo). */
  async createEntry(guestId, title, costumeName, photoBlob) {
    if (!IS_LIVE) return demo.createEntry(guestId, title, costumeName, photoBlob ? await blobToDataUrl(photoBlob) : null);
    const path = photoBlob ? await uploadPhoto(guestId, photoBlob) : null;
    return rpc('create_entry', { p_party: PARTY_ID, p_guest: guestId, p_title: title, p_costume_name: costumeName, p_photo_path: path });
  },

  /** Join an existing group with your own costume/role inside it. */
  joinEntry(guestId, entryId, costumeName) {
    return IS_LIVE
      ? rpc('join_entry', { p_party: PARTY_ID, p_guest: guestId, p_entry: entryId, p_costume_name: costumeName })
      : Promise.resolve(demo.joinEntry(guestId, entryId, costumeName));
  },

  /** Owner-only: rename the group/solo title and/or replace its photo.
   *  photoBlob: a new Blob to upload, null to clear the photo, or
   *  undefined to keep whatever's already there. */
  async updateEntry(guestId, title, photoBlob, existingPath) {
    if (!IS_LIVE) {
      const path = photoBlob === undefined ? existingPath : (photoBlob ? await blobToDataUrl(photoBlob) : null);
      return demo.updateEntry(guestId, title, path);
    }
    const path = photoBlob === undefined ? existingPath : (photoBlob ? await uploadPhoto(guestId, photoBlob) : null);
    return rpc('update_entry', { p_party: PARTY_ID, p_guest: guestId, p_title: title, p_photo_path: path });
  },

  /** Anyone: change your own individual costume/role. */
  updateMyCostume(guestId, costumeName) {
    return IS_LIVE
      ? rpc('update_my_costume', { p_party: PARTY_ID, p_guest: guestId, p_costume_name: costumeName })
      : Promise.resolve(demo.updateMyCostume(guestId, costumeName));
  },

  leaveEntry(guestId) {
    return IS_LIVE
      ? rpc('leave_entry', { p_party: PARTY_ID, p_guest: guestId })
      : Promise.resolve(demo.leaveEntry(guestId));
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
