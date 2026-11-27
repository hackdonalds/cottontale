// Prep → Import: a photo or a picture from the phone becomes a piece of the table's own pack.
//
// One picture at a time, a full-screen step at a time (never a sheet on a sheet):
//   start → crop (one finger moves the picture, two zoom it; the buttons do the same)
//         → cut out (tap a background colour to erase it; rub out; put back)
//         → name it, say what it is (figure / thing / map tile) and which shelf → saved.
// The picture is made small where it is decoded, drawn through a canvas (which also drops
// the camera's EXIF data and with it where the photo was taken), and re-encoded inside a
// budget: 256 px and 60 kB for a token, 2048 px and 600 kB for a map tile. Decoding and
// encoding are the browser's and happen off the main thread; what runs here between frames
// is a flood fill over at most a few megapixels.
//
// The flow's state lives in this module, not in the page: Prep may draw a page again from
// nothing at any time, and coming back to Import picks up where it was left.
import type { Blobs, BlobRef, ServerOutcome } from '../blob';
import { MINI_SHELVES, PROP_SHELVES } from '../catalog';
import { addPiece, listPacks, ownNs, pieceKey, storedText, tableSize, HARD_BYTES, type Entry, type Group } from '../packs';
import {
  INPUT_BYTES, TILE_BYTES, TILE_PX, TOKEN_BIG_PX, TOKEN_BYTES, TOKEN_PX, alphaOf, bytesText, clampCrop, cropRect, decodeSize, encodeSteps, fit,
  floodErase, hasAlpha, imageSize, setAlpha, stroke, zoomCrop, type CropView,
} from '../pixels';
import { registerPrepPage, type PrepCtx } from './prep';

declare module './prep' {
  interface PrepApp {
    /** The table's files (blob.ts). */
    blobs: Blobs;
    /** This player's id and name. */
    me: string;
    playerName: string;
  }
}

type Frame = 'square' | 'portrait' | 'whole';
type As = 'figure' | 'thing' | 'tile';
type Tool = 'tap' | 'erase' | 'restore';
interface Work { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; px: ImageData; alpha0: Uint8Array; undo: Uint8Array[] }
interface Result { name: string; ok: boolean; text: string }

/** The longest side a picture is worked on at: enough for a map tile; a token is cut out at a smaller one. */
const SOURCE_SIDE = 2048, TOKEN_WORK = 768;
const flow = {
  step: 'start' as 'start' | 'opening' | 'crop' | 'cut' | 'name' | 'saving' | 'failed',
  queue: [] as File[],
  src: null as HTMLCanvasElement | null,
  frame: 'square' as Frame,
  view: { s: 0, cx: 0, cy: 0 } as CropView,
  work: null as Work | null,
  tool: 'tap' as Tool,
  tolerance: 28,
  size: 6,
  name: '',
  as: 'figure' as As,
  big: false,
  cells: 4,
  shelf: '',
  note: '',
  saving: '',
  /** What is ready to go to the table when a save is tried again. */
  made: null as { bytes: Uint8Array; mime: string } | null,
  results: [] as Result[],
};
let host: { el: HTMLElement; ctx: PrepCtx } | null = null;

const SVG = {
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3.500L9 5.500h6L16.500 8H20v11H4z"/><circle cx="12" cy="13.200" r="3.300"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3.500" y="5" width="17" height="14" rx="2"/><path d="m3.500 16.500 5-5 4 4 2.500-2.500 5.500 5.500M15.500 9.500h.01"/></svg>',
};
const ico = (id: string) => `<svg><use href="#i-${id}"/></svg>`;

// ---- from a file to pixels --------------------------------------------------------------------

