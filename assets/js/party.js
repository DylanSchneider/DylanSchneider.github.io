/* Party camera: temporary candid photos, separate from costume entries. */
import { api, session, photoUrl, shrinkPhoto, IS_LIVE } from './store.js?v=20261018-5';
import { messageFor } from './messages.js?v=20261018-5';

const CFG = window.PARTY_CONFIG || {};
const $ = (id) => document.getElementById(id);
const h = (tag, attrs, ...kids) => {
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
};

const me = session.get();
let photoBlob = null;
let previewUrl = null;
const photoCards = new Map();
let replies = [];
let replyLoadVersion = 0;
let activeReplyWrites = 0;

function toast(msg, kind) {
  const box = $('toast');
  box.replaceChildren(h('div', { class: `toast ${kind ? 'is-' + kind : ''}`, text: msg }));
  box.classList.add('is-up');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove('is-up'), kind === 'bad' ? 4600 : 2800);
}

function loading(btn, on) { btn.disabled = on; btn.classList.toggle('is-loading', on); }

function photoImage(photo, bucket) {
  const description = bucket === 'costumes'
    ? [photo.title || 'Costume photo', photo.owner].filter(Boolean).join(' — ')
    : [photo.caption || 'Party photo', photo.uploader ? `by ${photo.uploader}` : ''].filter(Boolean).join(' — ');
  // Plain image elements preserve the browser's native save/share menu.
  return h('img', {
    src: photoUrl(photo.path, bucket), alt: description, loading: 'lazy', decoding: 'async'
  });
}

function paintReplies(card) {
  const comments = replies.filter((reply) => reply.photo_id === card.id);
  card.summary.textContent = comments.length
    ? `${comments.length} ${comments.length === 1 ? 'reply' : 'replies'} · Comment or react`
    : 'Comment or react';
  card.list.replaceChildren(...comments.map((reply) => {
    const remove = reply.is_mine ? h('button', {
      class: 'photo-reply-remove', type: 'button', 'aria-label': 'Remove your reply',
      onclick: async () => {
        if (card.busy) return;
        card.busy = true;
        activeReplyWrites++;
        replyLoadVersion++;
        remove.disabled = true;
        card.error.textContent = '';
        try {
          await api.deletePartyPhotoComment(me.id, reply.id);
          replies = replies.filter((item) => item.id !== reply.id);
          paintReplies(card);
        } catch (err) {
          card.error.textContent = messageFor(err, 'Couldn’t remove your reply. Try again.');
        } finally {
          card.busy = false;
          activeReplyWrites--;
          remove.disabled = false;
        }
      }
    }, 'Remove') : null;
    return h('li', { class: 'photo-reply' },
      h('p', {}, h('b', { text: reply.author || 'Guest' }), ' ', h('span', { text: reply.body })),
      remove
    );
  }));
}

async function loadReplies() {
  if (activeReplyWrites || !photoCards.size) return;
  const version = ++replyLoadVersion;
  try {
    const result = await api.listPartyPhotoComments(me.id);
    if (version !== replyLoadVersion) return;
    replies = Array.isArray(result) ? result : [];
    for (const card of photoCards.values()) {
      card.loadStatus.textContent = '';
      paintReplies(card);
    }
  } catch (err) {
    if (version !== replyLoadVersion) return;
    for (const card of photoCards.values()) {
      card.loadStatus.textContent = messageFor(err, 'Replies couldn’t load. Close and reopen this section to try again.');
    }
  }
}

function partyPhotoCard(photo) {
  const card = { id: photo.id, busy: false };
  card.image = photoImage(photo, 'party-photos');
  card.author = h('span', { class: 'party-photo-author', text: photo.uploader || 'Guest' });
  card.caption = h('p', { class: 'party-photo-caption', text: photo.caption || '' });
  card.summary = h('summary', {}, 'Comment or react');
  card.list = h('ul', { class: 'photo-replies-list', 'aria-label': 'Replies' });
  card.loadStatus = h('p', { class: 'hint', 'aria-live': 'polite', text: 'Loading replies…' });
  card.error = h('p', { class: 'err', 'aria-live': 'polite', id: `reply-error-${photo.id}` });
  const input = h('input', {
    class: 'input', type: 'text', maxlength: '100', enterkeyhint: 'send',
    placeholder: 'Add a comment or emoji…', 'aria-label': 'Add a comment or emoji',
    'aria-describedby': card.error.id
  });
  const send = h('button', { class: 'btn btn--ghost btn--sm', type: 'submit', disabled: true }, 'Send');
  input.addEventListener('input', () => { send.disabled = !input.value.trim(); });
  const form = h('form', { class: 'photo-reply-form' }, input, send);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (card.busy || !body) return;
    card.busy = true;
    activeReplyWrites++;
    replyLoadVersion++;
    input.disabled = true;
    loading(send, true);
    card.error.textContent = '';
    try {
      const saved = await api.addPartyPhotoComment(me.id, photo.id, body);
      replies.push(saved);
      input.value = '';
      card.loadStatus.textContent = '';
      paintReplies(card);
    } catch (err) {
      card.error.textContent = messageFor(err, 'Your reply wasn’t sent. Try again.');
    } finally {
      card.busy = false;
      activeReplyWrites--;
      input.disabled = false;
      loading(send, false);
      send.disabled = !input.value.trim();
    }
  });
  const details = h('details', { class: 'photo-replies' },
    card.summary, card.loadStatus, card.list, form, card.error
  );
  details.addEventListener('toggle', () => { if (details.open) loadReplies(); });
  card.node = h('figure', { class: 'party-photo', 'data-photo-id': photo.id },
    card.image, h('figcaption', {}, card.author, card.caption), details
  );
  paintReplies(card);
  return card;
}

