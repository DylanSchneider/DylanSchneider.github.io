/* =====================================================================
   Halloween Party — guest app
   Screens: check in → costume (join / start solo / start group / edit) → vote
   ===================================================================== */

import { api, session, photoUrl, shrinkPhoto, IS_LIVE, PARTY_ID } from './store.js';

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
  membership: null,    // { entry_id, title, photo_path, is_owner, costume_name, members }
  votedId: null,
  costumeReturn: 'v-name',
  costumeMode: 'chooser', // chooser | solo | group | join | edit
  busy: false
};

const serverNow = () => new Date(Date.now() + state.skew);


/* ── Chrome: views, toasts, haptics ──────────────────────────────────── */

function show(viewId) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('is-active', v.id === viewId);
  window.scrollTo(0, 0);
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

/** costume/group roster as display text: just the name when solo (the
 *  costume name is already the entry title, so repeating it is noise);
 *  "Name (Costume), Name (Costume)" once there's more than one person. */
function rosterText(e) {
  const members = e.members || [];
  if (!members.length) return '';
  if (members.length === 1) return members[0].name;
  return members.map((m) => `${m.name} (${m.costume_name})`).join(', ');
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

function fieldError(errId, inputId, msg) {
  $(errId).textContent = msg || '';
  if (inputId) $(inputId).setAttribute('aria-invalid', msg ? 'true' : 'false');
}

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

  document.body.classList.add('rabbit-fall');
  const btn = $('btn-name');
  if (btn) loading(btn, true);
  try {
    const res = await api.joinParty(name, phone);
    adoptJoin(res);
    if (state.membership) { await goDash(); toast('Welcome back, ' + firstName() + '!'); }
    else openCostume('v-name');
  } catch (err) {
    toast(err.message, 'bad');
    buzz(60);
  } finally {
    if (btn) loading(btn, false);
    window.setTimeout(() => document.body.classList.remove('rabbit-fall'), 2250);
  }
});

function adoptJoin(res) {
  state.me = res.guest;
  state.membership = res.membership || null;
  state.votedId = res.voted_entry_id || null;
  session.set(res.guest);
}

const firstName = () => String(state.me?.full_name || '').split(' ')[0];

/** Merge a create/join/update result into state.membership (each call only
 *  returns the fields it actually changed). */
function mergeMembership(partial) {
  const cur = state.membership || {};
  state.membership = {
    entry_id: partial.entry_id ?? cur.entry_id,
    entry_type: partial.entry_type ?? cur.entry_type,
    title: partial.title ?? cur.title,
    photo_path: 'photo_path' in partial ? partial.photo_path : cur.photo_path,
    is_owner: 'is_owner' in partial ? partial.is_owner : cur.is_owner,
    costume_name: partial.costume_name ?? cur.costume_name,
    members: partial.members ?? cur.members
  };
}


/* ── Step 2 · costume ────────────────────────────────────────────────── */

function updateBackButton() {
  const btn = $('btn-back');
  if (state.costumeMode === 'edit') btn.textContent = '← Back to voting';
  else if (state.costumeMode === 'chooser') btn.textContent = state.costumeReturn === 'v-dash' ? '← Back to voting' : '← Back';
  else btn.textContent = '← Choose differently';
}

$('btn-back').addEventListener('click', () => {
  if (state.costumeMode === 'edit') goDash();
  else if (state.costumeMode === 'chooser') { if (state.costumeReturn === 'v-dash') goDash(); else show('v-name'); }
  else renderCostume('chooser');
});

function openCostume(returnTo) {
  state.costumeReturn = returnTo || 'v-dash';
  show('v-costume');
  renderCostume(state.membership ? 'edit' : 'chooser');
}

function renderCostume(mode, ctx) {
  state.costumeMode = mode;
  updateBackButton();
  const slot = $('costume-slot');
  slot.replaceChildren();
  if (mode === 'chooser') renderChooser(slot);
  else if (mode === 'solo') renderSoloForm(slot);
  else if (mode === 'group') renderGroupForm(slot);
  else if (mode === 'join') renderJoinForm(slot, ctx);
  else if (mode === 'edit') renderEditForm(slot);
}