async function open(file: File): Promise<HTMLCanvasElement> {
  if (file.size > INPUT_BYTES) throw new Error(`That file is too large (${bytesText(file.size)}; at most ${bytesText(INPUT_BYTES)}).`);
  const size = imageSize(new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer()));
  let pic: ImageBitmap | HTMLImageElement;
  try {
    // Made small where it is decoded: a 12 megapixel photo never exists at full size in this page.
    const want = size ? fit(...decodeSize(size.w, size.h), SOURCE_SIDE) : null;
    pic = await createImageBitmap(file, want && want[0] < size!.w ? { resizeWidth: want[0], resizeQuality: 'high' } : undefined);
  } catch {
    // A browser without those options, or a format only <img> reads.
    const img = new Image(), url = URL.createObjectURL(file);
    try { img.src = url; await img.decode(); } catch { throw new Error('That is not a picture this phone can open.'); } finally { URL.revokeObjectURL(url); }
    pic = img;
  }
  const pw = 'naturalWidth' in pic ? pic.naturalWidth : pic.width, ph = 'naturalHeight' in pic ? pic.naturalHeight : pic.height;
  if (!pw || !ph) throw new Error('That picture is empty.');
  const [w, h] = fit(...decodeSize(pw, ph), SOURCE_SIDE);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(pic, 0, 0, w, h);
  if ('close' in pic) pic.close();
  return c;
}

/** A canvas scaled to fit `side`, by halves first so a big step down stays smooth. */
function scaled(from: HTMLCanvasElement, side: number): HTMLCanvasElement {
  const [w, h] = fit(from.width, from.height, side);
  let cur = from;
  for (;;) {
    const nw = Math.max(w, Math.ceil(cur.width / 2)), nh = Math.max(h, Math.ceil(cur.height / 2));
    const c = document.createElement('canvas');
    c.width = nw; c.height = nh;
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, nw, nh);
    cur = c;
    if (nw === w && nh === h) return c;
  }
}

const toBlob = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((done) => c.toBlob(done, type, q));

/** Encode inside a budget: WebP where the browser writes it, else JPEG (nothing see-through) or PNG; smaller until it fits. */
async function encode(from: HTMLCanvasElement, side: number, max: number, alpha: boolean): Promise<{ bytes: Uint8Array; mime: string }> {
  let type = 'image/webp', at = 0, c = from;
  for (const [s, q] of encodeSteps(Math.min(side, Math.max(from.width, from.height)))) {
    if (type === 'image/png' && s === at) continue; // no quality to turn down: only a smaller picture helps
    if (s !== at) { c = scaled(from, s); at = s; }
    let blob = await toBlob(c, type, q);
    if (blob && blob.type !== type) { // Safari writes no WebP and hands back a PNG instead
      type = alpha ? 'image/png' : 'image/jpeg';
      if (blob.type !== type) blob = await toBlob(c, type, q);
    }
    if (blob && blob.size <= max) return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
  }
  throw new Error('This picture cannot be made small enough. Try a tighter crop.');
}

// ---- the steps ----------------------------------------------------------------------------------

function paint(): void {
  if (!host?.el.isConnected) return;
  const { el, ctx } = host;
  el.innerHTML = '';
  const box = document.createElement('div');
  box.className = `impFlow${flow.step === 'crop' || flow.step === 'cut' ? ' work' : ''}`;
  box.dataset.step = flow.step;
  el.append(box);
  ({ start, opening: busy, crop, cut, name: naming, saving: busy, failed })[flow.step](box, ctx);
}
const go = (step: typeof flow.step) => { flow.step = step; paint(); };

function reset(): void {
  flow.src = null;
  flow.work = null;
  flow.made = null;
  flow.name = '';
  flow.note = '';
}

/** Take the next picture of the queue, or go back to the start when there is none. */
async function next(): Promise<void> {
  reset();
  const file = flow.queue.shift();
  if (!file) return go('start');
  flow.saving = 'Opening the picture…';
  go('opening');
  try {
    flow.src = await open(file);
  } catch (e) {
    flow.results.unshift({ name: file.name, ok: false, text: e instanceof Error ? e.message : 'That picture could not be opened.' });
    return next();
  }
  const { width: w, height: h } = flow.src;
  // A wide or tall picture is more likely a map than a face.
  flow.frame = Math.max(w, h) / Math.min(w, h) > 1.6 ? 'whole' : 'square';
  flow.view = { s: 0, cx: w / 2, cy: h / 2 };
  flow.name = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/^(img|image|dsc|pxl|photo)[-_ ]?\d*$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 32);
  go('crop');
}

function take(files: FileList | null): void {
  const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|avif|bmp)$/i.test(f.name));
  if (!list.length) { if (files?.length) { flow.results.unshift({ name: files[0].name, ok: false, text: 'That is not a picture.' }); paint(); } return; }
  flow.queue.push(...list.slice(0, 24));
  if (flow.step === 'start') void next();
}