function paintPartyPhotos(photos) {
  const gallery = $('party-gallery');
  const ids = new Set(photos.map((photo) => photo.id));
  for (const [id, card] of photoCards) {
    if (ids.has(id)) continue;
    card.node.remove();
    photoCards.delete(id);
  }
  photos.forEach((photo, index) => {
    let card = photoCards.get(photo.id);
    if (!card) {
      card = partyPhotoCard(photo);
      photoCards.set(photo.id, card);
    }
    card.caption.textContent = photo.caption || '';
    card.author.textContent = photo.uploader || 'Guest';
    // Reuse cards so refreshing preserves expanded threads and typed replies.
    if (gallery.children[index] !== card.node) gallery.insertBefore(card.node, gallery.children[index] || null);
  });
}

async function loadGallery() {
  try {
    const [raw, entries, info] = await Promise.all([
      api.listPartyPhotos(me.id), api.listEntries(me.id), api.partyInfo()
    ]);
    const photos = Array.isArray(raw) ? raw : [];
    const costumes = (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry.photo_path)
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        path: entry.photo_path,
        owner: entry.members?.find((member) => member.is_owner)?.name || ''
      }));

    $('costume-count').textContent = `${costumes.length} ${costumes.length === 1 ? 'photo' : 'photos'}`;
    $('party-count').textContent = `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`;
    $('costume-gallery').replaceChildren(...costumes.map((photo) => photoImage(photo, 'costumes')));
    $('costume-empty').replaceChildren();
    if (!costumes.length) $('costume-empty').append(h('div', { class: 'empty' },
      h('div', { class: 'empty__icon', text: '🎭' }), h('b', { text: 'The cast is still arriving' })
    ));

    paintPartyPhotos(photos);
    loadReplies();
    $('party-empty').replaceChildren();
    if (!photos.length) $('party-empty').append(h('div', { class: 'empty' },
      h('div', { class: 'empty__icon', text: '📸' }), h('b', { text: 'A curious moment awaits' }),
      h('p', { class: 'fine', text: 'Be the first to capture it.' })
    ));
    $('party-camera-panel').hidden = !info.open;
    if (!info.open) $('party-mode').replaceChildren(h('div', { class: 'note note--warn' },
      h('b', { text: 'The camera has retired for the night' }), ' The memories are yours to keep.'
    ));
  } catch (err) { toast(messageFor(err), 'bad'); }
}

function partyCostumeGate() {
  $('party-gate').replaceChildren(
    h('div', { class: 'note note--warn' },
      h('b', { text: 'A place in the cast awaits' }), ' Enter your costume first.'),
    h('a', { class: 'btn btn--primary btn--block', href: 'index.html', style: 'margin-top:14px' }, '← Enter my costume')
  );
}

function initializePartyCamera() {
  $('party-content').hidden = false;
  if (!IS_LIVE) $('party-mode').replaceChildren(h('div', { class: 'note note--warn' },
    h('b', { text: 'Dress rehearsal' }), ' Practice photos only.'));

  $('party-photo-file').addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    $('party-photo-error').textContent = '';
    $('party-upload').disabled = true;
    try {
      photoBlob = await shrinkPhoto(file, CFG.PHOTO_MAX_EDGE, CFG.PHOTO_QUALITY);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(photoBlob);
      $('party-preview-image').src = previewUrl;
      $('party-preview').hidden = false;
      $('party-upload').disabled = false;
    } catch (err) {
      photoBlob = null;
      $('party-preview').hidden = true;
      $('party-photo-error').textContent = 'Try a different photo.';
      ev.target.value = '';
    }
  });

  $('party-upload').addEventListener('click', async (ev) => {
    if (!photoBlob) return;
    const btn = ev.currentTarget;
    const status = $('party-upload-status');
    loading(btn, true);
    btn.textContent = 'Adding…';
    status.textContent = '';
    try {
      await api.uploadPartyPhoto(me.id, photoBlob, $('party-caption').value.trim());
      toast('Photo added to the album', 'good');
      status.textContent = '';
      $('party-photo-file').value = '';
      $('party-caption').value = '';
      photoBlob = null;
      $('party-preview').hidden = true;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
      btn.disabled = true;
      await loadGallery();
    } catch (err) {
      status.textContent = messageFor(err, 'Your photo slipped away. Try again.');
    }
    finally { loading(btn, false); btn.textContent = 'Add to album'; btn.disabled = !photoBlob; }
  });

  $('party-refresh').addEventListener('click', loadGallery);
  setInterval(() => { if (!document.hidden) loadReplies(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadReplies(); });
  loadGallery();
}

if (!me) {
  $('party-gate').replaceChildren(
    h('div', { class: 'note note--warn' },
      h('b', { text: 'Your invitation awaits' }), ' Join the tea party first.'),
    h('a', { class: 'btn btn--primary btn--block', href: 'index.html', style: 'margin-top:14px' }, '← Join the tea party')
  );
} else {
  api.listEntries(me.id).then((entries) => {
    const hasCostume = (Array.isArray(entries) ? entries : []).some((entry) => entry.is_mine);
    if (!hasCostume) {
      partyCostumeGate();
      return;
    }
    initializePartyCamera();
  }).catch((err) => {
    $('party-gate').replaceChildren(
      h('p', { class: 'err', text: messageFor(err) }),
      h('button', { class: 'btn btn--ghost btn--block', type: 'button', onclick: () => location.reload() }, 'Try again')
    );
  });
}
