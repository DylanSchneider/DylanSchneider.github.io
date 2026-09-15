/* =====================================================================
   Halloween Party — guest app
   Screens: check in → costume → vote dashboard
   ===================================================================== */

import { api, session, photoUrl, shrinkPhoto, demoStore, IS_LIVE, PARTY_ID } from './store.js';

const CFG = window.PARTY_CONFIG || {};
const $ = (id) => document.getElementById(id);

/** Build a DOM node. Text always goes through textContent, never innerHTML,
 *  so a costume called `<script>` is just a funny costume name. */
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

const state = {
  me: null,            // { id, full_name, phone }
  info: null,          // party_info payload
  skew: 0,             // serverNow - deviceNow, so a wrong phone clock can't lie
  closesAt: null,      // Date
  revealed: false,
  entries: [],
  myEntry: null,
  votedId: null,
  selectedId: null,
  members: [],
  photoBlob: null,
  photoPath: null,
  photoObjectUrl: null,
  costumeReturn: 'v-name',
  busy: false
};

const serverNow = () => new Date(Date.now() + state.skew);


/* ── Chrome: views, toasts, haptics ──────────────────────────────────── */

function show(viewId) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('is-active', v.id === viewId);
  $('actionbar').classList.toggle('is-up', false);
  window.scrollTo(0, 0);
  if (viewId === 'v-dash') paintActionbar();
}

let toastTimer;
function toast(msg, kind) {
  const box = $('toast');
  box.replaceChildren(h('div', { class: `toast ${kind ? 'is-' + kind : ''}`, text: msg }));
  box.classList.add('is-up');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('is-up'), kind === 'bad' ? 4600 : 2800);
}

function buzz(ms) {
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
}

function loading(btn, on) {
  btn.classList.toggle('is-loading', on);
  btn.disabled = on;
}

function fieldError(errId, inputId, msg) {
  $(errId).textContent = msg || '';
  if (inputId) $(inputId).setAttribute('aria-invalid', msg ? 'true' : 'false');
}


/* ── Mode + setup banners ────────────────────────────────────────────── */

function paintModeNotes() {
  if (IS_LIVE) return;
  const note = () => h('div', { class: 'note note--warn' },
    h('b', { text: 'Demo mode — this phone only' }),
    'Nothing is shared between phones and no votes are recorded for real. ',
    'Add your Supabase URL and key to ',
    h('code', { text: 'config.js' }),
    ' to go live. Setup steps are in README.md.'
  );
  $('mode-note').replaceChildren(note());
  $('mode-note-2').replaceChildren(note());
  $('menu-wipe').hidden = false;
}

function bootFail(message) {
  $('boot-msg').textContent = 'This app is not connected yet.';
  $('boot-extra').replaceChildren(
    h('div', { class: 'note note--warn' }, h('b', { text: 'What went wrong' }), message),
    h('div', { class: 'panel', style: 'margin-top:14px' },
      h('p', { class: 'eyebrow', text: 'To fix it' }),
      h('ol', { class: 'setup-steps', style: 'margin-top:12px' },
        h('li', {}, 'Open your Supabase project → SQL Editor, paste all of ',
          h('b', { text: 'supabase/schema.sql' }), ' and press Run.'),
        h('li', {}, 'Copy your Project URL and ', h('b', { text: 'Publishable' }),
          ' key into ', h('code', { text: 'config.js' }), '.'),
        h('li', {}, 'Make sure ', h('code', { text: 'PARTY_ID' }), ' in config.js matches the party row id (currently ',
          h('code', { text: PARTY_ID }), ').'),
        h('li', {}, 'Commit and push, then reload this page.')
      ),
      h('button', {
        class: 'btn btn--ghost btn--block', style: 'margin-top:16px', type: 'button',
        onclick: () => location.reload()
      }, 'Try again')
    )
  );
  show('v-boot');
}


/* ── Step 1 · check in ───────────────────────────────────────────────── */