function start(box: HTMLElement, ctx: PrepCtx): void {
  box.innerHTML = `
    <p>Turn a photo or a picture into a piece for this table: a standing figure, a thing, or a map tile laid on the ground.</p>
    <button class="primary impBig" id="impShoot">${SVG.camera}Take a photo</button>
    <button class="impBig" id="impPick">${SVG.image}Choose pictures</button>
    <input type="file" id="impCamera" accept="image/*" capture="environment" hidden />
    <input type="file" id="impFiles" accept="image/*" multiple hidden />
    <ul class="impDone" id="impResults" aria-live="polite"></ul>
    <button id="impPacks">${ico('cube')}The table’s packs</button>
    <p class="hint">Pictures are made small and stripped of where and when they were taken before they leave this phone. A whole table saved earlier comes back with “Import table” in the menu.</p>`;
  const q = <T extends HTMLElement>(id: string) => box.querySelector<T>(`#${id}`)!;
  const cam = q<HTMLInputElement>('impCamera'), files = q<HTMLInputElement>('impFiles');
  q('impShoot').onclick = () => cam.click();
  q('impPick').onclick = () => files.click();
  for (const input of [cam, files]) input.onchange = () => { take(input.files); input.value = ''; };
  q('impPacks').onclick = () => ctx.open('packs');
  const list = q('impResults');
  for (const r of flow.results.slice(0, 8)) {
    const li = document.createElement('li');
    li.className = r.ok ? 'ok' : 'bad';
    li.innerHTML = '<b></b><span></span>';
    li.children[0].textContent = r.name;
    li.children[1].textContent = r.text;
    list.append(li);
  }
  if (!ctx.app.full()) { q<HTMLButtonElement>('impShoot').disabled = q<HTMLButtonElement>('impPick').disabled = true; }
}

function busy(box: HTMLElement): void {
  box.innerHTML = '<p id="impBusy" role="status"></p><progress></progress>';
  box.querySelector('p')!.textContent = flow.saving;
}

function failed(box: HTMLElement): void {
  box.innerHTML = `<p id="impFail" role="alert"></p><div class="impRow"><button id="impBack">${ico('back')}Back</button><button class="primary" id="impRetry">${ico('turn')}Try again</button></div>`;
  box.querySelector('p')!.textContent = flow.note;
  box.querySelector<HTMLElement>('#impBack')!.onclick = () => go(flow.work ? 'name' : 'start');
  box.querySelector<HTMLElement>('#impRetry')!.onclick = () => void save();
}

/** The frame on screen for a canvas of `cw`×`ch` CSS pixels. */
function frameBox(cw: number, ch: number): { fw: number; fh: number } {
  const src = flow.src!, m = 14, aspect = flow.frame === 'square' ? 1 : flow.frame === 'portrait' ? 3 / 4 : src.width / src.height;
  const fh = Math.max(40, Math.min(ch - m * 2, (cw - m * 2) / aspect));
  return { fw: fh * aspect, fh };
}