function field(labelText, inputEl, errEl, placeholder, hintText) {
  inputEl.classList.add('input');
  if (placeholder) inputEl.setAttribute('placeholder', placeholder);
  inputEl.setAttribute('autocapitalize', 'words');
  inputEl.setAttribute('autocomplete', 'off');
  inputEl.setAttribute('enterkeyhint', 'done');
  inputEl.setAttribute('maxlength', '80');
  return h('div', { class: 'field' },
    h('label', { class: 'label' }, labelText),
    inputEl,
    hintText ? h('p', { class: 'hint', text: hintText }) : null,
    errEl
  );
}

/** A photo <label>+<input type=file> with resize-on-pick. get() returns:
 *  undefined = no change (only meaningful when existingUrl was given),
 *  null = photo cleared, or a Blob = a new photo to upload. */
function buildPhotoField(existingUrl) {
  let picked = existingUrl ? undefined : null;
  let objectUrl = null;

  const img = h('img', { class: 'photo__img', alt: 'Costume' });
  const err = h('p', { class: 'err' });
  const removeBtn = h('button', {
    class: 'btn btn--ghost btn--sm', type: 'button', style: 'margin-top:10px',
    onclick: () => { picked = null; fileInput.value = ''; setPreview(null); }
  }, 'Remove photo');
  removeBtn.style.display = existingUrl ? '' : 'none';

  const fileInput = h('input', { type: 'file', accept: 'image/*' });
  const box = h('label', { class: 'photo' },
    fileInput,
    h('span', { class: 'photo__empty' },
      h('span', { class: 'photo__icon', text: '📸' }),
      h('b', { text: 'Add a photo' }),
      h('span', { class: 'fine', text: 'Take one now or pick from your library' })
    ),
    img,
    h('span', { class: 'photo__swap', text: 'Change' })
  );
  if (existingUrl) { img.src = existingUrl; box.classList.add('has-img'); }

  function setPreview(url) {
    if (objectUrl && objectUrl !== url) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    if (url) { img.src = url; box.classList.add('has-img'); removeBtn.style.display = ''; }
    else { img.removeAttribute('src'); box.classList.remove('has-img'); removeBtn.style.display = 'none'; }
  }

  fileInput.addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    err.textContent = '';
    box.classList.add('is-busy');
    try {
      const blob = await shrinkPhoto(file, CFG.PHOTO_MAX_EDGE, IS_LIVE ? CFG.PHOTO_QUALITY : 0.7);
      picked = blob;
      objectUrl = URL.createObjectURL(blob);
      setPreview(objectUrl);
    } catch (e) {
      ev.target.value = '';
      err.textContent = /empty|read as an image/i.test(e.message)
        ? 'That file could not be read as a photo. Try taking a new one with the camera.'
        : e.message;
    } finally {
      box.classList.remove('is-busy');
    }
  });

  return {
    node: h('div', { class: 'field' },
      h('span', { class: 'label' }, 'Photo ', h('span', { class: 'opt', text: '— optional, but photos win votes' })),
      box, err, removeBtn
    ),
    get: () => picked
  };
}

/** One row in the "join an existing costume" list — tappable, or a static
 *  preview (staticOnly) on the join-detail screen. */
function joinRow(e, staticOnly) {
  const cls = ['rank__row'];
  if (!staticOnly) cls.push('rank__row--tap');
  return h('div', { class: cls.join(' '), onclick: staticOnly ? null : () => renderCostume('join', e) },
    h('div', { class: 'rank__pos rank__pos--thumb' },
      e.photo_path ? h('img', { src: photoUrl(e.photo_path), alt: '' }) : '🎭'),
    h('div', { class: 'rank__main' },
      h('div', { class: 'rank__title', text: e.title }),
      h('div', { class: 'rank__sub', text: rosterText(e) })
    ),
    staticOnly ? null : h('button', {
      class: 'btn btn--sm btn--primary', type: 'button',
      onclick: (ev) => { ev.stopPropagation(); renderCostume('join', e); }
    }, 'Join')
  );
}

