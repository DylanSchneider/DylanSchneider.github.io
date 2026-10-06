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
const selectedLooks = new Map();

function toast(msg, kind) {
  const box = $('toast');
  box.replaceChildren(h('div', { class: `toast ${kind ? 'is-' + kind : ''}`, text: msg }));
  box.classList.add('is-up');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove('is-up'), kind === 'bad' ? 4600 : 2800);
}

function loading(btn, on) { btn.disabled = on; btn.classList.toggle('is-loading', on); }

function photoTile(photo, bucket, kind) {
  const normal = photoUrl(photo.normal_path, bucket);
  const film = photo.film_path ? photoUrl(photo.film_path, bucket) : null;
  const title = kind === 'costume'
    ? (photo.title || 'Costume photo')
    : (photo.uploader || 'Party photo');
  const filePrefix = kind === 'costume' ? 'costume' : 'party';
  const lookKey = `${kind}:${photo.id}`;
  const description = photo.caption || photo.title || `Party photo by ${title}`;
  const img = h('img', { loading: 'lazy', decoding: 'async' });
  const save = h('a', {
    class: 'btn party-photo-save', target: '_blank', rel: 'noopener noreferrer'
  }, 'Save');
  const normalButton = film ? h('button', {
    class: 'photo-look__button', type: 'button', onclick: () => show('normal')
  }, 'Normal') : null;
  const filmButton = film ? h('button', {
    class: 'photo-look__button', type: 'button', onclick: () => show('film')
  }, 'Film') : null;

  function show(look) {
    const isFilm = look === 'film' && Boolean(film);
    const version = isFilm ? 'film' : 'normal';
    const url = isFilm ? film : normal;
    selectedLooks.set(lookKey, version);
    img.src = url;
    img.alt = `${description} — ${isFilm ? 'film' : 'normal'} version`;
    // The preview and its single Save action always use the same version.
    save.href = url;
    save.download = `${filePrefix}-${photo.id}-${version}.jpg`;
    save.setAttribute('aria-label', `Save ${version} photo: ${title}`);
    normalButton?.setAttribute('aria-pressed', String(!isFilm));
    filmButton?.setAttribute('aria-pressed', String(isFilm));
  }
  show(selectedLooks.get(lookKey) || 'normal');

  return h('article', { class: 'party-photo-tile' },
    h('div', { class: 'party-photo-tile__image' }, img),
    h('div', { class: 'party-photo-tile__body' },
      h('div', { class: 'party-photo-tile__meta' },
        h('h3', { text: title }),
        (photo.caption || photo.owner) ? h('p', { text: photo.caption || photo.owner }) : null
      ),
      h('div', { class: 'party-photo-tile__actions' },
        film ? h('div', { class: 'photo-look', role: 'group', 'aria-label': 'Photo version' }, normalButton, filmButton) : null,
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
        film_path: entry.photo_path_film || null,
        owner: entry.members?.find((member) => member.is_owner)?.name || ''
      }));

    $('costume-count').textContent = `${costumes.length} ${costumes.length === 1 ? 'photo' : 'photos'}`;
    $('party-count').textContent = `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`;
    $('costume-gallery').replaceChildren(...costumes.map((photo) => photoTile(photo, 'costumes', 'costume')));
    $('costume-empty').replaceChildren();
    if (!costumes.length) $('costume-empty').append(h('div', { class: 'empty' },
      h('div', { class: 'empty__icon', text: '🎭' }), h('b', { text: 'No costume photos yet' }),
      h('p', { class: 'fine', text: 'Costume photos will appear here after someone enters one.' })
    ));

    $('party-gallery').replaceChildren(...photos.map((photo) => photoTile(photo, 'party-photos', 'party')));
    $('party-empty').replaceChildren();
    if (!photos.length) $('party-empty').append(h('div', { class: 'empty' },
      h('div', { class: 'empty__icon', text: '📸' }), h('b', { text: 'No party photos yet' }),
      h('p', { class: 'fine', text: 'Be the first person to capture a curious moment.' })
    ));
    $('party-camera-panel').hidden = !info.open;
    if (!info.open) $('party-mode').replaceChildren(h('div', { class: 'note note--warn' },
      h('b', { text: 'The party camera is closed.' }), ' You can still browse and save the photos below.'
    ));
  } catch (err) { toast(err.message, 'bad'); }
}

function partyCostumeGate(message) {
  $('party-gate').replaceChildren(
    h('div', { class: 'note note--warn' },
      h('b', { text: 'Enter your costume first' }), ` ${message || 'The Party Pictures page opens after your costume data and photo are saved.'}`),
    h('a', { class: 'btn btn--primary btn--block', href: 'index.html', style: 'margin-top:14px' }, '← Set up my costume')
  );
}

function initializePartyCamera() {
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
      $('party-preview').hidden = true;
      $('party-photo-error').textContent = 'That photo could not be processed. Try another photo.';
      ev.target.value = '';
    }
  });

  $('party-upload').addEventListener('click', async (ev) => {
    if (!variants) return;
    const btn = ev.currentTarget;
    const status = $('party-upload-status');
    loading(btn, true);
    btn.textContent = 'Uploading…';
    status.textContent = 'Uploading both photo versions…';
    try {
      await api.uploadPartyPhoto(me.id, variants, $('party-caption').value.trim());
      toast('Photo saved to the party wall.', 'good');
      status.textContent = 'Added to the album. Choose Normal or Film below, then tap Save.';
      $('party-photo-file').value = '';
      $('party-caption').value = '';
      variants = null;
      $('party-preview').hidden = true;
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
      previewUrls = [];
      btn.disabled = true;
      await loadGallery();
    } catch (err) {
      status.textContent = 'Upload did not finish. Check your connection and try again.';
      toast(err.message, 'bad');
    }
    finally { loading(btn, false); btn.textContent = 'Add to party pictures'; btn.disabled = !variants; }
  });

  $('party-refresh').addEventListener('click', loadGallery);
  loadGallery();
}

if (!me) {
  $('party-gate').replaceChildren(
    h('div', { class: 'note note--warn' },
      h('b', { text: 'Check in first' }), ' Return to the party page and enter your name and phone number to use the camera.'),
    h('a', { class: 'btn btn--primary btn--block', href: 'index.html', style: 'margin-top:14px' }, '← Back to check-in')
  );
} else {
  api.listEntries(me.id).then((entries) => {
    const hasCostume = (Array.isArray(entries) ? entries : []).some((entry) => entry.is_mine);
    if (!hasCostume) {
      partyCostumeGate();
      return;
    }
    initializePartyCamera();
  }).catch((err) => partyCostumeGate(err.message));
}
