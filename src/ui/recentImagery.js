/**
 * Recent Imagery readout for the right rail (`#recent-imagery-panel`). The
 * body is a fixed stack in which no block changes height and no control
 * moves, whatever the state: box actions, a notice line, the strip of day
 * cards and its hint line, the selection bar (mode, the two slot rows),
 * opacity, SWAP and export, then a collapsed DETAILS card for every note and
 * hedge. Box actions, export and DETAILS are rail-card blocks and cards; the
 * strip and selection bar are this adapter's own keyed DOM. Source toggles
 * live on the data-panel row.
 */
import { createRailCardBlocks } from './railCardBlocks.js';
import { createRailCards } from './railCards.js';
import { createImagerySplit } from './imagerySplit.js';
import {
  PRODUCTS,
  hhmm,
  shortDay,
  wvsSnapshotUrl,
} from '../layers/recentImagery/model.js';

const PANEL_ID = 'recent-imagery-panel';
const OVERVIEW_MIN_BOX_KM = 25;
const ESRI_NOTE =
  'Citra Esri aktif · Google 3D kembali setelah pilihan dihapus';
const MODE_LABELS = [
  ['image', 'CITRA'],
  ['basemap', 'VS PETA DASAR'],
  ['ab', 'A / B'],
];
const START_HERE_TITLES = {
  clear:
    'Hari terbaru dengan sedikit awan untuk area ini · awan pada citra, bukan area',
  cloudy: 'Hari terbaru yang mencakup area ini · tutupan awan lebih dari 20%',
  partial: 'Hari terbaru dengan citra untuk area ini · cakupan sebagian',
  overview: 'Ringkasan harian terbaru untuk area ini',
};
const START_HERE_REASONS = {
  clear: 'hari terbaru yang cerah',
  cloudy: 'hari terbaru (berawan)',
  partial: 'hari terbaru (cakupan sebagian)',
  overview: 'ringkasan terbaru',
};
const PLACEHOLDERS = {
  empty: 'Tidak ada citra',
  error: 'Tidak tersedia',
  present: 'Memuat',
};
const KEY_STEPS = {
  ArrowLeft: (index) => index - 1,
  ArrowRight: (index) => index + 1,
  Home: () => 0,
  End: (index, total) => total - 1,
};

// Remounting must not reopen a panel the user already collapsed.
const appearedDocuments = new WeakSet();

const sensorLine = (product) =>
  PRODUCTS[product]
    ? `${PRODUCTS[product].name} · ${PRODUCTS[product].resolutionM} m`
    : product || '';
const utcTime = (iso) => (hhmm(iso) ? `${hhmm(iso)}Z` : '');
const longerSideKm = (size) =>
  Math.max(Number(size?.width) || 0, Number(size?.height) || 0);
const kmText = (km) =>
  !Number.isFinite(km)
    ? '?'
    : km >= 100
      ? Math.round(km).toLocaleString('en-US')
      : km.toFixed(1);

function cloudText(candidate) {
  if (candidate.thumbnail?.status === 'empty') return 'tanpa citra';
  if (!candidate.cloud) return 'tutupan awan tidak diketahui';
  const min = Math.round(candidate.cloud.min);
  const max = Math.round(candidate.cloud.max);
  return min === max ? `${min}% awan` : `${min}–${max}% awan`;
}

function countText(snapshot) {
  if (!snapshot.box) return 'TANPA AREA';
  if (snapshot.searching) return 'MENCARI';
  const count = snapshot.candidates.length;
  return `${count} HARI`;
}

/** The one-line hint under the strip: the next thing to do, per state. */
function hintText(snapshot) {
  if (snapshot.zoomToFit) return 'Perbesar atau gambar area yang lebih kecil';
  if (!snapshot.box) return 'Pilih area atau gunakan tampilan';
  if (snapshot.searching) return 'Mencari dalam 30 hari terakhir';
  if (!snapshot.candidates.length)
    return 'Tidak ada hari untuk ditampilkan di area ini';
  const { mode, pins, shown } = snapshot;
  if (shown.swipe !== 'none') return 'Geser pembagi · TUKAR untuk menukar sisi';
  if (mode === 'ab') {
    if (!pins.a.key && !pins.b.key)
      return '← → pratinjau · A atau B menyematkan hari terpilih';
    return '← → pratinjau sisi lain · A atau B menyematkannya';
  }
  if (pins.a.key) return 'S pada hari lain menggantinya · × melepas pin';
  return '← → pratinjau · S menampilkan hari terpilih';
}

/**
 * Bring a newly opened card into the scrolled body: one write to the body's
 * own scroll position, never on a refresh.
 */
function revealCard(scroller, card) {
  const height = scroller?.clientHeight;
  if (!(height > 0) || typeof card?.getBoundingClientRect !== 'function')
    return;
  const view = scroller.getBoundingClientRect();
  const box = card.getBoundingClientRect();
  const top = box.top - view.top - (scroller.clientTop || 0);
  const delta =
    top < 0 || box.height > height
      ? top
      : Math.max(0, top + box.height - height);
  if (delta) scroller.scrollTop = (scroller.scrollTop || 0) + delta;
}