function crop(box: HTMLElement): void {
  const src = flow.src;
  if (!src) return go('start');
  box.innerHTML = `
    <canvas class="impView" id="impCrop" aria-label="The picture: drag to move it under the frame, pinch to zoom"></canvas>
    <div class="impTools">
      <p class="hint">Move the picture under the frame with one finger; pinch with two to zoom.</p>
      <div class="impRow" role="group" aria-label="Frame">
        <button data-frame="square">Square</button><button data-frame="portrait">Tall</button><button data-frame="whole">All of it</button>
      </div>
      <div class="impRow">
        <button id="impOut" title="Zoom out" aria-label="Zoom out">−</button><button id="impIn" title="Zoom in" aria-label="Zoom in">+</button>
      </div>
      <div class="impRow"><button id="impSkip">${ico('x')}Skip</button><button class="primary" id="impNext">Next${ico('fwd')}</button></div>
      ${flow.queue.length ? `<p class="hint">${flow.queue.length} more to go after this one.</p>` : ''}
    </div>`;
  const c = box.querySelector<HTMLCanvasElement>('#impCrop')!, g = c.getContext('2d')!;
  let cw = 0, ch = 0;
  const draw = () => {
    const dpr = Math.min(2, devicePixelRatio || 1), r = c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    cw = r.width; ch = r.height;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
    const { fw, fh } = frameBox(cw, ch);
    const v = (flow.view = clampCrop(flow.view, src.width, src.height, fw, fh));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, cw / 2 - v.cx * v.s, ch / 2 - v.cy * v.s, src.width * v.s, src.height * v.s);
    // Everything outside the frame is dimmed; the frame itself is a bright line.
    g.fillStyle = 'rgba(8, 6, 5, .68)';
    g.beginPath();
    g.rect(0, 0, cw, ch);
    g.rect((cw - fw) / 2, (ch - fh) / 2, fw, fh);
    g.fill('evenodd');
    g.strokeStyle = '#ffd166';
    g.lineWidth = 2;
    g.strokeRect((cw - fw) / 2, (ch - fh) / 2, fw, fh);
    for (const b of box.querySelectorAll<HTMLButtonElement>('[data-frame]')) {
      b.classList.toggle('on', b.dataset.frame === flow.frame);
      b.setAttribute('aria-pressed', String(b.dataset.frame === flow.frame));
    }
  };
  const zoom = (k: number, px = 0, py = 0) => { flow.view = zoomCrop(flow.view, k, px, py); draw(); };
  for (const b of box.querySelectorAll<HTMLButtonElement>('[data-frame]')) b.onclick = () => { flow.frame = b.dataset.frame as Frame; flow.view.s = 0; draw(); };
  box.querySelector<HTMLElement>('#impIn')!.onclick = () => zoom(1.25);
  box.querySelector<HTMLElement>('#impOut')!.onclick = () => zoom(0.8);
  // One finger moves the picture, two zoom it about the point between them.
  const fingers = new Map<number, { x: number; y: number }>();
  const spread = () => { const [a, b] = [...fingers.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  c.onpointerdown = (e) => { c.setPointerCapture(e.pointerId); fingers.set(e.pointerId, { x: e.clientX, y: e.clientY }); };
  c.onpointermove = (e) => {
    const was = fingers.get(e.pointerId);
    if (!was) return;
    if (fingers.size === 1) {
      flow.view = { ...flow.view, cx: flow.view.cx - (e.clientX - was.x) / flow.view.s, cy: flow.view.cy - (e.clientY - was.y) / flow.view.s };
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    } else if (fingers.size === 2) {
      const a = spread();
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const b = spread(), r = c.getBoundingClientRect();
      flow.view = { ...flow.view, cx: flow.view.cx - (b.x - a.x) / flow.view.s, cy: flow.view.cy - (b.y - a.y) / flow.view.s };
      if (a.d > 8) flow.view = zoomCrop(flow.view, b.d / a.d, b.x - r.left - cw / 2, b.y - r.top - ch / 2);
    }
    draw();
  };
  c.onpointerup = c.onpointercancel = (e) => void fingers.delete(e.pointerId);
  c.addEventListener('wheel', (e) => { e.preventDefault(); const r = c.getBoundingClientRect(); zoom(Math.exp(-e.deltaY * 0.002), e.clientX - r.left - cw / 2, e.clientY - r.top - ch / 2); }, { passive: false });
  new ResizeObserver(draw).observe(c);
  box.querySelector<HTMLElement>('#impSkip')!.onclick = () => void next();
  box.querySelector<HTMLElement>('#impNext')!.onclick = () => {
    draw();
    const { fw, fh } = frameBox(cw || 300, ch || 300), r = cropRect(flow.view, fw, fh);
    const [w, h] = fit(Math.round(r.w), Math.round(r.h), flow.frame === 'whole' ? SOURCE_SIDE : TOKEN_WORK);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const wg = canvas.getContext('2d', { willReadFrequently: true })!;
    wg.imageSmoothingQuality = 'high';
    wg.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, w, h);
    const px = wg.getImageData(0, 0, w, h);
    flow.work = { canvas, g: wg, px, alpha0: alphaOf(px), undo: [] };
    flow.as = flow.frame === 'whole' && Math.max(w, h) > TOKEN_BIG_PX ? 'tile' : flow.as === 'tile' ? 'figure' : flow.as;
    flow.tool = 'tap';
    go('cut');
  };
  draw();
}