function formatPhone(raw) {
  const d = String(raw).replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

$('in-phone').addEventListener('input', (ev) => {
  const el = ev.target;
  const atEnd = el.selectionStart === el.value.length;
  const next = formatPhone(el.value);
  if (next !== el.value) {
    el.value = next;
    // Only restore the caret when typing at the end; mid-string edits keep
    // whatever position the browser gave us rather than jumping.
    if (atEnd) { try { el.setSelectionRange(next.length, next.length); } catch { /* ignore */ } }
  }
  fieldError('err-phone', 'in-phone', '');
});

$('in-name').addEventListener('input', () => fieldError('err-name', 'in-name', ''));

$('form-name').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = $('in-name').value.trim().replace(/\s+/g, ' ');
  const phone = $('in-phone').value;
  const digits = phone.replace(/\D/g, '');

  let bad = false;
  if (name.length < 2 || !name.includes(' ')) {
    fieldError('err-name', 'in-name', 'Please enter your first and last name.');
    bad = true;
  }
  if (digits.length !== 10) {
    fieldError('err-phone', 'in-phone', 'Please enter all 10 digits of your mobile number.');
    bad = true;
  }
  if (bad) { buzz(40); return; }

  const btn = $('btn-name');
  loading(btn, true);
  try {
    const res = await api.joinParty(name, phone);
    adoptJoin(res);
    if (state.myEntry) { await goDash(); toast('Welcome back, ' + firstName() + '!'); }
    else openCostume('v-name', res.listed_in);
  } catch (err) {
    toast(err.message, 'bad');
    buzz(60);
  } finally {
    loading(btn, false);
  }
});

function adoptJoin(res) {
  state.me = res.guest;
  state.myEntry = res.entry || null;
  state.votedId = res.voted_entry_id || null;
  session.set(res.guest);
}

const firstName = () => String(state.me?.full_name || '').split(' ')[0];


/* ── Step 2 · costume ────────────────────────────────────────────────── */

function openCostume(returnTo, listedIn) {
  state.costumeReturn = returnTo || 'v-dash';
  const editing = Boolean(state.myEntry);

  $('in-title').value = state.myEntry?.title || '';
  state.members = [...(state.myEntry?.member_names || [])];
  state.photoBlob = null;
  state.photoPath = state.myEntry?.photo_path || null;
  $('in-photo').value = '';
  setPreview(state.photoPath ? photoUrl(state.photoPath) : null);
  paintChips();
  fieldError('err-title', 'in-title', '');
  fieldError('err-photo', null, '');

  $('costume-eyebrow').textContent = editing ? 'Edit your costume' : 'Step 2 of 2 · Your costume';
  $('btn-costume').textContent = editing ? 'Save changes' : 'Enter my costume';
  $('btn-skip').hidden = editing;
  $('btn-back').textContent = returnTo === 'v-dash' ? '← Back to voting' : '← Back';

  $('listed-note').replaceChildren();
  if (listedIn && !editing) {
    $('listed-note').replaceChildren(
      h('div', { class: 'note note--warn' },
        h('b', {}, `${listedIn.owner_name} already listed you in “${listedIn.title}”`),
        'If that is your costume you are all set — no need to enter it again. ',
        'Only add your own entry below if you have a different costume.',
        h('button', {
          class: 'btn btn--primary btn--block', style: 'margin-top:12px', type: 'button',
          onclick: () => goDash()
        }, 'That’s mine — take me to voting')
      )
    );
  }

  show('v-costume');
}

$('btn-back').addEventListener('click', () => {
  if (state.costumeReturn === 'v-dash') goDash();
  else show('v-name');
});

/* Photo */
function setPreview(url) {
  const box = $('photo');
  const img = $('photo-img');
  if (state.photoObjectUrl && state.photoObjectUrl !== url) {
    URL.revokeObjectURL(state.photoObjectUrl);
    state.photoObjectUrl = null;
  }
  if (url) {
    img.src = url;
    box.classList.add('has-img');
    $('btn-rmphoto').style.display = '';
  } else {
    img.removeAttribute('src');
    box.classList.remove('has-img');
    $('btn-rmphoto').style.display = 'none';
  }
}