/** Depth-first search over `children`, for nodes the blocks module owns. */
function findIn(root, predicate) {
  for (const child of root?.children || []) {
    if (predicate(child)) return child;
    const inner = findIn(child, predicate);
    if (inner) return inner;
  }
  return null;
}

/**
 * Mount the readout into the panel body.
 * @param {{ container: HTMLElement, layer: object, viewer?: object, tool?: object, createSplit?: Function, fetchImpl?: typeof fetch, createObjectUrl?: Function, revokeObjectUrl?: Function, requestRender?: Function }} deps
 * @returns {{ root: HTMLElement, exportImage: (slot?: 'a' | 'b') => Promise<boolean>, destroy: () => void } | null}
 */
export function createRecentImageryPanel({
  container,
  layer,
  viewer = null,
  tool = null,
  createSplit = createImagerySplit,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  createObjectUrl = (blob) => URL.createObjectURL(blob),
  revokeObjectUrl = (url) => URL.revokeObjectURL(url),
  requestRender = () => viewer?.scene?.requestRender?.(),
} = {}) {
  const document = container?.ownerDocument;
  if (!document?.createElement || !layer) return null;
  const panel = document.getElementById?.(PANEL_ID) || null;
  const count = document.getElementById?.(`${PANEL_ID}-count`) || null;

  const listeners = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push([target, type, handler, options]);
  };
  const el = (tag, className, parent, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    parent?.appendChild(node);
    return node;
  };
  const set = (node, key, value) => {
    if (node[key] !== value) node[key] = value;
  };
  const attribute = (node, key, value) => {
    if (node.getAttribute(key) !== value) node.setAttribute(key, value);
  };
  const toggle = (node, name, on) => {
    if (node.classList.contains(name) !== Boolean(on))
      node.classList.toggle(name, Boolean(on));
  };

  // ---- build: every block exists from the start, in its final order ----
  const root = el('section', 'recent-imagery-readout');
  root.setAttribute('aria-label', 'Citra terbaru');

  const actionsHost = el('div', 'ri-block ri-actions-row', root);
  actionsHost.id = 'ri-actions';
  const actions = createRailCardBlocks({
    container: actionsHost,
    cardId: 'recent-imagery',
    onParams: () => {},
  });

  // The notice line: the text, and ZOOM IN in a fixed slot at its right end
  // (reserved, never removed, whenever there is nothing to fit).
  const notice = el('div', 'ri-block ri-line ri-notice', root);
  notice.id = 'ri-notice';
  const noticeText = el('span', 'ri-notice-text', notice);
  noticeText.id = 'ri-notice-text';
  noticeText.setAttribute('role', 'status');
  noticeText.setAttribute('aria-live', 'polite');
  const zoomIn = el('button', 'data-toggle-chip ri-zoom-in', notice, 'ZOOM IN');
  zoomIn.id = 'ri-zoom-in';
  zoomIn.type = 'button';
  zoomIn.title = 'Perbesar hingga tampilan sesuai batas 1.000 km';

  const strip = el('div', 'ri-block ri-strip', root);
  strip.id = 'ri-strip';
  strip.tabIndex = 0;
  strip.setAttribute('role', 'listbox');
  strip.setAttribute('aria-orientation', 'horizontal');
  strip.setAttribute(
    'aria-label',
    'Imagery days, newest first · arrows move, S or A and B pin',
  );
  strip.setAttribute('aria-keyshortcuts', 'A B S');
  const stripEmpty = el('div', 'ri-strip-empty', strip);

  const hint = el('div', 'ri-block ri-line ri-hint', root);
  hint.id = 'ri-hint';

  const selection = el('section', 'ri-block ri-selection', root);
  selection.id = 'ri-selection';
  selection.setAttribute('aria-label', 'Pada peta');
  const modeGroup = el('div', 'ri-mode', selection);
  modeGroup.id = 'ri-mode';
  modeGroup.setAttribute('role', 'radiogroup');
  modeGroup.setAttribute('aria-label', 'Mode tampilan');
  const modeButtons = new Map(
    MODE_LABELS.map(([mode, label]) => {
      const node = el('button', 'data-toggle-chip ri-mode-btn', modeGroup);
      node.type = 'button';
      node.textContent = label;
      node.dataset.mode = mode;
      node.setAttribute('role', 'radio');
      return [mode, node];
    }),
  );
  const slotRows = {};
  for (const slotId of ['a', 'b']) {
    const row = el('div', 'ri-slot', selection);
    row.id = `ri-slot-${slotId}`;
    const tag = el('span', 'ri-slot-tag', row);
    const value = el('span', 'ri-slot-value', row);
    const unpin = el('button', 'data-toggle-chip ri-unpin', row, '×');
    unpin.type = 'button';
    unpin.id = `ri-unpin-${slotId}`;
    unpin.dataset.unpin = slotId;
    slotRows[slotId] = { row, tag, value, unpin };
  }

  const controls = el('div', 'ri-block ri-controls', root);
  controls.id = 'ri-controls';
  const opacityLabel = el('label', 'ri-opacity-label', controls);
  el('span', '', opacityLabel, 'OPACITY');
  const opacityValue = el('span', 'ri-opacity-value', opacityLabel, '100%');
  const opacity = el('input', 'ri-opacity', controls);
  opacity.id = 'ri-opacity';
  Object.assign(opacity, {
    type: 'range',
    min: '0',
    max: '100',
    step: '1',
    value: '100',
  });
  opacity.setAttribute('aria-label', 'Opasitas citra');
  opacityLabel.htmlFor = 'ri-opacity';
  // Its slot is always there; it is only usable while a swipe is live.
  const swap = el('button', 'data-toggle-chip ri-swap', controls, 'TUKAR');
  swap.id = 'ri-swap';
  swap.type = 'button';
  swap.title = 'Tukar posisi kedua sisi pembagi';
  const exportHost = el('div', 'ri-exports', controls);
  const exports = createRailCardBlocks({
    container: exportHost,
    cardId: 'recent-imagery',
    onParams: () => {},
  });

  const detailsHost = el('div', 'ri-details', root);
  detailsHost.id = 'ri-details';
  let detailsOpen = false;
  let detailsShownOpen = false;
  const details = createRailCards({
    container: detailsHost,
    document,
    cardClassName: 'ri-details-card',
    onOpen: () => {
      detailsOpen = !detailsOpen;
      render();
    },
  });

  container.appendChild(root);

  // ---- state ------------------------------------------------------------
  const cards = new Map();
  let stripKeys = '';
  let snapshot = layer.getSnapshot();
  let split = null;
  let splitSignature = '';
  let exportError = null;
  const exporting = new Set();
  let destroyed = false;

  /**
   * The body is the scroll container and no render may move it: a
   * re-render, a thumbnail arriving or a notification never sends the
   * operator back to the top.
   */
  function preserveScroll(fn) {
    const top = Number(container.scrollTop) || 0;
    try {
      return fn();
    } finally {
      if ((Number(container.scrollTop) || 0) !== top) container.scrollTop = top;
    }
  }

  // ---- box actions ------------------------------------------------------
  function renderActions() {
    actions.update([
      {
        id: 'box',
        type: 'actions',
        actions: [
          {
            id: 'select-box',
            label: 'PILIH AREA',
            title: 'Tarik untuk memilih area pada peta (Esc membatalkan)',
            onClick: () => {
              exportError = null;
              if (tool?.isActive()) tool.cancel('toggle');
              else tool?.start();
            },
          },
          {
            id: 'use-view',
            label: 'GUNAKAN TAMPILAN',
            title: 'Gunakan tampilan saat ini sebagai area',
            onClick: () => {
              exportError = null;
              layer.useCurrentView(viewer);
            },
          },
          {
            id: 'clear',
            label: 'HAPUS',
            title: 'Hapus area dan citranya',
            disabled: !snapshot.box && !snapshot.boxError,
            onClick: () => {
              exportError = null;
              layer.clear();
            },
          },
        ],
      },
    ]);
    const selectBox = findIn(
      actionsHost,
      (node) => node.dataset?.actionId === 'select-box',
    );
    if (selectBox) {
      attribute(
        selectBox,
        'aria-pressed',
        String(Boolean(snapshot.toolActive)),
      );
      toggle(selectBox, 'active', snapshot.toolActive);
    }
  }

  // ---- notice -----------------------------------------------------------
  function renderNotice() {
    const warning = snapshot.boxError || snapshot.error || exportError;
    const text =
      warning || snapshot.notice || (snapshot.borrowedEsri ? ESRI_NOTE : '');
    set(noticeText, 'textContent', text);
    attribute(noticeText, 'title', text);
    toggle(notice, 'warn', Boolean(warning));
    toggle(notice, 'info', !warning && Boolean(text));
    // ZOOM IN only for the oversized box or view the notice is showing.
    const fit = Boolean(snapshot.zoomToFit);
    toggle(notice, 'has-action', fit);
    toggle(zoomIn, 'is-reserved', !fit);
    set(zoomIn, 'disabled', !fit);
    attribute(zoomIn, 'aria-hidden', String(!fit));
  }

  // ---- strip ------------------------------------------------------------
  function buildCard(candidate) {
    const card = el('div', 'ri-card');
    card.dataset.key = candidate.key;
    card.setAttribute('role', 'option');
    const entry = { card, image: null, imageUrl: null };
    entry.thumb = el('div', 'ri-thumb', card);
    entry.placeholder = el('span', 'ri-thumb-text', entry.thumb);
    entry.flag = el('span', 'ri-card-flag', entry.thumb);
    entry.start = el('span', 'ri-card-start', entry.thumb, 'MULAI DI SINI');
    entry.date = el('div', 'ri-card-date', card);
    entry.sensor = el('div', 'ri-card-sensor', card);
    entry.cloud = el('div', 'ri-card-cloud', card);
    const chips = el('div', 'ri-card-chips', card);
    entry.chips = {};
    for (const slotId of ['a', 'b']) {
      const chip = el('button', 'data-toggle-chip ri-chip', chips);
      chip.type = 'button';
      chip.tabIndex = -1;
      chip.dataset.slot = slotId;
      entry.chips[slotId] = chip;
    }
    cards.set(candidate.key, entry);
    return card;
  }

  function updateCard(candidate, index) {
    const entry = cards.get(candidate.key);
    if (!entry) return;
    const { card } = entry;
    const day = shortDay(candidate.day);
    const ab = snapshot.mode === 'ab';
    set(card, 'id', `ri-card-${index}`);
    const focused = index === snapshot.focusIndex;
    toggle(card, 'focused', focused);
    attribute(card, 'aria-selected', String(focused));
    toggle(card, 'pinned', Boolean(candidate.pinned));
    toggle(card, 'preview', Boolean(candidate.preview));
    const status = candidate.thumbnail?.status || 'unknown';
    const objectUrl = candidate.thumbnail?.objectUrl || null;
    const shown = status === 'present' && Boolean(objectUrl);
    if (shown && !entry.image) {
      entry.image = el('img', 'ri-thumb-img');
      entry.image.alt = '';
      entry.image.decoding = 'async';
      entry.thumb.insertBefore(entry.image, entry.thumb.children[0] || null);
    }
    if (entry.image && entry.imageUrl !== (shown ? objectUrl : null)) {
      entry.imageUrl = shown ? objectUrl : null;
      entry.image.src = entry.imageUrl || '';
    }
    if (entry.image) set(entry.image, 'hidden', !shown);
    set(entry.placeholder, 'hidden', shown);
    set(entry.placeholder, 'textContent', PLACEHOLDERS[status] || 'Memeriksa');
    if (entry.thumb.dataset.status !== status)
      entry.thumb.dataset.status = status;
    const flag = candidate.preview
      ? 'PRATINJAU'
      : candidate.pending
        ? 'MEMUAT'
        : '';
    set(entry.flag, 'textContent', flag);
    set(entry.flag, 'hidden', !flag);
    const recommended = snapshot.recommended?.key === candidate.key;
    set(entry.start, 'hidden', !recommended);
    if (recommended)
      set(
        entry.start,
        'title',
        START_HERE_TITLES[snapshot.recommended.reason] ||
          'Hari terbaru dengan citra untuk area ini',
      );
    set(entry.date, 'textContent', day);
    set(entry.sensor, 'textContent', sensorLine(candidate.product));
    set(entry.cloud, 'textContent', cloudText(candidate));
    const empty = status === 'empty';
    for (const slotId of ['a', 'b']) {
      const chip = entry.chips[slotId];
      const live = slotId === 'a' || ab;
      const on = candidate.pinned === slotId && live;
      const label = slotId === 'a' ? (ab ? 'A' : 'TAMPILKAN') : 'B';
      set(chip, 'textContent', label);
      set(chip, 'disabled', empty || !live);
      toggle(chip, 'active', on);
      toggle(chip, 'is-reserved', !live);
      attribute(chip, 'aria-pressed', String(on));
      attribute(chip, 'aria-hidden', String(!live));
      attribute(
        chip,
        'aria-label',
        ab
          ? `Sematkan ${day} sebagai ${slotId.toUpperCase()}`
          : `Tampilkan ${day}`,
      );
    }
    const state = candidate.pinned
      ? ab
        ? ` · disematkan ${candidate.pinned.toUpperCase()}`
        : candidate.pinned === 'a'
          ? ' · ditampilkan'
          : ''
      : candidate.preview
        ? ' · pratinjau'
        : '';
    attribute(
      card,
      'aria-label',
      `${day} · ${sensorLine(candidate.product)} · ${cloudText(candidate)}${recommended ? ' · mulai di sini' : ''}${state}`,
    );
  }

  function renderStrip() {
    const candidates = snapshot.candidates;
    const keys = candidates.map((candidate) => candidate.key).join('|');
    if (keys !== stripKeys) {
      stripKeys = keys;
      const wanted = new Set(candidates.map((candidate) => candidate.key));
      for (const [key, entry] of [...cards]) {
        if (wanted.has(key)) continue;
        entry.card.remove();
        cards.delete(key);
      }
      candidates.forEach((candidate, index) => {
        const node = cards.get(candidate.key)?.card || buildCard(candidate);
        if (strip.children[index] !== node)
          strip.insertBefore(node, strip.children[index] || null);
      });
    }
    candidates.forEach(updateCard);
    set(
      stripEmpty,
      'textContent',
      candidates.length
        ? ''
        : !snapshot.box
          ? 'Belum ada area'
          : snapshot.searching
            ? 'Mencari'
            : snapshot.hiddenCount
              ? 'Tidak ada citra di setiap hari'
              : !snapshot.sources.hls && !snapshot.sources.viirs
                ? 'Sumber nonaktif'
                : 'Tidak ada citra',
    );
    set(stripEmpty, 'hidden', candidates.length > 0);
    if (candidates[snapshot.focusIndex])
      attribute(
        strip,
        'aria-activedescendant',
        `ri-card-${snapshot.focusIndex}`,
      );
    else strip.removeAttribute('aria-activedescendant');
    toggle(strip, 'searching', snapshot.searching);
    set(hint, 'textContent', hintText(snapshot));
    attribute(hint, 'title', hint.textContent);
  }

  /**
   * Keyboard only: slide the strip until the focused card is in view. Only
   * `strip.scrollLeft` moves — `scrollIntoView` would also scroll the body.
   */
  function scrollFocusedIntoView() {
    const focus = snapshot.candidates[snapshot.focusIndex];
    const card = focus ? cards.get(focus.key)?.card : null;
    const left = Number(card?.offsetLeft) || 0;
    const width = Number(card?.offsetWidth) || 0;
    const viewLeft = Number(strip.scrollLeft) || 0;
    const viewWidth = Number(strip.clientWidth) || 0;
    if (!width || !viewWidth) return;
    if (left < viewLeft) strip.scrollLeft = left;
    else if (left + width > viewLeft + viewWidth)
      strip.scrollLeft = left + width - viewWidth;
  }

  function reportVisibleRange() {
    const width = Number(strip.clientWidth) || 0;
    if (!width || !snapshot.candidates.length) return;
    const left = Number(strip.scrollLeft) || 0;
    let first = null;
    let last = null;
    snapshot.candidates.forEach((candidate, index) => {
      const card = cards.get(candidate.key)?.card;
      const start = Number(card?.offsetLeft) || 0;
      const end = start + (Number(card?.offsetWidth) || 0);
      if (!card || end < left || start > left + width) return;
      first ??= index;
      last = index;
    });
    if (first !== null) layer.setVisibleRange(first, last);
  }

  // ---- selection bar ----------------------------------------------------
  /** What slot `slotId` holds: its pin, else the preview filling it. */
  function slotImage(slotId) {
    const pin = snapshot.pins[slotId];
    if (pin.key) return { ...pin, preview: false };
    if (snapshot.preview.slot === slotId && snapshot.preview.key)
      return { ...snapshot.preview, preview: true };
    return null;
  }

  function renderSelection() {
    const { mode } = snapshot;
    set(selection.dataset, 'mode', mode);
    for (const [id, node] of modeButtons) {
      const on = id === mode;
      attribute(node, 'aria-checked', String(on));
      toggle(node, 'active', on);
      set(node, 'tabIndex', on ? 0 : -1);
    }
    const ab = mode === 'ab';
    for (const slotId of ['a', 'b']) {
      const { row, tag, value, unpin } = slotRows[slotId];
      const basemapRow = slotId === 'b' && !ab;
      const image = basemapRow ? null : slotImage(slotId);
      const pinned = Boolean(image && !image.preview);
      set(
        tag,
        'textContent',
        ab ? slotId.toUpperCase() : slotId === 'a' ? 'CITRA' : 'VS',
      );
      let text = 'Belum diatur';
      if (basemapRow) text = 'Peta dasar';
      else if (image?.label)
        text = `${image.sourceOff ? 'Sumber nonaktif · ' : ''}${image.label}${
          image.preview
            ? ' · pratinjau'
            : image.candidate && !image.drapable && !image.sourceOff
              ? ' · memuat'
              : ''
        }`;
      set(value, 'textContent', text);
      attribute(value, 'title', text);
      const lit = basemapRow
        ? mode === 'basemap'
        : Boolean(image) && !image.sourceOff;
      set(
        row.dataset,
        'state',
        pinned ? 'pinned' : image ? 'preview' : 'empty',
      );
      toggle(row, 'lit', lit);
      set(unpin, 'disabled', !pinned);
      toggle(unpin, 'is-reserved', !pinned);
      attribute(unpin, 'aria-hidden', String(!pinned));
      attribute(
        unpin,
        'aria-label',
        ab ? `Lepas pin ${slotId.toUpperCase()}` : 'Lepas pin citra',
      );
      set(unpin, 'title', unpin.getAttribute('aria-label'));
    }
  }

  // ---- opacity and export -----------------------------------------------
  /** The image a slot's EXPORT downloads: its pin, else its preview. */
  function exportTarget(slotId) {
    if (slotId === 'b' && snapshot.mode !== 'ab') return null;
    const image = slotImage(slotId);
    return image?.candidate && !image.sourceOff ? image.candidate : null;
  }

  function renderControls() {
    const anything = Boolean(snapshot.shown.a || snapshot.shown.b);
    set(opacity, 'disabled', !anything);
    const alphaValue = String(Math.round(snapshot.alpha * 100));
    if (opacity.value !== alphaValue) opacity.value = alphaValue;
    set(opacityValue, 'textContent', `${alphaValue}%`);
    const swipe = snapshot.comparison.active;
    toggle(swap, 'is-reserved', !swipe);
    set(swap, 'disabled', !swipe);
    attribute(swap, 'aria-hidden', String(!swipe));
    toggle(swap, 'active', swipe && snapshot.swapped);
    attribute(swap, 'aria-pressed', String(swipe && snapshot.swapped));
    const ab = snapshot.mode === 'ab';
    exports.update([
      {
        id: 'export',
        type: 'actions',
        actions: ['a', 'b'].map((slotId) => ({
          id: `export-${slotId}`,
          label: ab ? `EKSPOR ${slotId.toUpperCase()}` : 'EKSPOR',
          title: `Unduh ${ab ? slotId.toUpperCase() : 'citra'} sebagai PNG`,
          disabled: !exportTarget(slotId) || exporting.has(slotId),
          onClick: () => void exportImage(slotId),
        })),
      },
    ]);
    const exportB = findIn(
      exportHost,
      (node) => node.dataset?.actionId === 'export-b',
    );
    if (exportB) {
      toggle(exportB, 'is-reserved', !ab);
      attribute(exportB, 'aria-hidden', String(!ab));
    }
  }

  // ---- details ----------------------------------------------------------
  function detailLines() {
    const focus = snapshot.focus;
    const lines = [];
    if (snapshot.box)
      lines.push({
        id: 'box',
        text: `Area ${kmText(snapshot.boxSizeKm?.width)} × ${kmText(snapshot.boxSizeKm?.height)} km`,
      });
    if (focus) {
      lines.push({ id: 'readout', text: snapshot.readout || '' });
      const times = [];
      if (focus.timeRange?.start) {
        const start = utcTime(focus.timeRange.start);
        const end = utcTime(focus.timeRange.end || focus.timeRange.start);
        times.push(`Diambil ${start === end ? start : `${start}–${end}`}`);
      } else if (focus.thumbnail?.acquisitionTime)
        times.push(`Diambil ${utcTime(focus.thumbnail.acquisitionTime)}`);
      const coverage =
        {
          full: 'penuh',
          partial: 'sebagian',
          unknown: 'tidak diketahui',
        }[focus.coverage] || 'tidak diketahui';
      times.push(`Cakupan ${coverage}`);
      lines.push({ id: 'acquired', text: times.join(' · ') });
      (focus.granules || []).forEach((granule, index) => {
        const cloud = Number.isFinite(granule.cloud)
          ? ` · ${Math.round(granule.cloud)}% awan`
          : '';
        lines.push({
          id: `granule-${index}`,
          text: `${granule.id || granule.product} · ${utcTime(granule.timeStart)}${cloud}`,
          muted: true,
        });
      });
    }
    const reason = START_HERE_REASONS[snapshot.recommended?.reason];
    if (reason) lines.push({ id: 'start', text: `MULAI DI SINI · ${reason}` });
    for (const [index, note] of snapshot.notes.entries())
      lines.push({ id: `note-${index}`, text: note, muted: true });
    if (
      snapshot.sources.viirs &&
      snapshot.box &&
      longerSideKm(snapshot.boxSizeKm) > 0 &&
      longerSideKm(snapshot.boxSizeKm) < OVERVIEW_MIN_BOX_KM
    )
      lines.push({
        id: 'overview-scale',
        text: 'Ringkasan harian menampilkan sedikit detail pada area sekecil ini',
        muted: true,
      });
    lines.push({
      id: 'credit',
      text: 'Citra: NASA GIBS dan Worldview · HLS (Sentinel-2, Landsat 8/9) serta VIIRS',
      muted: true,
    });
    return lines;
  }

  function renderDetails() {
    const hidden = snapshot.hiddenCount;
    const showing = snapshot.showUnavailable;
    details.update([
      {
        id: 'details',
        title: 'Detail',
        open: detailsOpen,
        compact: snapshot.focus ? snapshot.readout : 'Waktu, cakupan, sumber',
        blocks: [
          { id: 'lines', type: 'lines', lines: detailLines() },
          {
            id: 'empty-days',
            type: 'actions',
            actions: [
              {
                id: 'toggle-empty',
                label: showing
                  ? 'SEMBUNYIKAN HARI KOSONG'
                  : `TAMPILKAN HARI KOSONG · ${hidden}`,
                title: 'Hari yang terdeteksi tanpa citra di area ini',
                disabled: !showing && !hidden,
                onClick: () => layer.setShowUnavailable(!showing),
              },
            ],
          },
        ],
      },
    ]);
    if (detailsOpen && !detailsShownOpen)
      revealCard(container, detailsHost.children[0]);
    detailsShownOpen = detailsOpen;
  }

  // ---- divider ----------------------------------------------------------
  function renderSplit() {
    const live = snapshot.comparison.active;
    const basemap = snapshot.shown.swipe === 'basemap';
    const swapped = Boolean(snapshot.swapped);
    const a = snapshot.candidates.find((c) => c.key === snapshot.shown.a);
    const b = snapshot.candidates.find((c) => c.key === snapshot.shown.b);
    const describe = (c) => (c ? `${sensorLine(c.product)} · ${c.day}` : '');
    // The two sides as [label, title, spoken name]; SWAP trades them.
    const sides = [
      basemap ? ['CITRA', describe(a), 'citra'] : ['A', describe(a), 'A'],
      basemap
        ? ['PETA DASAR', 'Peta dasar', 'peta dasar']
        : ['B', describe(b), 'B'],
    ];
    const [before, after] = swapped ? [sides[1], sides[0]] : sides;
    const signature = live
      ? `${snapshot.shown.swipe}|${swapped}|${describe(a)}|${describe(b)}`
      : '';
    if (signature !== splitSignature) {
      split?.destroy();
      split = null;
      splitSignature = signature;
    }
    if (!live || split || destroyed) return;
    split = createSplit({
      scene: viewer?.scene,
      parent: document.body,
      initialValue: snapshot.split,
      id: 'recent-imagery-split-line',
      handleClass: 'recent-imagery-split-handle',
      cssTarget: document.documentElement,
      cssProperty: '--recent-imagery-split',
      beforeLabel: before[0],
      afterLabel: after[0],
      beforeTitle: before[1],
      afterTitle: after[1],
      ariaLabel: basemap
        ? 'Pembagi citra terbaru dan peta dasar'
        : 'Pembagi citra terbaru A dan B',
      formatValueText: (leftPercent, rightPercent) =>
        `${before[2]} ${leftPercent} persen, ${after[2]} ${rightPercent} persen`,
      getViewportWidth: () =>
        Number(viewer?.scene?.canvas?.clientWidth) ||
        Number(document.documentElement?.clientWidth) ||
        0,
      onChange: (value) => layer.setSplit(value),
      requestRender,
    });
    split?.setValue(snapshot.split);
  }

  // ---- panel ------------------------------------------------------------
  function renderPanel() {
    const hidden = !snapshot.enabled;
    if (panel) set(panel, 'hidden', hidden);
    set(root, 'hidden', hidden);
    if (count) set(count, 'textContent', hidden ? '' : countText(snapshot));
    if (hidden || !panel || appearedDocuments.has(document)) return;
    appearedDocuments.add(document);
    // First appearance opens the panel unless a stored or shared collapse
    // choice exists (marked by the panel chrome when it restored the state).
    const preference = panel.dataset?.collapsedPreference;
    if (
      panel.classList.contains('collapsed') &&
      (preference === undefined || preference === 'default')
    )
      panel.querySelector?.(`[data-collapse-target="${PANEL_ID}"]`)?.click();
  }

  function render() {
    if (destroyed) return;
    preserveScroll(() => {
      set(root.dataset, 'mode', snapshot.mode);
      renderPanel();
      renderActions();
      renderNotice();
      renderStrip();
      renderSelection();
      renderControls();
      renderDetails();
      renderSplit();
      reportVisibleRange();
    });
  }

  // ---- export -----------------------------------------------------------
  async function exportImage(slotId = 'a') {
    const candidate = exportTarget(slotId);
    if (!candidate || !snapshot.box || exporting.has(slotId)) return false;
    exporting.add(slotId);
    exportError = null;
    preserveScroll(renderControls);
    // The snapshot is plate carrée: keep the box's degree aspect, with the
    // longer side at the size limit.
    const size = longerSideKm(snapshot.boxSizeKm) > 25 ? 2048 : 1024;
    const spanLon = Math.abs(snapshot.box.east - snapshot.box.west) || 1;
    const spanLat = Math.abs(snapshot.box.north - snapshot.box.south) || 1;
    const width = Math.max(
      1,
      Math.round(size * Math.min(1, spanLon / spanLat)),
    );
    const height = Math.max(
      1,
      Math.round(size * Math.min(1, spanLat / spanLon)),
    );
    try {
      const response = await fetchImpl(
        wvsSnapshotUrl({
          product: candidate.product,
          day: candidate.day,
          box: snapshot.box,
          width,
          height,
        }),
      );
      if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'error'}`);
      const blob = await response.blob();
      if (destroyed) return false;
      const href = createObjectUrl(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `recent-imagery-${candidate.product}-${candidate.day}.png`;
      anchor.hidden = true;
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        revokeObjectUrl(href);
      }
      return true;
    } catch (error) {
      if (!destroyed) exportError = `Ekspor gagal · ${error?.message || error}`;
      return false;
    } finally {
      exporting.delete(slotId);
      if (!destroyed)
        preserveScroll(() => {
          renderControls();
          renderNotice();
        });
    }
  }

  // ---- input ------------------------------------------------------------
  /** Escape clears the preview, then cancels the box tool, then blurs. */
  function escape() {
    if (layer.clearPreview()) return true;
    if (tool?.isActive()) {
      tool.cancel('escape');
      return true;
    }
    strip.blur();
    return false;
  }

  function pin(slotId, key) {
    if (!key) return;
    if (slotId === 'b' && snapshot.mode !== 'ab') return;
    exportError = null;
    layer.toggleAssignment(slotId, key);
  }

  listen(root, 'click', (event) => {
    const target = event.target;
    const chip = target?.closest?.('.ri-chip');
    const card = target?.closest?.('.ri-card');
    if (chip && card) {
      if (!chip.disabled) pin(chip.dataset.slot, card.dataset.key);
      strip.focus({ preventScroll: true });
      return;
    }
    if (card) {
      exportError = null;
      layer.preview(card.dataset.key);
      strip.focus({ preventScroll: true });
      return;
    }
    const mode = target?.closest?.('.ri-mode-btn');
    if (mode) {
      layer.setMode(mode.dataset.mode);
      return;
    }
    if (target?.closest?.('.ri-swap') && !swap.disabled) {
      layer.swapSides?.();
      return;
    }
    const unpin = target?.closest?.('.ri-unpin');
    if (unpin && !unpin.disabled)
      layer.setAssignment(unpin.dataset.unpin, null);
    // The layer owns the camera flight; the panel only asks.
    if (target?.closest?.('.ri-zoom-in') && !zoomIn.disabled)
      layer.zoomToFit?.();
  });

  listen(root, 'input', (event) => {
    if (event.target === opacity) layer.setAlpha(Number(opacity.value) / 100);
  });

  listen(modeGroup, 'keydown', (event) => {
    const order = MODE_LABELS.map(([mode]) => mode);
    const step =
      { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key] ||
      0;
    if (!step) return;
    event.preventDefault();
    const next =
      order[
        (order.indexOf(snapshot.mode) + step + order.length) % order.length
      ];
    layer.setMode(next);
    modeButtons.get(next)?.focus?.();
  });

  listen(strip, 'keydown', (event) => {
    const total = snapshot.candidates.length;
    const index = snapshot.focusIndex || 0;
    const focus = snapshot.candidates[index];
    if (event.key === 'Escape') {
      event.preventDefault();
      escape();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      // Enter is a click on the focused card; key repeat must not re-fire.
      if (focus && !event.repeat) layer.preview(focus.key);
      return;
    }
    const letter = String(event.key || '').toLowerCase();
    const slotId =
      letter === 'a' || (letter === 's' && snapshot.mode !== 'ab')
        ? 'a'
        : letter === 'b'
          ? 'b'
          : null;
    if (slotId) {
      event.preventDefault();
      if (!event.repeat && focus && focus.thumbnail?.status !== 'empty')
        pin(slotId, focus.key);
      return;
    }
    const step = KEY_STEPS[event.key];
    if (!step || !total) return;
    event.preventDefault();
    layer.focus(Math.max(0, Math.min(total - 1, step(index, total))));
    preserveScroll(scrollFocusedIntoView);
  });

  listen(root, 'keydown', (event) => {
    if (event.key === 'Escape' && event.target !== strip) {
      if (
        snapshot.preview.key ||
        snapshot.preview.pending ||
        tool?.isActive()
      ) {
        event.preventDefault();
        escape();
      }
    }
  });

  listen(strip, 'scroll', reportVisibleRange, { passive: true });

  // ---- wiring -----------------------------------------------------------
  layer.setToolHandler?.(() => {
    if (tool?.isActive()) tool.cancel('layer');
  });
  const unsubscribe = layer.subscribe((next, reason) => {
    if (destroyed) return;
    snapshot = next || layer.getSnapshot();
    if (reason === 'split') {
      split?.setValue(snapshot.split);
    } else if (reason === 'alpha') {
      preserveScroll(renderControls);
    } else if (
      reason === 'thumbnail' &&
      snapshot.candidates.map((candidate) => candidate.key).join('|') ===
        stripKeys
    ) {
      // A probe that emptied a day hides its card; only an unchanged strip
      // takes this in-place path.
      preserveScroll(() => {
        snapshot.candidates.forEach(updateCard);
        renderDetails();
      });
    } else {
      render();
    }
  });
  render();

  return {
    root,
    exportImage,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      layer.setToolHandler?.(null);
      split?.destroy();
      split = null;
      for (const [target, type, handler, options] of listeners.splice(0))
        target.removeEventListener(type, handler, options);
      for (const entry of cards.values()) {
        if (entry.image) entry.image.src = '';
      }
      cards.clear();
      actions.destroy();
      exports.destroy();
      details.destroy();
      root.remove();
      if (count) count.textContent = '';
      if (panel) panel.hidden = true;
    },
  };
}
