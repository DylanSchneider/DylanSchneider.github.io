/* =====================================================================
   Host view — live results, deadline control, master guest list.
   Gated by the admin PIN, which is checked in the database. Everything
   here is read-only for anyone without it.
   ===================================================================== */

import { api, photoUrl, IS_LIVE, PARTY_ID } from './store.js';

const CFG = window.PARTY_CONFIG || {};
const RESET_ENABLED = CFG.ENABLE_TEST_RESET !== false;
const $ = (id) => document.getElementById(id);
const PIN_KEY = `hp:${PARTY_ID}:pin`;

function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === '') continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

const state = { pin: '', data: null, guests: [], partyPhotos: [], editingGuest: null, skew: 0, closesAt: null, lastCloseSeen: null };
const serverNow = () => new Date(Date.now() + state.skew);

function show(id) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('is-active', v.id === id);
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(msg, kind) {
  const box = $('toast');
  box.replaceChildren(h('div', { class: `toast ${kind ? 'is-' + kind : ''}`, text: msg }));
  box.classList.add('is-up');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('is-up'), kind === 'bad' ? 4600 : 2600);
}

function loading(btn, on) {
  btn.classList.toggle('is-loading', on);
  btn.disabled = on;
}

/** costume/group roster as display text: just the name when solo, else
 *  "Name (Costume), Name (Costume)". */
function rosterText(e) {
  const members = e.members || [];
  if (!members.length) return '';
  if (members.length === 1) return members[0].name;
  return members.map((m) => `${m.name} (${m.costume_name})`).join(', ');
}


/* ── PIN gate ────────────────────────────────────────────────────────── */

$('form-pin').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const pin = $('in-pin').value.trim();
  if (!pin && IS_LIVE) {
    $('err-pin').textContent = 'Enter your admin PIN.';
    return;
  }
  const btn = $('btn-pin');
  loading(btn, true);
  $('err-pin').textContent = '';
  try {
    await enter(pin);
  } catch (err) {
    $('err-pin').textContent = err.message;
  } finally {
    loading(btn, false);
  }
});

async function enter(pin) {
  const data = await api.results(pin);
  state.pin = pin;
  try { sessionStorage.setItem(PIN_KEY, pin); } catch { /* private mode */ }
  adopt(data);
  $('reset-control').hidden = !RESET_ENABLED;
  show('v-admin');
  loadGuests();
  loadPartyPhotos();
  paintAll();
}

$('btn-lock').addEventListener('click', () => {
  state.pin = '';
  try { sessionStorage.removeItem(PIN_KEY); } catch { /* private mode */ }
  $('in-pin').value = '';
  show('v-pin');
});


/* ── Data ────────────────────────────────────────────────────────────── */

function adopt(data) {
  state.data = data;
  state.skew = new Date(data.party.server_now).getTime() - Date.now();
  state.closesAt = new Date(data.party.closes_at);
}

async function refresh(quiet) {
  const spin = $('btn-refresh');
  if (!quiet) spin.classList.add('is-spinning');
  try {
    adopt(await api.results(state.pin));
    paintAll();
    loadPartyPhotos();
  } catch (err) {
    if (!quiet) toast(err.message, 'bad');
  } finally {
    spin.classList.remove('is-spinning');
  }
}

async function loadGuests() {
  try {
    const rows = await api.adminGuests(state.pin);
    state.guests = Array.isArray(rows) ? rows : [];
    paintGuests();
  } catch (err) {
    $('guest-rows').replaceChildren(
      h('tr', {}, h('td', { colspan: '7', class: 'wrap-cell', text: err.message }))
    );
  }
}

$('btn-refresh').addEventListener('click', () => { refresh(false); loadGuests(); });


/* ── Paint ───────────────────────────────────────────────────────────── */

function paintAll() {
  const d = state.data;
  $('admin-party').textContent = d.party.name || PARTY_ID;
  $('kpi-guests').textContent = d.guest_count;
  $('kpi-entries').textContent = d.entries.length;
  $('kpi-votes').textContent = d.vote_count;

  paintClock();
  paintRank();
  paintReveal();
  paintDelete();

  // Only refill the deadline picker when the server's value actually changed,
  // so a background refresh never wipes out a time the host is mid-way through
  // typing.
  const serverClose = state.closesAt.toISOString();
  if (state.lastCloseSeen !== serverClose) {
    state.lastCloseSeen = serverClose;
    $('in-close').value = toLocalInput(state.closesAt);
  }
}

const two = (n) => String(n).padStart(2, '0');