$('in-photo').addEventListener('change', async (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  fieldError('err-photo', null, '');

  const box = $('photo');
  box.classList.add('is-busy');
  $('btn-costume').disabled = true;
  try {
    // Resize on the phone: a 10MB camera photo becomes a few hundred KB,
    // which is the difference between an instant upload and a hung one.
    const blob = await shrinkPhoto(file, CFG.PHOTO_MAX_EDGE, IS_LIVE ? CFG.PHOTO_QUALITY : 0.7);
    state.photoBlob = blob;
    state.photoObjectUrl = URL.createObjectURL(blob);
    setPreview(state.photoObjectUrl);
  } catch (err) {
    ev.target.value = '';
    fieldError('err-photo', null,
      /empty|read as an image/i.test(err.message)
        ? 'That file could not be read as a photo. Try taking a new one with the camera.'
        : err.message);
  } finally {
    box.classList.remove('is-busy');
    $('btn-costume').disabled = false;
  }
});

$('btn-rmphoto').addEventListener('click', () => {
  state.photoBlob = null;
  state.photoPath = null;
  $('in-photo').value = '';
  setPreview(null);
});

/* Group members */
function paintChips() {
  $('chips').replaceChildren(...state.members.map((name, i) =>
    h('span', { class: 'chip' }, name,
      h('button', { type: 'button', 'aria-label': `Remove ${name}`, onclick: () => {
        state.members.splice(i, 1);
        paintChips();
      } }, '×')
    )
  ));
}

function addMembers(raw) {
  const mine = String(state.me?.full_name || '').trim().toLowerCase();
  let added = 0, skipped = '';
  for (const part of String(raw).split(/[,\n;]/)) {
    const name = part.trim().replace(/\s+/g, ' ');
    if (name.length < 2) continue;
    if (name.toLowerCase() === mine) { skipped = 'You are already on your own entry.'; continue; }
    if (state.members.some((m) => m.toLowerCase() === name.toLowerCase())) { skipped = `${name} is already listed.`; continue; }
    if (state.members.length >= 20) { skipped = 'That is as many people as one group can hold.'; break; }
    state.members.push(name);
    added++;
  }
  paintChips();
  if (!added && skipped) toast(skipped, 'bad');
  return added;
}

$('btn-addmember').addEventListener('click', () => {
  const input = $('in-member');
  if (addMembers(input.value)) input.value = '';
  input.focus();
});

$('in-member').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    $('btn-addmember').click();
  }
});

$('in-title').addEventListener('input', () => fieldError('err-title', 'in-title', ''));

$('form-costume').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const title = $('in-title').value.trim().replace(/\s+/g, ' ');
  if (title.length < 2) {
    fieldError('err-title', 'in-title', 'Give your costume a name.');
    buzz(40);
    return;
  }

  // A name typed but never added with + would otherwise be silently dropped.
  if ($('in-member').value.trim().length > 1) {
    addMembers($('in-member').value);
    $('in-member').value = '';
  }

  const btn = $('btn-costume');
  loading(btn, true);
  try {
    const saved = await api.saveEntry(state.me.id, title, state.photoBlob, state.photoPath, state.members);
    state.myEntry = saved;
    state.photoBlob = null;
    state.photoPath = saved.photo_path || null;
    await goDash();
    toast(state.members.length ? 'Group costume entered. Good luck!' : 'Costume entered. Good luck!', 'good');
    buzz(30);
  } catch (err) {
    toast(err.message, 'bad');
    buzz(60);
  } finally {
    loading(btn, false);
  }
});

$('btn-skip').addEventListener('click', () => goDash());


/* ── Dashboard ───────────────────────────────────────────────────────── */

async function goDash() {
  $('me-name').textContent = state.me?.full_name || '—';
  show('v-dash');
  await refresh();
}