function cut(box: HTMLElement): void {
  const work = flow.work;
  if (!work) return go('start');
  box.innerHTML = `
    <div class="impStage" id="impStage"></div>
    <div class="impTools">
      <p class="hint" id="impHow"></p>
      <div class="impRow" role="group" aria-label="Tool">
        <button data-tool="tap">Tap a colour</button><button data-tool="erase">Rub out</button><button data-tool="restore">Put back</button>
      </div>
      <label><span id="impAmountLabel"></span><input type="range" id="impAmount" min="1" max="100" /></label>
      <div class="impRow"><button id="impUndo">${ico('undo')}Undo</button><button id="impFresh">Start over</button></div>
      <div class="impRow"><button id="impBack">${ico('back')}Back</button><button class="primary" id="impNext">Next${ico('fwd')}</button></div>
    </div>`;
  const stage = box.querySelector<HTMLElement>('#impStage')!, c = work.canvas, amount = box.querySelector<HTMLInputElement>('#impAmount')!;
  const { width: w, height: h } = c;
  c.className = 'impCut';
  c.setAttribute('aria-label', 'The picture: tap the background to remove it');
  stage.append(c);
  const size = () => {
    const r = stage.getBoundingClientRect(), k = Math.min((r.width - 8) / w, (r.height - 8) / h);
    if (k > 0) { c.style.width = `${Math.floor(w * k)}px`; c.style.height = `${Math.floor(h * k)}px`; }
  };
  new ResizeObserver(size).observe(stage);
  const show = (b?: { x: number; y: number; w: number; h: number }) => (b ? work.g.putImageData(work.px, 0, 0, b.x, b.y, b.w, b.h) : work.g.putImageData(work.px, 0, 0));
  const tools = () => {
    for (const b of box.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      b.classList.toggle('on', b.dataset.tool === flow.tool);
      b.setAttribute('aria-pressed', String(b.dataset.tool === flow.tool));
    }
    const tap = flow.tool === 'tap';
    box.querySelector('#impHow')!.textContent = tap ? 'Tap the background: everything of that colour around your finger goes. Skip this if the picture is fine as it is.'
      : flow.tool === 'erase' ? 'Rub with one finger to take the picture away.' : 'Rub with one finger to bring the picture back.';
    box.querySelector('#impAmountLabel')!.textContent = tap ? `How alike a colour must be: ${flow.tolerance}` : `Brush size: ${flow.size}`;
    amount.max = tap ? '100' : '30';
    amount.value = String(tap ? flow.tolerance : flow.size);
    box.querySelector<HTMLButtonElement>('#impUndo')!.disabled = !work.undo.length;
  };
  for (const b of box.querySelectorAll<HTMLButtonElement>('[data-tool]')) b.onclick = () => { flow.tool = b.dataset.tool as Tool; tools(); };
  amount.oninput = () => { if (flow.tool === 'tap') flow.tolerance = +amount.value; else flow.size = +amount.value; tools(); };
  // Undo keeps only the alpha: colours are never changed here.
  const keep = () => { work.undo.push(alphaOf(work.px)); if (work.undo.length > (w * h > 1_500_000 ? 3 : 8)) work.undo.shift(); };
  const back = () => { const a = work.undo.pop(); if (a) { setAlpha(work.px, a); show(); } tools(); };
  box.querySelector<HTMLElement>('#impUndo')!.onclick = back;
  box.querySelector<HTMLElement>('#impFresh')!.onclick = () => { keep(); setAlpha(work.px, work.alpha0); show(); tools(); };
  // One finger is the tool. A second finger is never an edit: it takes back what the first had begun.
  const at = (e: PointerEvent): [number, number] => { const r = c.getBoundingClientRect(); return [((e.clientX - r.left) * w) / r.width, ((e.clientY - r.top) * h) / r.height]; };
  let finger: { id: number; x: number; y: number; moved: boolean } | null = null, others = 0;
  const radius = () => Math.max(1.5, (flow.size / 100) * Math.max(w, h) * 0.5);
  c.onpointerdown = (e) => {
    if (finger) { others++; back(); finger = null; return; }
    if (others) { others++; return; }
    c.setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    finger = { id: e.pointerId, x, y, moved: false };
    keep();
    if (flow.tool !== 'tap') show(stroke(work.px, x, y, x, y, radius(), flow.tool === 'restore' ? work.alpha0 : undefined));
  };
  c.onpointermove = (e) => {
    if (!finger || e.pointerId !== finger.id || flow.tool === 'tap') return;
    const [x, y] = at(e);
    show(stroke(work.px, finger.x, finger.y, x, y, radius(), flow.tool === 'restore' ? work.alpha0 : undefined));
    finger = { ...finger, x, y, moved: true };
  };
  c.onpointerup = (e) => {
    if (!finger || e.pointerId !== finger.id) { others = Math.max(0, others - 1); return; }
    if (flow.tool === 'tap') { if (floodErase(work.px, finger.x, finger.y, flow.tolerance)) show(); else work.undo.pop(); }
    finger = null;
    tools();
  };
  c.onpointercancel = (e) => { if (finger?.id === e.pointerId) { back(); finger = null; } else others = Math.max(0, others - 1); };
  box.querySelector<HTMLElement>('#impBack')!.onclick = () => { flow.work = null; go('crop'); };
  box.querySelector<HTMLElement>('#impNext')!.onclick = () => go('name');
  show();
  size();
  tools();
}

