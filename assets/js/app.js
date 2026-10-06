/* =====================================================================
   Halloween Party — guest app
   Screens: check in → costume (join / start solo / start group / edit) → vote
   ===================================================================== */

import { api, session, photoUrl, shrinkPhoto, IS_LIVE } from './store.js?v=20261005-9';
import { messageFor } from './messages.js?v=20261005-9';

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
  costumeMode: 'chooser', // chooser | solo | groups | group | join | edit
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
  const memberName = (m) => displayText(m?.name, 'Guest');
  const costumeName = (m) => displayText(m?.costume_name, 'Costume not entered');
  if (members.length === 1) return memberName(members[0]);
  return members.map((m) => `${memberName(m)} (${costumeName(m)})`).join(', ');
}

function displayText(value, fallback = '') {
  if (value == null) return fallback;
  const text = String(value).trim();
  return /^(null|undefined)$/i.test(text) ? fallback : text;
}


/* ── Rehearsal + unavailable states ──────────────────────────────────── */

function paintModeNotes() {
  if (IS_LIVE) return;
  const note = () => h('div', { class: 'note note--warn' },
    h('b', { text: 'Dress rehearsal' }),
    'Practice only. These votes won’t count at the party.'
  );
  $('mode-note').replaceChildren(note());
  $('mode-note-2').replaceChildren(note());
}

function bootFail(error) {
  $('boot-msg').textContent = 'A curious delay';
  $('boot-extra').replaceChildren(
    h('p', { class: 'fine', text: messageFor(error, 'Wonderland isn’t ready just yet. Try again in a moment, or check with the host.') }),
    h('button', {
      class: 'btn btn--ghost btn--block', style: 'margin-top:16px', type: 'button',
      onclick: () => location.reload()
    }, 'Try again')
  );
  show('v-boot');
}


/* ── Step 1 · check in ───────────────────────────────────────────────── */

function phoneDigits(raw) {
  const all = String(raw).replace(/\D/g, '');
  return all.length === 11 && all.startsWith('1') ? all.slice(1) : all.slice(0, 10);
}

function formatPhone(raw) {
  const d = phoneDigits(raw);
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

for (const part of ['first', 'last']) {
  $(`in-${part}-name`).addEventListener('input', () => fieldError(`err-${part}-name`, `in-${part}-name`, ''));
}

$('form-name').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const givenName = $('in-first-name').value.trim().replace(/\s+/g, ' ');
  const familyName = $('in-last-name').value.trim().replace(/\s+/g, ' ');
  // Keep the existing guest API and history compatible with separate inputs.
  const name = `${givenName} ${familyName}`;
  const phone = $('in-phone').value;
  const digits = phoneDigits(phone);

  let bad = false;
  if (!givenName) {
    fieldError('err-first-name', 'in-first-name', 'Enter your first name.');
    bad = true;
  }
  if (!familyName) {
    fieldError('err-last-name', 'in-last-name', 'Enter your last name.');
    bad = true;
  }
  if (digits.length !== 10) {
    fieldError('err-phone', 'in-phone', 'Enter a 10-digit mobile number.');
    bad = true;
  }
  if (bad) {
    $('form-name').querySelector('[aria-invalid="true"]')?.focus();
    buzz(40);
    return;
  }

  const btn = $('btn-name');
  if (btn) loading(btn, true);
  const flight = window.rabbitFall?.start?.() || Promise.resolve();
  try {
    const res = await api.joinParty(name, phone);
    // The tunnel reaches black before the destination view is revealed. This
    // prevents the costume page from flashing underneath the handoff while
    // Supabase is finishing the check-in request.
    await flight;
    adoptJoin(res);
    await recoverMembership();
    if (state.membership) {
      goHub();
      toast('Welcome back, ' + firstName() + '!', 'good');
    } else {
      openCostume('v-name');
    }
    window.rabbitFall?.finish?.();
  } catch (err) {
    window.rabbitFall?.cancel?.();
    toast(messageFor(err), 'bad');
    buzz(60);
  } finally {
    if (btn) loading(btn, false);
  }
});

function adoptJoin(res) {
  state.me = res.guest;
  state.membership = res.membership || null;
  state.votedId = res.voted_entry_id || null;
  session.set(res.guest);
}