async function refresh(quiet) {
  const spin = $('btn-refresh');
  if (!quiet) spin.classList.add('is-spinning');
  try {
    const [info, entries] = await Promise.all([
      api.partyInfo(),
      api.listEntries(state.me?.id)
    ]);
    adoptInfo(info);
    state.entries = Array.isArray(entries) ? entries : [];
    paintAll();
  } catch (err) {
    if (!quiet) toast(err.message, 'bad');
  } finally {
    spin.classList.remove('is-spinning');
  }
}

function adoptInfo(info) {
  state.info = info;
  state.skew = new Date(info.server_now).getTime() - Date.now();
  state.closesAt = new Date(info.closes_at);
  state.revealed = Boolean(info.revealed);
  if (CFG.PARTY_TITLE && info.name) document.title = `${info.name} · Costume Contest`;
}

function paintAll() {
  paintClock();
  paintWinner();
  paintStatus();
  paintCards();
  paintActionbar();
}

/* Countdown */
const two = (n) => String(n).padStart(2, '0');

function paintClock() {
  const box = $('clock');
  const digits = $('clock-digits');
  if (!state.closesAt) return;

  const ms = state.closesAt - serverNow();

  if (ms <= 0) {
    box.classList.add('is-closed');
    box.classList.remove('is-urgent');
    $('clock-label').textContent = 'Voting is closed';
    digits.replaceChildren(h('div', { class: 'clock__n', style: 'font-size:22px;padding:6px 0', text: '🕛 Time’s up' }));
    $('clock-when').textContent = `Closed ${fmtWhen(state.closesAt)}`;
    return;
  }

  box.classList.remove('is-closed');
  box.classList.toggle('is-urgent', ms < 10 * 60 * 1000);
  $('clock-label').textContent = state.revealed ? 'Results are live · closes in' : 'Voting closes in';

  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const hr = Math.floor((total % 86400) / 3600);
  const mi = Math.floor((total % 3600) / 60);
  const se = total % 60;

  const units = d > 0
    ? [[d, 'days'], [hr, 'hrs'], [mi, 'min'], [se, 'sec']]
    : [[hr, 'hrs'], [mi, 'min'], [se, 'sec']];

  digits.replaceChildren(...units.map(([n, t]) =>
    h('div', { class: 'clock__unit' },
      h('span', { class: 'clock__n', text: d > 0 ? String(n) : two(n) }),
      h('span', { class: 'clock__t', text: t })
    )
  ));
  $('clock-when').textContent = `Closes ${fmtWhen(state.closesAt)}`;
}

function fmtWhen(date) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/* Winner banner, once results are revealed */
function paintWinner() {
  const box = $('winner');
  if (!state.revealed || !state.entries.length) { box.replaceChildren(); return; }

  const top = Math.max(...state.entries.map((e) => e.votes || 0));
  if (top <= 0) {
    box.replaceChildren(h('div', { class: 'winner' },
      h('div', { class: 'winner__crown', text: '🦗' }),
      h('div', { class: 'winner__label', text: 'Final result' }),
      h('div', { class: 'winner__name', text: 'Nobody voted' })
    ));
    return;
  }

  const winners = state.entries.filter((e) => (e.votes || 0) === top);
  const label = state.info && serverNow() < state.closesAt ? 'Leading right now' : 'Best costume';

  box.replaceChildren(h('div', { class: 'winner' },
    h('div', { class: 'winner__crown', text: winners.length > 1 ? '🤝' : '👑' }),
    h('div', { class: 'winner__label', text: winners.length > 1 ? label + ' · tie' : label }),
    h('div', { class: 'winner__name', text: winners.map((w) => w.title).join('  ·  ') }),
    h('div', { class: 'winner__meta', text: `${top} ${top === 1 ? 'vote' : 'votes'} · ${roster(winners[0])}` })
  ));
}

const roster = (e) => [e.owner_name, ...(e.member_names || [])].filter(Boolean).join(', ');