function paintClock() {
  const box = $('clock');
  const ms = state.closesAt - serverNow();

  if (ms <= 0) {
    box.classList.add('is-closed');
    $('clock-label').textContent = 'Voting is closed';
    $('clock-digits').replaceChildren(
      h('div', { class: 'clock__n', style: 'font-size:22px;padding:6px 0', text: '🕛 Final' })
    );
    $('clock-when').textContent = `Closed ${fmtWhen(state.closesAt)}`;
    return;
  }

  box.classList.remove('is-closed');
  box.classList.toggle('is-urgent', ms < 10 * 60 * 1000);
  $('clock-label').textContent = 'Voting closes in';

  const t = Math.floor(ms / 1000);
  const d = Math.floor(t / 86400);
  const units = d > 0
    ? [[d, 'days'], [Math.floor(t % 86400 / 3600), 'hrs'], [Math.floor(t % 3600 / 60), 'min'], [t % 60, 'sec']]
    : [[Math.floor(t / 3600), 'hrs'], [Math.floor(t % 3600 / 60), 'min'], [t % 60, 'sec']];

  $('clock-digits').replaceChildren(...units.map(([n, lbl]) =>
    h('div', { class: 'clock__unit' },
      h('span', { class: 'clock__n', text: d > 0 ? String(n) : two(n) }),
      h('span', { class: 'clock__t', text: lbl })
    )
  ));
  $('clock-when').textContent = `Closes ${fmtWhen(state.closesAt)}`;
}

function fmtWhen(date) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    }).format(date);
  } catch { return date.toLocaleString(); }
}

function paintRank() {
  const list = state.data.entries;
  const box = $('rank');

  if (!list.length) {
    box.replaceChildren();
    $('rank-empty').replaceChildren(h('div', { class: 'empty' },
      h('div', { class: 'empty__icon', text: '👻' }),
      h('b', { text: 'No costumes entered yet' })
    ));
    return;
  }
  $('rank-empty').replaceChildren();

  const top = Math.max(1, ...list.map((e) => e.votes));
  let pos = 0, last = null;

  box.replaceChildren(...list.map((e, i) => {
    if (e.votes !== last) { pos = i + 1; last = e.votes; }
    const medal = pos <= 3 && e.votes > 0 ? ['🥇', '🥈', '🥉'][pos - 1] : String(pos);
    const who = rosterText(e);

    return h('div', { class: 'rank__row' },
      h('div', { class: 'rank__pos', text: medal }),
      h('div', { class: 'rank__main' },
        h('div', { class: 'rank__title', text: e.title }),
        h('div', { class: 'rank__sub', text: who }),
        e.voters && e.voters.length
          ? h('div', { class: 'rank__sub', text: 'Voted by: ' + e.voters.join(', ') })
          : null
      ),
      h('div', { class: 'rank__n', text: String(e.votes) }),
      h('div', { class: 'rank__bar' }, h('i', { style: `width:${Math.round(e.votes / top * 100)}%` }))
    );
  }));
}

function paintReveal() {
  const on = state.data.party.results_public;
  const closed = serverNow() >= state.closesAt;
  $('reveal-state').textContent = closed
    ? 'Voting has closed, so everyone can already see the results.'
    : (on ? 'Guests can see live vote counts right now.' : 'Guests cannot see any vote counts yet.');
  const btn = $('btn-reveal');
  btn.textContent = on ? 'Hide results again' : 'Reveal results now';
  btn.className = 'btn btn--block btn--sm ' + (on ? 'btn--danger' : 'btn--primary');
}

function paintDelete() {
  $('del-rows').replaceChildren(...state.data.entries.map((e) =>
    h('div', { class: 'rank__row' },
      h('div', { class: 'rank__pos', text: '🗑' }),
      h('div', { class: 'rank__main' },
        h('div', { class: 'rank__title', text: e.title }),
        h('div', { class: 'rank__sub', text: `${rosterText(e)} · ${e.votes} ${e.votes === 1 ? 'vote' : 'votes'}` })
      ),
      h('button', {
        class: 'btn btn--danger btn--sm', type: 'button',
        onclick: (ev) => removeEntry(e, ev.currentTarget)
      }, 'Delete')
    )
  ));
}

function paintGuests() {
  const rows = state.guests;
  if (!rows.length) {
    $('guest-rows').replaceChildren(
      h('tr', {}, h('td', { colspan: '7', text: 'Nobody has checked in yet.' }))
    );
    return;
  }
  $('guest-rows').replaceChildren(...rows.map((g) =>
    h('tr', {},
      h('td', { class: 'wrap-cell', text: g.full_name }),
      h('td', { text: prettyPhone(g.phone) }),
      h('td', { text: (g.years || []).join(', ') }),
      h('td', { class: 'wrap-cell', text: g.entry || '—' }),
      h('td', { class: 'wrap-cell', text: (g.costume_name && g.costume_name !== g.entry) ? g.costume_name : '—' }),
      h('td', { text: g.voted ? '✅' : '—' }),
      h('td', {}, h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button',
        onclick: () => openGuestEditor(g)
      }, 'Edit'))
    )
  ));
}