async function recoverMembership() {
  if (state.membership || !state.me?.id) return;
  try {
    const entries = await api.listEntries(state.me.id);
    const mine = (Array.isArray(entries) ? entries : []).find((entry) => entry.is_mine);
    if (!mine) return;
    const member = (Array.isArray(mine.members) ? mine.members : [])
      .find((item) => item.name === state.me.full_name);
    state.membership = {
      entry_id: mine.id,
      entry_type: mine.entry_type || (mine.is_group ? 'group' : 'solo'),
      title: mine.title,
      photo_path: mine.photo_path,
      is_owner: Boolean(member?.is_owner),
      costume_name: member?.costume_name || mine.title,
      members: mine.members
    };
  } catch { /* the normal join response remains the source of truth */ }
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
  const isEdit = state.costumeMode === 'edit';
  btn.classList.add('icon-btn');
  btn.classList.remove('linkback');
  btn.textContent = '←';
  btn.setAttribute('aria-label', isEdit
    ? (state.costumeReturn === 'v-hub' ? 'Back to party home' : 'Back to voting')
    : (state.costumeMode === 'chooser' ? 'Back' : 'Choose differently'));
}

$('btn-back').addEventListener('click', () => {
  if (state.costumeMode === 'edit') state.costumeReturn === 'v-hub' ? goHub() : goDash();
  else if (state.costumeMode === 'chooser') {
    if (state.costumeReturn === 'v-dash') goDash();
    else show(state.costumeReturn || 'v-name');
  }
  else renderCostume(['group', 'join'].includes(state.costumeMode) ? 'groups' : 'chooser');
});

$('btn-costume-refresh').addEventListener('click', async () => {
  const btn = $('btn-costume-refresh');
  if (!state.me?.id || state.busy) return;
  loading(btn, true);
  try {
    const res = await api.joinParty(state.me.full_name, state.me.phone);
    adoptJoin(res);
    await recoverMembership();
    if (state.membership) renderCostume('edit');
    else openCostume('v-name');
    toast('All caught up.');
  } catch (err) {
    toast(messageFor(err), 'bad');
  } finally {
    loading(btn, false);
  }
});

function openCostume(returnTo) {
  state.costumeReturn = returnTo || 'v-dash';
  show('v-costume');
  renderCostume(state.membership ? 'edit' : 'chooser');
}

function renderCostume(mode, ctx) {
  state.costumeMode = mode;
  updateBackButton();
  const topTitle = $('costume-top-title');
  if (topTitle) topTitle.textContent = {
    chooser: 'Your costume', solo: 'Solo costume', groups: 'Group', group: 'Start a group',
    join: 'Join a group', edit: 'Edit costume'
  }[mode] || 'Costume';
  const refreshButton = $('btn-costume-refresh');
  if (refreshButton) refreshButton.hidden = mode !== 'edit';
  const slot = $('costume-slot');
  slot.replaceChildren();
  if (mode === 'chooser') renderChooser(slot);
  else if (mode === 'solo') renderSoloForm(slot);
  else if (mode === 'groups') renderGroupChooser(slot);
  else if (mode === 'group') renderGroupForm(slot);
  else if (mode === 'join') renderJoinForm(slot, ctx);
  else if (mode === 'edit') renderEditForm(slot);
}

let fieldSequence = 0;
function field(labelText, inputEl, errEl, placeholder, hintText) {
  inputEl.id ||= `costume-field-${++fieldSequence}`;
  errEl.id = `${inputEl.id}-error`;
  errEl.setAttribute('aria-live', 'polite');
  inputEl.setAttribute('aria-describedby', errEl.id);
  inputEl.classList.add('input');
  if (placeholder) inputEl.setAttribute('placeholder', placeholder);
  inputEl.setAttribute('autocapitalize', 'words');
  inputEl.setAttribute('autocomplete', 'off');
  inputEl.setAttribute('enterkeyhint', 'done');
  inputEl.setAttribute('maxlength', '80');
  return h('div', { class: 'field' },
    h('label', { class: 'label', for: inputEl.id }, labelText),
    inputEl,
    hintText ? h('p', { class: 'hint', text: hintText }) : null,
    errEl
  );
}