/* Your-vote strip */
function paintStatus() {
  const strip = $('status');
  const txt = $('status-text');
  const icon = $('status-icon');
  const closed = serverNow() >= state.closesAt;
  const voted = state.entries.find((e) => e.id === state.votedId);

  strip.hidden = false;
  strip.classList.toggle('is-voted', Boolean(voted));

  if (voted) {
    icon.textContent = '✅';
    txt.replaceChildren(
      closed ? 'You voted for ' : 'Your vote: ',
      h('b', { text: voted.title }),
      closed ? '' : ' · tap another costume to change it'
    );
  } else if (closed) {
    icon.textContent = '🕛';
    txt.textContent = 'Voting is closed and you did not get a vote in.';
  } else if (!state.entries.length) {
    strip.hidden = true;
  } else {
    icon.textContent = '🗳️';
    txt.textContent = 'You have one vote. Tap a costume to pick it.';
  }
}

/* Costume grid */
function paintCards() {
  const grid = $('cards');
  const empty = $('empty');

  if (!state.entries.length) {
    grid.replaceChildren();
    empty.replaceChildren(h('div', { class: 'empty' },
      h('div', { class: 'empty__icon', text: '👻' }),
      h('b', { text: 'No costumes entered yet' }),
      h('p', { text: state.myEntry ? 'Yours is in. Check back as other people scan the code.' : 'Be the first — add yours from the menu.' })
    ));
    return;
  }
  empty.replaceChildren();

  let rank = 0, lastVotes = null, shown = 0;
  grid.replaceChildren(...state.entries.map((e) => {
    shown++;
    if (state.revealed) {
      if (e.votes !== lastVotes) { rank = shown; lastVotes = e.votes; }
    }
    return entryCard(e, rank);
  }));
}

function entryCard(e, rank) {
  const medalled = state.revealed && rank >= 1 && rank <= 3 && (e.votes || 0) > 0;
  const cls = ['card'];
  if (e.is_mine) cls.push('is-mine');
  if (e.id === state.votedId) cls.push('is-voted');
  if (e.id === state.selectedId && e.id !== state.votedId) cls.push('is-selected');
  if (medalled) cls.push('card--rank' + rank);

  const people = e.member_names && e.member_names.length
    ? roster(e)
    : e.owner_name;

  return h('button', {
    class: cls.join(' '),
    type: 'button',
    'aria-pressed': e.id === state.votedId ? 'true' : 'false',
    onclick: () => tapCard(e)
  },
    h('div', { class: 'card__media' },
      e.photo_path
        ? h('img', { src: photoUrl(e.photo_path), alt: e.title, loading: 'lazy', decoding: 'async' })
        : h('div', { class: 'card__noimg', text: '👻' }),
      e.is_mine
        ? h('span', { class: 'badge badge--mine', text: 'Your costume' })
        : (e.is_group ? h('span', { class: 'badge badge--group', text: 'Group' }) : null),
      medalled ? h('span', { class: 'medal', text: ['🥇', '🥈', '🥉'][rank - 1] }) : null
    ),
    h('div', { class: 'card__body' },
      h('div', { class: 'card__title', text: e.title }),
      h('div', { class: 'card__people', text: people }),
      state.revealed
        ? h('div', { class: 'card__tally' },
            h('b', { text: String(e.votes || 0) }),
            h('span', { text: (e.votes === 1 ? 'vote' : 'votes') })
          )
        : null
    )
  );
}

function tapCard(e) {
  if (serverNow() >= state.closesAt) { toast('Voting is closed.', 'bad'); return; }
  if (e.is_mine) { toast('You cannot vote for your own costume.', 'bad'); buzz(40); return; }
  if (e.id === state.votedId) { toast('That is already your vote.'); return; }

  state.selectedId = state.selectedId === e.id ? null : e.id;
  buzz(12);
  paintCards();
  paintActionbar();
}