async function loadPartyPhotos() {
  try {
    const photos = await api.adminPartyPhotos(state.pin);
    state.partyPhotos = Array.isArray(photos) ? photos : [];
    paintPartyPhotos();
  } catch (err) {
    $('party-photo-admin').replaceChildren(h('p', { class: 'err', text: err.message }));
  }
}

function paintPartyPhotos() {
  const box = $('party-photo-admin');
  const count = $('party-photo-count');
  count.textContent = `${state.partyPhotos.length} photo${state.partyPhotos.length === 1 ? '' : 's'}`;
  if (!state.partyPhotos.length) {
    box.replaceChildren(h('p', { class: 'hint', text: 'No party photos have been uploaded yet.' }));
    return;
  }
  box.replaceChildren(...state.partyPhotos.map((photo) => {
    const normal = photoUrl(photo.normal_path, 'party-photos');
    const film = photoUrl(photo.film_path, 'party-photos');
    return h('div', { class: 'admin-photo-row' },
      h('img', { src: normal, alt: photo.caption || 'Party photo', loading: 'lazy' }),
      h('div', { class: 'rank__main' },
        h('div', { class: 'rank__title', text: photo.caption || 'Party photo' }),
        h('div', { class: 'rank__sub', text: `📸 ${photo.uploader || 'Guest'}` }),
        h('div', { class: 'party-photo-tile__actions' },
          h('a', { class: 'btn btn--ghost btn--sm', href: normal, download: `party-${photo.id}-normal.jpg`, target: '_blank', rel: 'noopener' }, 'Save normal'),
          h('a', { class: 'btn btn--ghost btn--sm', href: film, download: `party-${photo.id}-film.jpg`, target: '_blank', rel: 'noopener' }, 'Save film')
        )
      )
    );
  }));
}

const prettyPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d;
};

function openGuestEditor(guest) {
  state.editingGuest = guest;
  $('edit-guest-name').value = guest.full_name || '';
  $('edit-guest-costume').value = guest.costume_name || '';
  $('edit-guest-costume').disabled = !guest.entry;
  $('edit-guest-costume-hint').textContent = guest.entry
    ? `Current entry: ${guest.entry}`
    : 'This guest has not entered a costume for this party.';
  $('edit-guest-name-error').textContent = '';
  $('edit-guest-costume-error').textContent = '';
  const dialog = $('edit-guest-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  $('edit-guest-name').focus();
}

function closeGuestEditor() {
  const dialog = $('edit-guest-dialog');
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
  state.editingGuest = null;
}

$('btn-edit-guest-cancel').addEventListener('click', closeGuestEditor);
$('edit-guest-dialog').addEventListener('click', (ev) => {
  if (ev.target === $('edit-guest-dialog')) closeGuestEditor();
});

$('form-edit-guest').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const guest = state.editingGuest;
  if (!guest) return;

  const name = $('edit-guest-name').value.trim().replace(/\s+/g, ' ');
  const costume = $('edit-guest-costume').value.trim().replace(/\s+/g, ' ');
  let bad = false;
  $('edit-guest-name-error').textContent = '';
  $('edit-guest-costume-error').textContent = '';
  if (name.length < 2 || !name.includes(' ')) {
    $('edit-guest-name-error').textContent = 'Enter a first and last name.';
    bad = true;
  }
  if (guest.entry && costume.length < 1) {
    $('edit-guest-costume-error').textContent = 'Enter this guest’s costume or role.';
    bad = true;
  }
  if (bad) return;

  const btn = $('btn-edit-guest-save');
  loading(btn, true);
  try {
    await api.adminUpdateGuest(state.pin, guest.id, name, costume);
    closeGuestEditor();
    await refresh(true);
    await loadGuests();
    toast('Guest details updated.', 'good');
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    loading(btn, false);
  }
});


/* ── Controls ────────────────────────────────────────────────────────── */

function toLocalInput(date) {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
       + `T${two(date.getHours())}:${two(date.getMinutes())}`;
}