/** A photo picker that produces a normal, print-friendly JPEG blob. */
function buildPhotoField(existingUrl, required = false) {
  let picked = existingUrl ? undefined : null;
  let objectUrl = null;

  const img = h('img', { class: 'photo__img', alt: 'Costume' });
  const err = h('p', { class: 'err' });
  // Leaving capture unset lets the phone's native picker offer its own
  // Camera / Photos / Files choices from this one large photo control.
  const photoInput = h('input', { type: 'file', accept: 'image/*' });

  const removeBtn = h('button', {
    class: 'btn btn--ghost btn--sm', type: 'button', style: 'margin-top:10px',
    onclick: () => {
      picked = null;
      photoInput.value = '';
      setPreview(null);
    }
  }, 'Remove photo');
  removeBtn.style.display = existingUrl ? '' : 'none';

  const box = h('label', { class: 'photo' },
    photoInput,
    h('span', { class: 'photo__empty' },
      h('span', { class: 'photo__icon', text: '📸' }),
      h('b', { text: 'Add a photo' }),
      h('span', { class: 'fine', text: 'Camera or photo library' })
    ),
    img,
    h('span', { class: 'photo__swap', text: 'Change' })
  );
  if (existingUrl) { img.src = existingUrl; box.classList.add('has-img'); }

  function setPreview(url) {
    if (objectUrl && objectUrl !== url) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    if (url) {
      img.src = url;
      objectUrl = url.startsWith('blob:') ? url : null;
      box.classList.add('has-img');
      removeBtn.style.display = '';
    }
    else { img.removeAttribute('src'); box.classList.remove('has-img'); removeBtn.style.display = 'none'; }
  }

  async function handleFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    err.textContent = '';
    box.classList.add('is-busy');
    try {
      const normal = await shrinkPhoto(
        file, CFG.PHOTO_MAX_EDGE, IS_LIVE ? CFG.PHOTO_QUALITY : 0.78
      );
      picked = { normal };
      setPreview(URL.createObjectURL(normal));
    } catch (e) {
      ev.target.value = '';
      err.textContent = messageFor(e, 'Try a different photo.');
    } finally {
      box.classList.remove('is-busy');
    }
  }

  photoInput.addEventListener('change', handleFile);

  return {
    node: h('div', { class: 'field' },
      h('span', { class: 'label' }, 'Photo ', h('span', { class: 'opt', text: required ? '— required' : '— optional' })),
      h('p', { class: 'hint photo-instructions', text: 'Strike a pose at the back-patio photo board.' }),
      box, err, removeBtn
    ),
    get: () => picked,
    setError: (msg) => { err.textContent = msg || ''; }
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

function renderChooser(slot) {
  slot.replaceChildren(
    h('p', { class: 'eyebrow' }, 'Step 2 of 2 · Your costume'),
    h('h2', { class: 'section-title costume-heading' }, 'How are you arriving?'),
    h('div', { class: 'wonder-signpost costume-choices' },
      costumeChoice('solo', '♠', 'Solo', 'A curious character'),
      costumeChoice('groups', '♥', 'Group', 'A cast of characters')
    )
  );
}

function costumeChoice(mode, glyph, title, detail) {
  const isSolo = mode === 'solo';
  return h('button', {
    class: `wonder-sign costume-choice ${isSolo ? 'wonder-sign--teal' : 'wonder-sign--rose wonder-sign--left'}`,
    type: 'button', onclick: () => renderCostume(mode)
  },
    h('span', { class: 'wonder-sign__glyph', 'aria-hidden': 'true', text: glyph }),
    h('span', { class: 'wonder-sign__copy' },
      h('small', { text: isSolo ? 'This way' : 'Together, that way' }),
      h('b', { text: title }),
      h('span', { text: detail })
    )
  );
}

async function renderGroupChooser(slot) {
  // A local container prevents a slow response from replacing a newer screen.
  const groups = h('div', { 'aria-live': 'polite' },
    h('p', { class: 'hint' }, 'Looking for your group…'));
  slot.replaceChildren(
    h('p', { class: 'eyebrow' }, 'Group'),
    h('h2', { class: 'section-title costume-heading' }, 'Find your cast of characters'),
    h('p', { class: 'hint' }, 'Join your group, or be the first to start it.'),
    groups,
    h('div', { class: 'choice-divider' }, 'First one here?'),
    h('button', {
      class: 'btn btn--primary btn--block', type: 'button', onclick: () => renderCostume('group')
    }, 'Start a group')
  );

  try {
    const entries = await api.listEntries(state.me.id);
    if (!groups.isConnected) return;
    const list = entries.filter((entry) => entry.entry_type === 'group' || entry.is_group);
    groups.replaceChildren(
      h('h3', { class: 'group-list-title' }, 'Join your group'),
      list.length
        ? h('div', { class: 'rank' }, ...list.map((e) => joinRow(e, false)))
        : h('p', { class: 'hint' }, 'The cast is still arriving. Start your group below.'),
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', style: 'margin-top:12px',
        onclick: () => renderCostume('groups')
      }, 'Refresh')
    );
  } catch {
    if (!groups.isConnected) return;
    groups.replaceChildren(
      h('p', { class: 'err' }, 'Your group is out of sight. Try again.'),
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => renderCostume('groups')
      }, 'Try again')
    );
  }
}