/** The library shelves a piece of this sort can go on; '' is the pack's own. */
function shelvesFor(as: As): string[] {
  return as === 'figure' ? Object.keys(MINI_SHELVES) : Object.keys(PROP_SHELVES).filter((n) => n !== 'Structures');
}
const packName = (ctx: PrepCtx): string => listPacks().find((p) => p.ns === ownNs(ctx.app.me))?.name ?? `${ctx.app.playerName.slice(0, 20)}’s pieces`;

function naming(box: HTMLElement, ctx: PrepCtx): void {
  const work = flow.work;
  if (!work) return go('start');
  const own = packName(ctx);
  box.innerHTML = `
    <div class="impHead"><canvas class="impThumb" width="96" height="96"></canvas>
      <label>Name<input id="impName" maxlength="32" autocomplete="off" enterkeyhint="done" placeholder="What is it called?" /></label></div>
    <div class="impRow" role="group" aria-label="What is it?">
      <button data-as="figure">${ico('pawn')}Figure</button><button data-as="thing">${ico('chair')}Thing</button><button data-as="tile">${ico('map')}Map tile</button>
    </div>
    <p class="hint" id="impWhat"></p>
    <div class="impRow" id="impExtra"></div>
    <label>Shelf<select id="impShelf"></select></label>
    <p class="hint bad" id="impNote" role="alert"></p>
    <div class="impRow"><button id="impBack">${ico('back')}Back</button><button class="primary" id="impDone">Done</button></div>`;
  const q = <T extends HTMLElement>(id: string) => box.querySelector<T>(`#${id}`)!;
  const thumb = box.querySelector<HTMLCanvasElement>('.impThumb')!, tg = thumb.getContext('2d')!;
  const [tw, th] = fit(work.canvas.width, work.canvas.height, 96);
  tg.drawImage(work.canvas, (96 - tw) / 2, (96 - th) / 2, tw, th);
  const name = q<HTMLInputElement>('impName'), shelf = q<HTMLSelectElement>('impShelf'), extra = q('impExtra');
  name.value = flow.name;
  name.oninput = () => { flow.name = name.value; };
  name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
  const sync = () => {
    for (const b of box.querySelectorAll<HTMLButtonElement>('[data-as]')) {
      b.classList.toggle('on', b.dataset.as === flow.as);
      b.setAttribute('aria-pressed', String(b.dataset.as === flow.as));
    }
    q('impWhat').textContent = flow.as === 'figure' ? 'A standing token on a base: it moves, has a name, hit points and a turn like any figure.'
      : flow.as === 'thing' ? 'A standing picture without a base, placed like a tree or a barrel.' : 'The picture laid flat on the ground: a map, a rug, a pool of blood.';
    extra.innerHTML = flow.as === 'tile'
      ? `<button id="impLess" title="Smaller" aria-label="Smaller">−</button><span id="impCells">${flow.cells} ${flow.cells === 1 ? 'cell' : 'cells'} wide</span><button id="impMore" title="Larger" aria-label="Larger">+</button>`
      : `<button id="impBig" aria-pressed="${flow.big}" class="${flow.big ? 'on' : ''}">Extra sharp (for a piece drawn large)</button>`;
    if (flow.as === 'tile') {
      q('impLess').onclick = () => { flow.cells = Math.max(1, flow.cells - 1); sync(); };
      q('impMore').onclick = () => { flow.cells = Math.min(16, flow.cells + 1); sync(); };
    } else q('impBig').onclick = () => { flow.big = !flow.big; sync(); };
    const names = shelvesFor(flow.as);
    if (!names.includes(flow.shelf) || flow.shelf === own) flow.shelf = '';
    shelf.innerHTML = '';
    for (const [value, label] of [['', `${own} (a shelf of its own)`], ...names.filter((n) => n !== own).map((n) => [n, n])]) {
      const o = document.createElement('option');
      o.value = value; o.textContent = label; o.selected = value === flow.shelf;
      shelf.append(o);
    }
  };
  for (const b of box.querySelectorAll<HTMLButtonElement>('[data-as]')) b.onclick = () => { flow.as = b.dataset.as as As; sync(); };
  shelf.onchange = () => { flow.shelf = shelf.value; };
  q('impNote').textContent = flow.note;
  q('impBack').onclick = () => { flow.note = ''; go('cut'); };
  q('impDone').onclick = () => {
    flow.name = name.value.replace(/\s+/g, ' ').trim().slice(0, 32);
    if (!flow.name) { flow.note = 'Give it a name first.'; q('impNote').textContent = flow.note; name.focus(); return; }
    flow.note = '';
    flow.made = null;
    void save();
  };
  sync();
}