async function renderChooser(slot) {
  slot.replaceChildren(
    h('p', { class: 'eyebrow' }, 'Step 2 of 2 · Your costume'),
    h('h2', { class: 'section-title', style: 'margin-top:8px' }, 'What are you dressed as?'),
    h('p', { class: 'fine', style: 'margin-top:10px' }, 'Loading costumes already entered…')
  );

  let list = [];
  try {
    const entries = await api.listEntries(state.me.id);
    list = entries.filter((entry) => entry.entry_type === 'group' || entry.is_group);
  } catch { /* still let them start their own below */ }

  const nodes = [
    h('p', { class: 'eyebrow' }, 'Step 2 of 2 · Your costume'),
    h('h2', { class: 'section-title', style: 'margin-top:8px' }, 'What are you dressed as?')
  ];

  if (list.length) {
    nodes.push(h('p', { class: 'hint', style: 'margin:14px 0 10px' },
      'See your group below? Join it instead of starting a new one.'));
    nodes.push(h('div', { class: 'rank' }, ...list.map((e) => joinRow(e, false))));
  }

  nodes.push(h('div', { class: 'choice-divider', text: list.length ? 'or start your own' : 'start your own' }));
  nodes.push(h('div', { class: 'stack', style: 'margin-top:0' },
    h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: () => renderCostume('solo') },
      '🧍 Going solo'),
    h('button', { class: 'btn btn--ghost btn--block', type: 'button', onclick: () => renderCostume('group') },
      '👥 Starting a group costume')
  ));

  slot.replaceChildren(...nodes);
}

function renderSoloForm(slot) {
  const title = h('input', {});
  const err = h('p', { class: 'err' });
  const photo = buildPhotoField('');

  const btn = h('button', { class: 'btn btn--primary btn--block', type: 'button' }, 'Enter my costume');
  btn.addEventListener('click', async () => {
    const t = title.value.trim().replace(/\s+/g, ' ');
    if (t.length < 2) { err.textContent = 'Give your costume a name.'; buzz(40); return; }
    loading(btn, true);
    try {
      const saved = await api.createEntry(state.me.id, t, t, photo.get() || null, 'solo');
      mergeMembership(saved);
      await goDash();
      toast('Costume entered. Good luck!', 'good');
      buzz(30);
    } catch (e) {
      toast(e.message, 'bad'); buzz(60);
    } finally {
      loading(btn, false);
    }
  });

  slot.replaceChildren(
    h('p', { class: 'eyebrow', style: 'margin-top:0' }, 'Solo costume'),
    h('div', { class: 'panel', style: 'margin-top:8px' },
      field('Costume name', title, err, 'e.g. Beetlejuice'),
      photo.node,
      h('div', { class: 'stack' }, btn)
    )
  );
}

function renderGroupForm(slot) {
  const groupName = h('input', {});
  const yourRole = h('input', {});
  const errG = h('p', { class: 'err' });
  const errR = h('p', { class: 'err' });
  const photo = buildPhotoField('');

  const btn = h('button', { class: 'btn btn--primary btn--block', type: 'button' }, 'Start this group');
  btn.addEventListener('click', async () => {
    const g = groupName.value.trim().replace(/\s+/g, ' ');
    const r = yourRole.value.trim().replace(/\s+/g, ' ');
    let bad = false;
    if (g.length < 2) { errG.textContent = 'Give your group a name.'; bad = true; }
    if (r.length < 1) { errR.textContent = 'What are you dressed as in the group?'; bad = true; }
    if (bad) { buzz(40); return; }

    loading(btn, true);
    try {
      const saved = await api.createEntry(state.me.id, g, r, photo.get() || null, 'group');
      mergeMembership(saved);
      await goDash();
      toast('Group started. Send the rest of your group to check in and join it!', 'good');
      buzz(30);
    } catch (e) {
      toast(e.message, 'bad'); buzz(60);
    } finally {
      loading(btn, false);
    }
  });

  slot.replaceChildren(
    h('p', { class: 'eyebrow', style: 'margin-top:0' }, 'Group costume'),
    h('div', { class: 'panel', style: 'margin-top:8px' },
      field('Group costume name', groupName, errG, 'e.g. Alice in Wonderland'),
      field('Your costume in the group', yourRole, errR, 'e.g. Mad Hatter'),
      photo.node,
      h('p', { class: 'hint' },
        'Once the rest of your group checks in, they can find and join this group from their own phone — you only need to enter your own costume here.'),
      h('div', { class: 'stack' }, btn)
    )
  );
}

