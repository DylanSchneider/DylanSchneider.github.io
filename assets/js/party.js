/* Party camera: temporary candid photos, separate from costume entries. */
import { api, session, photoUrl, shrinkPhoto, IS_LIVE } from './store.js?v=20261005-8';
import { messageFor } from './messages.js?v=20261005-8';

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

function toast(msg, kind) {
  const box = $('toast');
  box.replaceChildren(h('div', { class: `toast ${kind ? 'is-' + kind : ''}`, text: msg }));
  box.classList.add('is-up');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove('is-up'), kind === 'bad' ? 4600 : 2800);
}

function loading(btn, on) { btn.disabled = on; btn.classList.toggle('is-loading', on); }

function photoTile(photo, bucket, kind) {
  const url = photoUrl(photo.normal_path, bucket);
  const title = kind === 'costume'
    ? (photo.title || 'Costume photo')
    : (photo.uploader || 'Party photo');
  const filePrefix = kind === 'costume' ? 'costume' : 'party';
  const description = photo.caption || photo.title || `Party photo by ${title}`;
  const img = h('img', { src: url, alt: description, loading: 'lazy', decoding: 'async' });
  const save = h('a', {
    class: 'btn party-photo-save', href: url, download: `${filePrefix}-${photo.id}.jpg`,
    target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Save photo: ${title}`
  }, 'Save');

  return h('article', { class: 'party-photo-tile' },
    h('div', { class: 'party-photo-tile__image' }, img),
    h('div', { class: 'party-photo-tile__body' },
      h('div', { class: 'party-photo-tile__meta' },
        h('h3', { text: title }),
        (photo.caption || photo.owner) ? h('p', { text: photo.caption || photo.owner }) : null
      ),
      h('div', { class: 'party-photo-tile__actions' },
        save
      )
    )
  );
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
        normal_path: entry.photo_path,
        owner: entry.members?.find((member) => member.is_owner)?.name || ''
      }));

    $('costume-count').textContent = `${costumes.length} ${costumes.length === 1 ? 'photo' : 'photos'}`;
    $('party-count').textContent = `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`;
    $('costume-gallery').replaceChildren(...costumes.map((photo) => photoTile(photo, 'costumes', 'costume')));
    $('costume-empty').replaceChildren();
    if (!costumes.length) $('costume-empty').append(h('div', { class: 'empty' },
      h('div', { class: 'empty__icon', text: '🎭' }), h('b', { text: 'The cast is still arriving' })
    ));

    $('party-gallery').replaceChildren(...photos.map((photo) => photoTile(photo, 'party-photos', 'party')));
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
      toast('Another memory for the looking glass.', 'good');
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