/** Encode, store, and put the piece in this device's pack. Every way this can fail ends on a page with Try again. */
async function save(): Promise<void> {
  const work = flow.work, ctx = host?.ctx;
  if (!work || !ctx) return go('start');
  const { app } = ctx, tile = flow.as === 'tile', label = flow.name;
  const fail = (why: string) => { flow.note = why; go('failed'); };
  if (!app.full()) return fail('Only the GM can add pieces to this table.');
  try {
    if (!flow.made) {
      flow.saving = `Making “${label}” small…`;
      go('saving');
      work.g.putImageData(work.px, 0, 0);
      flow.made = await encode(work.canvas, tile ? TILE_PX : flow.big ? TOKEN_BIG_PX : TOKEN_PX, tile ? TILE_BYTES : TOKEN_BYTES, hasAlpha(work.px));
    }
    const { bytes, mime } = flow.made;
    if (tableSize() + bytes.length > HARD_BYTES) return fail(`The table’s packs are full (${bytesText(HARD_BYTES)}). Remove something in Packs first.`);
    flow.saving = `Saving “${label}” (${bytesText(bytes.length)})…`;
    go('saving');
    let outcomes: ServerOutcome[] = [];
    const ref: BlobRef = await app.blobs.put(bytes, mime, { report: (o) => { outcomes = o; } });
    const ns = ownNs(app.me), group: Group = flow.as === 'figure' ? 'minis' : 'props';
    const taken = new Set(listPacks().find((p) => p.ns === ns)?.pieces.map((p) => p.name) ?? []);
    const entry: Entry = tile ? { name: label, icon: '🗺️', kind: 'flat', ref, cells: flow.cells } : { name: label, icon: '🖼️', kind: 'standee', ref, h: 1, ...(flow.big ? { big: true } : {}) };
    const done = addPiece(ns, group, pieceKey(label, (k) => taken.has(k)), entry, { shelf: flow.shelf, pack: packName(ctx) });
    if (!done.ok) return fail(done.reason);
    const where = flow.as === 'figure' ? 'Figures' : 'Things';
    flow.results.unshift({ name: label, ok: true, text: `${storedText(ref, outcomes)}. Find it in Build → ${where}, on the shelf “${flow.shelf || packName(ctx)}”.` });
    void next();
  } catch (e) {
    fail(e instanceof Error && e.message ? `That did not work: ${e.message}` : 'That did not work.');
  }
}

export function registerImportPage(): void {
  registerPrepPage({
    id: 'import', title: 'Import', icon: 'open', order: 30, hint: 'Photos and pictures as figures, things and map tiles',
    render(el, ctx) {
      host = { el, ctx };
      paint();
    },
  });
}

/** For tests and other pages: where the flow is. */
export const importFlow = (): { step: string; queued: number; results: Result[] } => ({ step: flow.step, queued: flow.queue.length, results: flow.results });