$('btn-close').addEventListener('click', async (ev) => {
  const raw = $('in-close').value;
  if (!raw) { toast('Pick a date and time first.', 'bad'); return; }
  // A datetime-local value has no timezone, so the browser reads it as this
  // phone's local time — which is what the host means by "10pm".
  const when = new Date(raw);
  if (isNaN(when)) { toast('That date did not parse.', 'bad'); return; }

  const btn = ev.currentTarget;
  loading(btn, true);
  try {
    await api.adminSetClose(state.pin, when.toISOString());
    await refresh(true);
    toast('Deadline updated to ' + fmtWhen(when), 'good');
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    loading(btn, false);
  }
});

$('btn-reveal').addEventListener('click', async (ev) => {
  const next = !state.data.party.results_public;
  const btn = ev.currentTarget;
  loading(btn, true);
  try {
    await api.adminSetReveal(state.pin, next);
    await refresh(true);
    toast(next ? 'Results are now visible to guests.' : 'Results hidden from guests.', 'good');
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    loading(btn, false);
  }
});

async function removeEntry(entry, btn) {
  if (!confirm(`Delete “${entry.title}” and its ${entry.votes} vote(s)? This cannot be undone.`)) return;
  loading(btn, true);
  try {
    await api.adminDeleteEntry(state.pin, entry.id);
    await refresh(true);
    toast('Entry deleted.', 'good');
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    loading(btn, false);
  }
}

$('btn-clear-all').addEventListener('click', async (ev) => {
  if (!RESET_ENABLED) return;
  if (!confirm('Clear this party’s attendance, entries, votes, and test guests? This cannot be undone.')) return;
  const phrase = prompt('Type CLEAR to confirm the full test reset.');
  if (phrase !== 'CLEAR') {
    if (phrase !== null) toast('Reset cancelled — the confirmation text did not match.', 'bad');
    return;
  }

  const btn = ev.currentTarget;
  loading(btn, true);
  try {
    await api.adminClearAll(state.pin);
    await refresh(true);
    await loadGuests();
    await loadPartyPhotos();
    toast('All testing data for this party was cleared.', 'good');
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    loading(btn, false);
  }
});


/* ── CSV of the master guest list ────────────────────────────────────── */

function csv() {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Name', 'Phone', 'Years attended', `Group/Costume (${PARTY_ID})`, `Their role (${PARTY_ID})`, `Voted (${PARTY_ID})`, 'First seen'];
  const lines = [head.join(',')];
  for (const g of state.guests) {
    lines.push([
      esc(g.full_name), esc(prettyPhone(g.phone)), esc((g.years || []).join(' ')),
      esc(g.entry || ''), esc((g.costume_name && g.costume_name !== g.entry) ? g.costume_name : ''),
      g.voted ? 'yes' : 'no', esc(String(g.first_seen || '').slice(0, 10))
    ].join(','));
  }
  return lines.join('\r\n');
}

$('btn-csv').addEventListener('click', () => {
  if (!state.guests.length) { toast('No guests to export yet.', 'bad'); return; }
  const blob = new Blob(['﻿' + csv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `guests-${PARTY_ID}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});

// iOS Safari is unreliable about downloading blobs, so offer the clipboard too.
$('btn-copy').addEventListener('click', async () => {
  if (!state.guests.length) { toast('No guests to export yet.', 'bad'); return; }
  try {
    await navigator.clipboard.writeText(csv());
    toast('Guest list copied — paste it into Notes or a spreadsheet.', 'good');
  } catch {
    toast('This browser blocked clipboard access. Use Download CSV instead.', 'bad');
  }
});


/* ── Timers + boot ───────────────────────────────────────────────────── */

setInterval(() => {
  if ($('v-admin').classList.contains('is-active') && state.closesAt) paintClock();
}, 1000);

setInterval(() => {
  if (!document.hidden && $('v-admin').classList.contains('is-active')) refresh(true);
}, 10000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && $('v-admin').classList.contains('is-active')) refresh(true);
});

(async function boot() {
  if (!IS_LIVE) {
    $('pin-mode').replaceChildren(h('div', { class: 'note note--warn' },
      h('b', { text: 'Demo mode' }),
      'No database is connected, so this shows whatever is stored on this phone. Any PIN works.'
    ));
    $('admin-mode').replaceChildren(h('div', { class: 'note note--warn' },
      h('b', { text: 'Demo mode' }), 'These numbers come from this phone only.'
    ));
  }

  let remembered = '';
  try { remembered = sessionStorage.getItem(PIN_KEY) || ''; } catch { /* private mode */ }

  if (remembered || !IS_LIVE) {
    try { await enter(remembered); return; } catch { /* fall through to the gate */ }
  }

  // Results go public once voting closes, so try without a PIN first: after
  // the party, the host can open this page and just see the winner.
  try {
    await enter('');
    return;
  } catch { /* still hidden — ask for the PIN */ }

  show('v-pin');
})();
