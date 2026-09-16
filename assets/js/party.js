/* Party camera: temporary candid photos, separate from costume entries. */
import { api, session, photoUrl, processPhotoVariants, IS_LIVE } from './store.js';

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
let variants = null;
let previewUrls = [];

function toast(msg, kind) {
  const box = $('toast');
  box.replaceChildren(h('div', { class: `toast ${kind ? 'is-' + kind : ''}`, text: msg }));
  box.classList.add('is-up');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove('is-up'), kind === 'bad' ? 4600 : 2800);
}

function loading(btn, on) { btn.disabled = on; btn.classList.toggle('is-loading', on); }

function saveLink(url, filename, label) {
  return h('a', { class: 'btn btn--ghost btn--sm', href: url, download: filename, target: '_blank', rel: 'noopener' }, label);
}

function photoTile(photo) {
  const normal = photoUrl(photo.normal_path, 'party-photos');
  const film = photoUrl(photo.film_path, 'party-photos');
  const img = h('img', { src: normal, alt: photo.caption || 'Party photo', loading: 'lazy', decoding: 'async' });
  const show = (url) => { img.src = url; };
  return h('article', { class: 'party-photo-tile' },
    img,
    h('div', { class: 'party-photo-tile__body' },
      h('div', { class: 'party-photo-tile__meta' },
        h('b', { text: photo.uploader ? `📸 ${photo.uploader}` : 'Party photo' }),
        h('span', { class: 'fine', text: photo.caption || '' })
      ),
      h('div', { class: 'party-photo-tile__actions' },
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => show(normal) }, 'Normal'),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => show(film) }, 'Film'),
        saveLink(normal, `party-${photo.id}-normal.jpg`, 'Save normal'),
        saveLink(film, `party-${photo.id}-film.jpg`, 'Save film')
      )
    )
  );
}

async function loadGallery() {
  try {
    const raw = await api.listPartyPhotos(me.id);
    const photos = Array.isArray(raw) ? raw : [];
    $('party-gallery').replaceChildren(...photos.map(photoTile));
    $('party-empty').replaceChildren();
    if (!photos.length) $('party-empty').append(h('div', { class: 'empty' },
      h('div', { class: 'empty__icon', text: '📸' }), h('b', { text: 'No party photos yet' }),
      h('p', { class: 'fine', text: 'Be the first person to capture a curious moment.' })
    ));
  } catch (err) { toast(err.message, 'bad'); }
}

if (!me) {
  $('party-gate').replaceChildren(
    h('div', { class: 'note note--warn' },
      h('b', { text: 'Check in first' }), ' Return to the party page and enter your name and phone number to use the camera.'),
    h('a', { class: 'btn btn--primary btn--block', href: 'index.html', style: 'margin-top:14px' }, '← Back to check-in')
  );
} else {
  $('party-content').hidden = false;
  if (!IS_LIVE) $('party-mode').replaceChildren(h('div', { class: 'note note--warn' },
    h('b', { text: 'Demo mode — this phone only' }), ' Party photos are stored in this browser only.'));

  $('party-photo-file').addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    $('party-photo-error').textContent = '';
    $('party-upload').disabled = true;
    try {
      variants = await processPhotoVariants(file, CFG.PHOTO_MAX_EDGE, CFG.PHOTO_QUALITY, CFG.FILM_QUALITY);
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
      previewUrls = [URL.createObjectURL(variants.normal), URL.createObjectURL(variants.film)];
      $('party-preview-normal').src = previewUrls[0];
      $('party-preview-film').src = previewUrls[1];
      $('party-preview').hidden = false;
      $('party-upload').disabled = false;
    } catch (err) {
      variants = null;
      $('party-photo-error').textContent = 'That photo could not be processed. Try another photo.';
      ev.target.value = '';
    }
  });

  $('party-upload').addEventListener('click', async (ev) => {
    if (!variants) return;
    const btn = ev.currentTarget;
    loading(btn, true);
    try {
      await api.uploadPartyPhoto(me.id, variants, $('party-caption').value.trim());
      toast('Photo saved to the party wall.', 'good');
      $('party-photo-file').value = '';
      $('party-caption').value = '';
      variants = null;
      $('party-preview').hidden = true;
      btn.disabled = true;
      await loadGallery();
    } catch (err) { toast(err.message, 'bad'); }
    finally { loading(btn, false); btn.disabled = !variants; }
  });

  $('party-refresh').addEventListener('click', loadGallery);
  loadGallery();
}