function renderJoinForm(slot, entry) {
  const role = h('input', {});
  const err = h('p', { class: 'err' });

  const btn = h('button', { class: 'btn btn--primary btn--block', type: 'button' }, `Join "${entry.title}"`);
  btn.addEventListener('click', async () => {
    const v = role.value.trim().replace(/\s+/g, ' ');
    if (v.length < 1) { err.textContent = 'What are you dressed as in this group?'; buzz(40); return; }
    loading(btn, true);
    try {
      const saved = await api.joinEntry(state.me.id, entry.id, v);
      mergeMembership(saved);
      await goDash();
      toast(`Joined "${entry.title}". Good luck!`, 'good');
      buzz(30);
    } catch (e) {
      toast(e.message, 'bad'); buzz(60);
      if (/already exists|already have a costume/i.test(e.message)) renderCostume('chooser');
    } finally {
      loading(btn, false);
    }
  });

  slot.replaceChildren(
    h('p', { class: 'eyebrow', style: 'margin-top:0' }, 'Joining a group'),
    h('div', { class: 'rank', style: 'margin-top:10px' }, joinRow(entry, true)),
    h('div', { class: 'panel', style: 'margin-top:14px' },
      field('Your costume in this group', role, err, 'e.g. White Rabbit'),
      h('div', { class: 'stack' }, btn)
    )
  );
}

function renderEditForm(slot) {
  const m = state.membership;
  const isGroup = m.entry_type === 'group' || (m.members || []).length > 1;
  const isOwner = Boolean(m.is_owner);

  const titleInput = isOwner ? h('input', { value: m.title }) : null;
  const errTitle = h('p', { class: 'err' });
  const roleInput = h('input', { value: m.costume_name });
  const errRole = h('p', { class: 'err' });
  const photo = isOwner ? buildPhotoField(m.photo_path ? photoUrl(m.photo_path) : '') : null;

  const saveBtn = h('button', { class: 'btn btn--primary btn--block', type: 'button' }, 'Save changes');
  saveBtn.addEventListener('click', async () => {
    errTitle.textContent = '';
    errRole.textContent = '';
    const role = roleInput.value.trim().replace(/\s+/g, ' ');
    if (role.length < 1) { errRole.textContent = 'What are you dressed as?'; buzz(40); return; }
    let title;
    if (isOwner) {
      title = titleInput.value.trim().replace(/\s+/g, ' ');
      if (title.length < 2) { errTitle.textContent = 'Give your costume (or group) a name.'; buzz(40); return; }
    }

    loading(saveBtn, true);
    try {
      if (isOwner) mergeMembership(await api.updateEntry(state.me.id, title, photo.get(), m.photo_path));
      if (role !== m.costume_name) mergeMembership(await api.updateMyCostume(state.me.id, role));
      await goDash();
      toast('Costume updated.', 'good');
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      loading(saveBtn, false);
    }
  });

  const leaveBtn = h('button', {
    class: 'btn btn--danger btn--block', type: 'button'
  }, isOwner ? 'Remove this costume' : 'Leave this group');
  leaveBtn.addEventListener('click', async () => {
    const sure = isOwner
      ? confirm('Remove your costume entry? This can’t be undone.')
      : confirm('Leave this group? You can join a different one, or go solo, afterward.');
    if (!sure) return;
    loading(leaveBtn, true);
    try {
      await api.leaveEntry(state.me.id);
      state.membership = null;
      renderCostume('chooser');
      toast(isOwner ? 'Costume removed.' : 'You left the group.', 'good');
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      loading(leaveBtn, false);
    }
  });

  const nameLabel = isGroup ? 'Group costume name' : 'Costume name';
  slot.replaceChildren(
    h('p', { class: 'eyebrow', style: 'margin-top:0' }, isGroup ? 'Edit your group' : 'Edit your costume'),
    h('div', { class: 'panel', style: 'margin-top:8px' },
      isOwner
        ? field(nameLabel, titleInput, errTitle)
        : h('div', { class: 'field' },
            h('span', { class: 'label', text: nameLabel }),
            h('p', { class: 'fine', style: 'margin-top:6px' },
              m.title, ' ', h('span', { class: 'opt', text: '— only the person who started it can rename it' }))
          ),
      field('Your costume', roleInput, errRole),
      isOwner ? photo.node : null,
      h('div', { class: 'stack' }, saveBtn)
    ),
    isGroup ? h('div', { class: 'panel', style: 'margin-top:14px' },
      h('p', { class: 'eyebrow' }, 'Who’s in this group'),
      h('div', { class: 'chips', style: 'margin-top:10px' },
        ...m.members.map((x) => h('span', { class: 'chip', style: 'cursor:default' },
          `${x.name} — ${x.costume_name}${x.is_owner ? ' (started it)' : ''}`)))
    ) : null,
    h('div', { style: 'margin-top:14px' }, leaveBtn)
  );
}