/* Sticky bar: only appears when there is a pending change to commit */
function paintActionbar() {
  const bar = $('actionbar');
  const btn = $('btn-vote');
  const note = $('vote-note');

  const closed = !state.closesAt || serverNow() >= state.closesAt;
  const pick = state.entries.find((e) => e.id === state.selectedId);
  const pending = pick && pick.id !== state.votedId && !closed;

  bar.classList.toggle('is-up', Boolean(pending));
  if (!pending) return;

  btn.textContent = (state.votedId ? 'Change my vote to ' : 'Vote for ') + `“${pick.title}”`;
  note.textContent = 'You can change your vote until the timer runs out.';
}

$('btn-vote').addEventListener('click', async () => {
  const pick = state.entries.find((e) => e.id === state.selectedId);
  if (!pick || state.busy) return;

  state.busy = true;
  const btn = $('btn-vote');
  loading(btn, true);
  try {
    await api.castVote(state.me.id, pick.id);
    state.votedId = pick.id;
    state.selectedId = null;
    toast(`Vote locked in for “${pick.title}”`, 'good');
    buzz([18, 40, 18]);
    paintAll();
    refresh(true);
  } catch (err) {
    toast(err.message, 'bad');
    buzz(70);
    refresh(true);
  } finally {
    loading(btn, false);
    state.busy = false;
  }
});

$('btn-refresh').addEventListener('click', () => refresh(false));


/* ── Menu sheet ──────────────────────────────────────────────────────── */

function openSheet() {
  const s = $('sheet');
  if (typeof s.showModal === 'function') s.showModal();
  else s.setAttribute('open', '');
}
function closeSheet() {
  const s = $('sheet');
  if (typeof s.close === 'function') s.close();
  else s.removeAttribute('open');
}

$('btn-menu').addEventListener('click', openSheet);
$('menu-close').addEventListener('click', closeSheet);
$('sheet').addEventListener('click', (ev) => { if (ev.target === $('sheet')) closeSheet(); });

$('menu-edit').addEventListener('click', () => {
  closeSheet();
  openCostume('v-dash', null);
});

$('menu-results').addEventListener('click', () => { closeSheet(); location.href = 'admin.html'; });

$('menu-switch').addEventListener('click', () => {
  closeSheet();
  session.clear();
  Object.assign(state, {
    me: null, myEntry: null, votedId: null, selectedId: null,
    members: [], photoBlob: null, photoPath: null, entries: []
  });
  $('in-name').value = '';
  $('in-phone').value = '';
  show('v-name');
  $('in-name').focus();
});

$('menu-wipe').addEventListener('click', () => {
  closeSheet();
  demoStore.wipe();
  session.clear();
  location.reload();
});


/* ── Timers ──────────────────────────────────────────────────────────── */

// The clock ticks locally; a countdown that hits zero flips the page over to
// results, so that moment also triggers one fetch.
let wasOpen = null;
setInterval(() => {
  if (!$('v-dash').classList.contains('is-active') || !state.closesAt) return;
  paintClock();
  const open = serverNow() < state.closesAt;
  if (wasOpen === null) wasOpen = open;
  else if (wasOpen && !open) {
    wasOpen = false;
    state.selectedId = null;
    refresh(true);
  } else {
    wasOpen = open;
  }
}, 1000);

// New costumes keep appearing all night, so poll while the page is visible.
setInterval(() => {
  if (document.hidden) return;
  if (!$('v-dash').classList.contains('is-active')) return;
  refresh(true);
}, 20000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && $('v-dash').classList.contains('is-active')) refresh(true);
});


/* ── Boot ────────────────────────────────────────────────────────────── */

(async function boot() {
  $('brand-year').textContent = CFG.PARTY_YEAR || '';
  paintModeNotes();

  let info;
  try {
    info = await api.partyInfo();
  } catch (err) {
    bootFail(err.message);
    return;
  }
  adoptInfo(info);

  const saved = session.get();
  if (!saved || !saved.id) {
    show('v-name');
    return;
  }

  // Re-check in on load: it refreshes this guest's entry and vote, and
  // self-heals if the database was reset since they last opened the page.
  try {
    const res = await api.joinParty(saved.full_name, saved.phone);
    adoptJoin(res);
    await goDash();
  } catch {
    session.clear();
    show('v-name');
  }
})();