function renderSoloForm(slot) {
  const title = h('input', {});
  const err = h('p', { class: 'err' });
  const photo = buildPhotoField('', true);

  const btn = h('button', { class: 'btn btn--primary btn--block', type: 'button' }, 'Enter my costume');
  btn.addEventListener('click', async () => {
    const t = title.value.trim().replace(/\s+/g, ' ');
    if (t.length < 2) { err.textContent = 'Give your costume a name.'; buzz(40); return; }
    const photoBlob = photo.get();
    if (!photoBlob) {
      photo.setError('Add your costume photo.');
      buzz(40);
      return;
    }
    loading(btn, true);
    try {
      const saved = await api.createEntry(state.me.id, t, t, photoBlob, 'solo');
      mergeMembership(saved);
      goHub();
      toast('You’ve joined the cast!', 'good');
      buzz(30);
    } catch (e) {
      toast(messageFor(e), 'bad'); buzz(60);
    } finally {
      loading(btn, false);
    }
  });

  slot.replaceChildren(
    h('p', { class: 'eyebrow', style: 'margin-top:0' }, 'Solo costume'),
    h('div', { class: 'panel', style: 'margin-top:8px' },
      field('Costume name', title, err, 'e.g. Mad Hatter'),
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
  const photo = buildPhotoField('', true);

  const btn = h('button', { class: 'btn btn--primary btn--block', type: 'button' }, 'Start this group');
  btn.addEventListener('click', async () => {
    const g = groupName.value.trim().replace(/\s+/g, ' ');
    const r = yourRole.value.trim().replace(/\s+/g, ' ');
    let bad = false;
    if (g.length < 2) { errG.textContent = 'Give your group a name.'; bad = true; }
    if (r.length < 1) { errR.textContent = 'Enter your costume or character.'; bad = true; }
    const photoBlob = photo.get();
    if (!photoBlob) {
      photo.setError('Add one photo of your group.');
      bad = true;
    }
    if (bad) { buzz(40); return; }

    loading(btn, true);
    try {
      const saved = await api.createEntry(state.me.id, g, r, photoBlob, 'group');
      mergeMembership(saved);
      goHub();
      toast('Your cast is ready. Friends can join now.', 'good');
      buzz(30);
    } catch (e) {
      toast(messageFor(e), 'bad'); buzz(60);
    } finally {
      loading(btn, false);
    }
  });

  slot.replaceChildren(
    h('p', { class: 'eyebrow', style: 'margin-top:0' }, 'Group costume'),
    h('p', { class: 'hint' }, 'One group, one photo. Everyone else joins after you.'),
    h('div', { class: 'panel', style: 'margin-top:8px' },
      field('Group costume name', groupName, errG, 'e.g. Alice in Wonderland'),
      field('Your costume in the group', yourRole, errR, 'e.g. Mad Hatter'),
      photo.node,
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
    if (v.length < 1) { err.textContent = 'Enter your costume or character.'; buzz(40); return; }
    loading(btn, true);
    try {
      const saved = await api.joinEntry(state.me.id, entry.id, v);
      mergeMembership(saved);
      goHub();
      toast(`Welcome to “${entry.title}”!`, 'good');
      buzz(30);
    } catch (e) {
      toast(messageFor(e), 'bad'); buzz(60);
      if (/already exists|already have a costume/i.test(e.message)) renderCostume('chooser');
    } finally {
      loading(btn, false);
    }
  });

  slot.replaceChildren(
    h('p', { class: 'eyebrow', style: 'margin-top:0' }, 'Joining a group'),
    h('p', { class: 'hint' }, 'Your place in the cast. No extra photo needed.'),
    h('div', { class: 'rank', style: 'margin-top:10px' }, joinRow(entry, true)),
    h('div', { class: 'panel', style: 'margin-top:14px' },
      field('Your costume in this group', role, err, 'e.g. White Rabbit'),
      h('div', { class: 'stack' }, btn)
    )
  );
}

function renderEditForm(slot) {
  const m = state.membership;
  const members = Array.isArray(m.members) ? m.members : [];
  const isGroup = m.entry_type === 'group' || members.length > 1;
  const isOwner = Boolean(m.is_owner);
  const entryTitle = displayText(m.title, 'Costume');
  const currentCostume = displayText(m.costume_name, entryTitle);

  const titleInput = isOwner ? h('input', { value: entryTitle }) : null;
  const errTitle = h('p', { class: 'err' });
  const roleInput = isGroup ? h('input', { value: currentCostume }) : null;
  const errRole = h('p', { class: 'err' });
  const photo = isOwner ? buildPhotoField(m.photo_path ? photoUrl(m.photo_path) : '', true) : null;

  const saveBtn = h('button', { class: 'btn btn--primary btn--block', type: 'button' }, 'Save changes');
  saveBtn.addEventListener('click', async () => {
    errTitle.textContent = '';
    errRole.textContent = '';
    const role = (isGroup ? roleInput.value : titleInput.value).trim().replace(/\s+/g, ' ');
    if (role.length < 1) {
      (isGroup ? errRole : errTitle).textContent = isGroup ? 'What are you dressed as?' : 'Give your costume a name.';
      buzz(40);
      return;
    }
    const photoValue = isOwner ? photo.get() : undefined;
    if (isOwner && photoValue === null) {
      photo.setError('Keep a costume photo to save your changes.');
      buzz(40);
      return;
    }
    if (isOwner && photoValue === undefined && !m.photo_path) {
      photo.setError('Add a costume photo.');
      buzz(40);
      return;
    }
    let title;
    if (isOwner) {
      title = titleInput.value.trim().replace(/\s+/g, ' ');
      if (title.length < 2) { errTitle.textContent = 'Give your costume (or group) a name.'; buzz(40); return; }
    }

    loading(saveBtn, true);
    try {
      if (isOwner) {
        const saved = await api.updateEntry(state.me.id, title, photoValue, m.photo_path);
        mergeMembership(saved);
      }
      if (role !== currentCostume) mergeMembership(await api.updateMyCostume(state.me.id, role));
      goHub();
      toast('A splendid change of character.', 'good');
    } catch (e) {
      toast(messageFor(e), 'bad');
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
      : confirm('Leave this group?');
    if (!sure) return;
    loading(leaveBtn, true);
    try {
      await api.leaveEntry(state.me.id);
      state.membership = null;
      renderCostume('chooser');
      toast(isOwner ? 'Costume removed.' : 'You left the group.', 'good');
    } catch (e) {
      toast(messageFor(e), 'bad');
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
              entryTitle, ' ', h('span', { class: 'opt', text: '— named by your group’s starter' }))
          ),
      isGroup ? field('Your costume', roleInput, errRole) : null,
      isOwner ? photo.node : null,
      h('div', { class: 'stack' }, saveBtn)
    ),
    isGroup ? h('div', { class: 'panel', style: 'margin-top:14px' },
      h('p', { class: 'eyebrow' }, 'Your cast of characters'),
      h('div', { class: 'chips', style: 'margin-top:10px' },
        ...members.map((x) => h('span', { class: 'chip', style: 'cursor:default' },
          `${displayText(x.name, 'Guest')} — ${displayText(x.costume_name, 'Costume not entered')}${x.is_owner ? ' (started it)' : ''}`)))
    ) : null,
    h('div', { style: 'margin-top:14px' }, leaveBtn)
  );
}


/* ── Dashboard ───────────────────────────────────────────────────────── */

async function goDash() {
  show('v-dash');
  await refresh();
}

function goHub() {
  $('hub-name').textContent = firstName() || 'friend';
  show('v-hub');
}

$('hub-vote').addEventListener('click', () => goDash());
$('hub-photos').addEventListener('click', () => { location.href = 'party.html'; });
$('hub-edit').addEventListener('click', () => openCostume('v-hub'));

function configureContributionLink() {
  // Keep the sign out of the menu until a real Venmo destination is set.
  let url;
  try { url = new URL(CFG.VENMO_URL); } catch { return; }
  if (url.protocol !== 'https:' || !['venmo.com', 'www.venmo.com', 'account.venmo.com'].includes(url.hostname)) return;
  const dialog = $('contribution-dialog');
  const sign = $('hub-contribute');
  $('contribution-venmo').href = url.href;
  sign.addEventListener('click', () => {
    dialog.showModal();
    document.body.classList.add('contribution-open');
  });
  dialog.addEventListener('close', () => document.body.classList.remove('contribution-open'));
  $('contribution-venmo').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const controls = dialog.querySelectorAll('button, a[href]');
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // Close only when a complete tap begins and ends outside the card.
  const outsideCard = (event) => {
    const bounds = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom);
  };
  let backdropPressed = false;
  dialog.addEventListener('pointerdown', (event) => { backdropPressed = outsideCard(event); });
  dialog.addEventListener('pointerup', (event) => {
    if (backdropPressed && outsideCard(event)) dialog.close();
    backdropPressed = false;
  });
  dialog.addEventListener('pointercancel', () => { backdropPressed = false; });
  $('hub-contribute').hidden = false;
}

async function refresh(quiet, repaint = true) {
  const spin = $('btn-refresh');
  if (!quiet) spin.classList.add('is-spinning');
  try {
    const [info, entries] = await Promise.all([
      api.partyInfo(),
      api.listEntries(state.me?.id)
    ]);
    adoptInfo(info);
    state.entries = Array.isArray(entries) ? entries : [];
    if (repaint) paintAll();
  } catch (err) {
    if (!quiet) toast(messageFor(err), 'bad');
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
  $('clock-label').textContent = state.revealed ? 'The race for the crown · closes in' : 'Voting closes in';

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
      h('div', { class: 'winner__name', text: 'No crown claimed' })
    ));
    return;
  }

  const winners = state.entries.filter((e) => (e.votes || 0) === top);
  const label = state.info && serverNow() < state.closesAt ? 'Leading the royal procession' : 'Wonderland’s finest';

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
      closed ? '' : ' · choose another to change it'
    );
  } else if (closed) {
    icon.textContent = '🕛';
    txt.textContent = 'Time’s up. No vote cast.';
  } else if (!state.entries.length) {
    strip.hidden = true;
  } else {
    icon.textContent = '🗳️';
    txt.textContent = 'One vote. Who deserves the crown?';
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
      h('b', { text: 'The cast is still arriving' }),
      h('p', { text: 'Check back in a little while.' })
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
  if (serverNow() >= state.closesAt) { toast('Time’s up. Voting is closed.', 'bad'); return; }
  if (e.is_mine) { toast('Choose someone else’s costume.', 'bad'); buzz(40); return; }
  if (e.id === state.votedId) { toast('Your vote is already here.'); return; }
  if (state.busy) return;

  state.busy = true;
  buzz(12);
  try {
    await api.castVote(state.me.id, e.id);
    state.votedId = e.id;
    toast(`Your vote: “${e.title}”`, 'good');
    buzz([18, 40, 18]);
    paintAll();
    await refresh(true, false);
    paintWinner();
    paintStatus();
  } catch (err) {
    toast(messageFor(err), 'bad');
    buzz(70);
    refresh(true);
  } finally {
    state.busy = false;
  }
}

$('btn-refresh').addEventListener('click', () => refresh(false));


$('btn-hub-back').addEventListener('click', () => goHub());


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
  configureContributionLink();

  let info;
  try {
    info = await api.partyInfo();
  } catch (err) {
    bootFail(err);
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
    await recoverMembership();
    if (state.membership) goHub();
    else openCostume('v-name');
  } catch {
    session.clear();
    show('v-name');
  }
})();