/* ── Dashboard ───────────────────────────────────────────────────────── */

async function goDash() {
  $('me-name').textContent = state.me?.full_name || '—';
  show('v-dash');
  paintMenuLabel();
  await refresh();
}

function paintMenuLabel() {
  $('menu-edit').textContent = state.membership ? '✏️ Edit my costume' : '🎭 Enter a costume';
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
    if (digits.dataset.state !== 'closed') {
      digits.replaceChildren(h('div', { class: 'clock__n', style: 'font-size:22px;padding:6px 0', text: '🕛 Time’s up' }));
      digits.dataset.state = 'closed';
    }
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

  digits.replaceChildren(...units.map(([n, lbl]) =>
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
    h('div', { class: 'winner__meta', text: `${top} ${top === 1 ? 'vote' : 'votes'} · ${rosterText(winners[0])}` })
  ));
}

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
    txt.textContent = 'You have one vote. Tap a costume to cast it.';
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
      h('p', { text: state.membership ? 'Yours is in. Check back as other people scan the code.' : 'Be the first — add yours from the menu.' })
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
  if (medalled) cls.push('card--rank' + rank);

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
      h('div', { class: 'card__people', text: rosterText(e) }),
      state.revealed
        ? h('div', { class: 'card__tally' },
            h('b', { text: String(e.votes || 0) }),
            h('span', { text: (e.votes === 1 ? 'vote' : 'votes') })
          )
        : null
    )
  );
}

async function tapCard(e) {
  if (serverNow() >= state.closesAt) { toast('Voting is closed.', 'bad'); return; }
  if (e.is_mine) { toast('You cannot vote for your own costume.', 'bad'); buzz(40); return; }
  if (e.id === state.votedId) { toast('That is already your vote.'); return; }
  if (state.busy) return;

  state.busy = true;
  buzz(12);
  paintCards();
  try {
    await api.castVote(state.me.id, e.id);
    state.votedId = e.id;
    toast(`Vote locked in for “${e.title}”`, 'good');
    buzz([18, 40, 18]);
    paintAll();
    refresh(true);
  } catch (err) {
    toast(err.message, 'bad');
    buzz(70);
    refresh(true);
  } finally {
    state.busy = false;
  }
}

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
  openCostume('v-dash');
});

$('menu-results').addEventListener('click', () => { closeSheet(); location.href = 'admin.html'; });

$('menu-switch').addEventListener('click', () => {
  closeSheet();
  session.clear();
  Object.assign(state, {
    me: null, membership: null, votedId: null, entries: []
  });
  $('in-name').value = '';
  $('in-phone').value = '';
  show('v-name');
  $('in-name').focus();
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
    if (state.membership) await goDash();
    else openCostume('v-name');
  } catch {
    session.clear();
    show('v-name');
  }
})();
