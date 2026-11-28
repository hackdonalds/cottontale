// Prep → Import → "Add a 3D model": a .glb from the phone becomes a figure, a thing or a set
// piece of the table's own pack. Fetched the first time a model is chosen; it draws its steps
// inside the Import page (importPage.ts hands it the page while a model is in hand):
//
//   choose a file → working (the steps are named as they run; Cancel ends the worker)
//                 → preview (the processed model, turning; what it is, how tall, which way it
//                   faces, stood up or not, its name and shelf) → saved, with where it was stored.
//
// Everything heavy happens in a worker that lives for one import (ingest.worker.ts). What is
// previewed is the processed file, read back the way every other device will read it
// (modelBuild.ts). The preview is a small canvas with a renderer of its own, made when the
// page shows and given up (context and all) when it goes; the same renderer takes the picture
// the library shows.
import * as THREE from 'three';
import type { BlobRef, ServerOutcome } from '../blob';
import { GLB_MIME, INPUT_BYTES, PIECE, SET } from '../glb';
import type { IngestStats } from '../ingest';
import { cellsFor, turned } from '../model';
import { decodeModel, materialOf, shape, type Decoded } from '../modelBuild';
import { HARD_BYTES, PIC_BYTES, addPiece, listPacks, ownNs, pieceKey, storedText, tableSize, type Entry } from '../packs';
import { bytesText } from '../pixels';
import type { PrepCtx } from './prep';
import './modelPage.css';

export interface ModelHost {
  /** Draw the Import page again. */
  repaint(): void;
  /** A line for the list of what was imported. */
  result(r: { name: string; ok: boolean; text: string; piece?: { group: 'props' | 'minis'; id: string } }): void;
  packName(ctx: PrepCtx): string;
  shelves(as: 'figure' | 'thing'): string[];
}
type As = 'figure' | 'thing' | 'set';

const DEFAULT_H: Record<As, number> = { figure: 0.9, thing: 1, set: 2 };
const m = {
  step: 'idle' as 'idle' | 'working' | 'preview' | 'saving' | 'failed',
  file: null as File | null,
  label: '',
  steps: [] as string[],
  made: null as { glb: Uint8Array; stats: IngestStats; set: boolean } | null,
  decoded: null as Decoded | null,
  as: 'figure' as As,
  h: 0.9, sized: false,
  yaw: 0, up: false,
  name: '', shelf: '', note: '',
  fail: { why: '', retry: '' as '' | 'save' | 'set' },
  pic: null as { bytes: Uint8Array; mime: string } | null,
};
let host: ModelHost | null = null, shown: PrepCtx | null = null, worker: Worker | null = null, watchdog: ReturnType<typeof setTimeout> | undefined, run = 0;

const ico = (id: string) => `<svg><use href="#i-${id}"/></svg>`;
const num = (n: number) => n.toLocaleString('en-US');
const size = (): [number, number, number] => turned(m.made?.stats.size ?? [1, 1, 1], m.up, m.yaw);
/** The tallest this model stands in one cell, no taller than is usual for what it is. */
function defaultHeight(): number {
  const [x, y, z] = size(), fit = (0.96 * y) / Math.max(x, z, 1e-6);
  return Math.min(4, Math.max(0.3, Math.min(DEFAULT_H[m.as], Math.floor(fit * 20) / 20)));
}
const before = (s: IngestStats) => `${num(s.trisIn)} → ${num(s.trisOut)} triangles, ${bytesText(s.bytesIn)} → ${bytesText(s.bytesOut)}`;

function stop(): void {
  worker?.terminate();
  worker = null;
  clearTimeout(watchdog);
  run++;
}
function forget(): void {
  stop();
  view?.dispose();
  m.decoded?.texture?.dispose();
  (m.decoded?.texture?.image as ImageBitmap | undefined)?.close?.();
  Object.assign(m, { step: 'idle', file: null, made: null, decoded: null, steps: [], note: '', pic: null, yaw: 0, up: false, sized: false });
}
const go = (step: typeof m.step) => { m.step = step; host?.repaint(); };
const failed = (why: string, retry: '' | 'save' | 'set' = '') => { m.fail = { why, retry }; go('failed'); };

/** Take a file the GM chose. One model at a time: a second one waits for nothing and replaces the first. */
export function startModel(file: File, h: ModelHost): void {
  host = h;
  forget();
  m.file = file;
  m.label = file.name;
  m.name = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 32);
  m.as = 'figure';
  if (file.size > INPUT_BYTES) { h.result({ name: file.name, ok: false, text: `That file is too large (${bytesText(file.size)}; a model may be at most ${bytesText(INPUT_BYTES)}).` }); forget(); h.repaint(); return; }
  if (!file.size) { h.result({ name: file.name, ok: false, text: 'That file is empty.' }); forget(); h.repaint(); return; }
  process(false);
}

/** Run the file through the worker, for the budget of a piece or of a set piece. */
function process(set: boolean): void {
  const file = m.file;
  if (!file) return go('idle');
  stop();
  const mine = run;
  m.steps = ['Starting'];
  go('working');
  const w = (worker = new Worker(new URL('../ingest.worker.ts', import.meta.url), { type: 'module' }));
  const end = (why: string) => { if (mine !== run) return; stop(); failed(why, !set && /set piece/.test(why) ? 'set' : ''); };
  watchdog = setTimeout(() => end('This model took too long to work through on this phone. Try a simpler one.'), 180_000);
  w.onerror = () => end('This model could not be worked through on this phone (it may be too large for its memory).');
  w.onmessage = (e) => {
    if (mine !== run) return;
    const msg = e.data as { t: string; text?: string; reason?: string; glb?: ArrayBuffer; stats?: IngestStats; id?: number; job?: import('../ingest').AtlasJob };
    if (msg.t === 'step') {
      m.steps.push(msg.text!);
      const list = document.querySelector('#mdSteps');
      if (list && m.step === 'working') drawSteps(list);
    } else if (msg.t === 'atlas') {
      // A browser whose workers cannot draw: the one picture is drawn here instead.
      void import('../atlasCanvas').then(({ drawAtlas }) => drawAtlas(msg.job!)).then((made) => made, () => null).then((made) => { if (mine === run) w.postMessage({ t: 'atlas', id: msg.id, made }); });
    } else if (msg.t === 'fail') end(msg.reason || 'This model could not be read.');
    else if (msg.t === 'done') {
      stop();
      const glb = new Uint8Array(msg.glb!);
      // Read back exactly as the other players' devices will read it.
      void decodeModel(glb, set).then((d) => {
        if (m.file !== file) { d.texture?.dispose(); return; }
        m.decoded?.texture?.dispose();
        m.decoded = d;
        m.made = { glb, stats: msg.stats!, set };
        if (set) m.as = 'set'; else if (m.as === 'set') m.as = 'thing';
        if (!m.sized) m.h = defaultHeight();
        go('preview');
      }, () => failed('The processed model could not be read back. Nothing was saved.'));
    }
  };
  w.postMessage({ file, set });
}

function drawSteps(list: Element): void {
  list.innerHTML = '';
  for (const [i, s] of m.steps.entries()) {
    const li = document.createElement('li');
    li.textContent = s + (i < m.steps.length - 1 ? '' : '…');
    if (i < m.steps.length - 1) li.className = 'done';
    list.append(li);
  }
}

// ---- the preview -------------------------------------------------------------------------------------

class View {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.05, 60);
  spin = new THREE.Group();
  floor = new THREE.Group();
  mesh: THREE.Mesh | null = null;
  material: THREE.Material;
  private raf = 0; private last = 0; private w = 0; private h = 0; private dirty = true; private gone = false;
  private still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private dims: [number, number] = [1, 1];

  constructor(readonly canvas: HTMLCanvasElement, d: Decoded) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    const sun = new THREE.DirectionalLight('#fff', 2.4);
    sun.position.set(2.5, 5, 3.5);
    this.scene.add(new THREE.HemisphereLight('#fff', '#6b5a4c', 1.5), sun, this.spin, this.floor);
    this.material = materialOf(d);
    const tick = (t: number) => {
      if (this.gone) return;
      if (!canvas.isConnected) { this.dispose(); return; } // the page went: give the context back
      this.raf = requestAnimationFrame(tick);
      if (document.hidden || t - this.last < 33) return;
      const r = canvas.getBoundingClientRect();
      if (r.width && (Math.round(r.width) !== this.w || Math.round(r.height) !== this.h)) {
        this.w = Math.min(1024, Math.round(r.width)); this.h = Math.min(1024, Math.round(r.height)); // (never larger, whatever the page's styles do)
        this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        this.renderer.setSize(this.w, this.h, false);
        this.dirty = true;
      }
      if (!this.still) { this.spin.rotation.y += Math.min(0.1, (t - this.last) / 1000) * 0.5; this.dirty = true; }
      this.last = t;
      if (!this.dirty || !this.w) return;
      this.dirty = false;
      this.frame(this.w / this.h);
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private frame(aspect: number): void {
    const [tall, wide] = this.dims, reach = Math.max(tall, wide * 1.15, 0.6);
    this.camera.aspect = aspect;
    const d = (reach * 1.1) / Math.tan((this.camera.fov * Math.PI) / 360) / Math.min(1, aspect);
    this.camera.position.set(0, tall * 0.5 + d * 0.36, d * 0.93);
    this.camera.lookAt(0, tall * 0.45, 0);
    this.camera.updateProjectionMatrix();
  }

  /** Show the model as the entry would have it. */
  set(d: Decoded, as: As, f: { h: number; cells: number; yaw: number; up: boolean }): { height: number } {
    const group = as === 'figure' ? 'minis' : 'props', made = shape(d, f, group), off = group === 'props' && f.cells % 2 === 0 ? -0.5 : 0;
    this.mesh?.geometry.dispose();
    this.spin.clear();
    this.mesh = new THREE.Mesh(made.geometry, this.material);
    this.mesh.position.set(off, 0, off);
    this.spin.add(this.mesh);
    // The cells it stands on, and a figure's base, to judge its size by.
    for (const o of this.floor.children) { (o as THREE.Mesh).geometry.dispose(); ((o as THREE.Mesh).material as THREE.Material).dispose(); }
    this.floor.clear();
    const half = f.cells / 2, pts: number[] = [];
    for (let i = 0; i <= f.cells; i++) pts.push(-half, 0, i - half, half, 0, i - half, i - half, 0, -half, i - half, 0, half);
    const grid = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.55 }));
    this.floor.add(grid);
    if (as === 'figure') {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.4, 0.08, 24), new THREE.MeshStandardMaterial({ color: '#3e63dd', roughness: 0.7 }));
      base.position.y = 0.04;
      this.floor.add(base);
    }
    this.dims = [made.height, Math.max(made.size[0], made.size[2], f.cells * 0.8)];
    this.dirty = true;
    return { height: made.size[1] };
  }

  /** A small picture of the model for the library: three-quarter view, nothing behind it. */
  async snap(): Promise<{ bytes: Uint8Array; mime: string } | null> {
    if (this.gone || !this.mesh) return null;
    const turn = this.spin.rotation.y, dims = this.dims;
    try {
      this.floor.visible = false;
      this.spin.rotation.y = -0.6;
      this.dims = [dims[0], Math.max(...this.mesh.geometry.boundingBox!.getSize(new THREE.Vector3()).toArray().filter((_, i) => i !== 1))];
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(256, 256, false);
      this.frame(1);
      this.camera.position.multiplyScalar(0.86); // closer than the preview: the picture is small
      this.camera.lookAt(0, dims[0] * 0.45, 0);
      this.renderer.render(this.scene, this.camera);
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(this.canvas, 0, 0, 128, 128);
      for (const type of ['image/webp', 'image/png']) {
        const blob = await new Promise<Blob | null>((done) => c.toBlob(done, type, 0.85));
        if (blob && blob.size <= PIC_BYTES && /^image\/(webp|png)$/.test(blob.type)) return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
      }
      return null;
    } catch { return null; } finally {
      this.floor.visible = true;
      this.spin.rotation.y = turn;
      this.dims = dims;
      this.w = this.h = 0; // sized again on the next frame
    }
  }

  dispose(): void {
    if (this.gone) return;
    this.gone = true;
    cancelAnimationFrame(this.raf);
    this.mesh?.geometry.dispose();
    for (const o of this.floor.children) { (o as THREE.Mesh).geometry.dispose(); ((o as THREE.Mesh).material as THREE.Material).dispose(); }
    if ((this.material as THREE.MeshStandardMaterial).map) this.material.dispose(); // (the plain one is every model's)
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // iOS keeps only a few contexts alive: hand this one back now, not at the next GC
    if (view === this) view = null;
  }
}
let view: View | null = null;

// ---- the steps on the page --------------------------------------------------------------------------------

/** Draw the model flow into the Import page. False when no model is in hand (the page is Import's own). */
export function paintModel(box: HTMLElement, ctx: PrepCtx): boolean {
  if (m.step === 'idle' || !host) return false;
  shown = ctx;
  box.dataset.step = `model-${m.step}`;
  if (m.step === 'working' || m.step === 'saving') working(box);
  else if (m.step === 'failed') failure(box);
  else preview(box, ctx);
  return true;
}

function working(box: HTMLElement): void {
  box.innerHTML = `<p id="mdBusy" role="status"></p><ol class="mdSteps" id="mdSteps" aria-live="polite"></ol><progress></progress>
    ${m.step === 'working' ? `<button id="mdCancel">${ico('x')}Cancel</button><p class="hint">The model is made small enough for every phone at the table, here on this one. Nothing is sent anywhere until you save it.</p>` : ''}`;
  box.querySelector('#mdBusy')!.textContent = m.step === 'saving' ? m.note : `Working on “${m.label}”`;
  drawSteps(box.querySelector('#mdSteps')!);
  const cancel = box.querySelector<HTMLElement>('#mdCancel');
  if (cancel) cancel.onclick = () => { host!.result({ name: m.label, ok: false, text: 'Cancelled.' }); forget(); host!.repaint(); };
}

function failure(box: HTMLElement): void {
  box.innerHTML = `<p id="impFail" role="alert"></p><div class="impRow"><button id="mdBack">${ico('back')}${m.fail.retry === 'save' ? 'Back' : 'Leave it'}</button>${
    m.fail.retry === 'save' ? `<button class="primary" id="mdRetry">${ico('turn')}Try again</button>` : m.fail.retry === 'set' ? `<button class="primary" id="mdRetry">${ico('house')}Try it as a set piece</button>` : ''}</div>`;
  box.querySelector('p')!.textContent = m.fail.why;
  box.querySelector<HTMLElement>('#mdBack')!.onclick = () => {
    if (m.fail.retry === 'save' && m.made) return go('preview');
    host!.result({ name: m.label, ok: false, text: m.fail.why });
    forget();
    host!.repaint();
  };
  const retry = box.querySelector<HTMLElement>('#mdRetry');
  if (retry) retry.onclick = () => (m.fail.retry === 'save' ? void save(shown!) : process(true));
}

function preview(box: HTMLElement, ctx: PrepCtx): void {
  const made = m.made, d = m.decoded;
  if (!made || !d) return go('idle');
  const own = host!.packName(ctx);
  box.classList.add('work');
  box.innerHTML = `
    <canvas class="impView mdView" id="mdView" aria-label="The model, turning slowly"></canvas>
    <div class="impTools">
      <p class="mdStats" id="mdStats"></p>
      <ul class="mdNotes" id="mdNotes"></ul>
      <div class="impRow" role="group" aria-label="What is it?">
        <button data-as="figure">${ico('pawn')}Figure</button><button data-as="thing">${ico('chair')}Thing</button><button data-as="set">${ico('house')}Set piece</button>
      </div>
      <div class="impRow" role="group" aria-label="Size">
        <button id="mdLess" title="Smaller" aria-label="Smaller">−</button><span id="mdSize"></span><button id="mdMore" title="Larger" aria-label="Larger">+</button>
      </div>
      <div class="impRow">
        <button id="mdTurn">${ico('turn')}Turn to face front</button><button id="mdUp" aria-pressed="false">${ico('up')}Stand it up</button>
      </div>
      <label>Name<input id="mdName" maxlength="32" autocomplete="off" enterkeyhint="done" placeholder="What is it called?" /></label>
      <label>Shelf<select id="mdShelf"></select></label>
      <p class="hint bad" id="mdNote" role="alert"></p>
      <div class="impRow"><button id="mdDrop">${ico('x')}Leave it</button><button class="primary" id="mdSave">Save</button></div>
    </div>`;
  const q = <T extends HTMLElement>(id: string) => box.querySelector<T>(`#${id}`)!;
  q('mdStats').textContent = before(made.stats);
  for (const note of made.stats.notes) { const li = document.createElement('li'); li.textContent = note; q('mdNotes').append(li); }
  view?.dispose();
  try { view = new View(q<HTMLCanvasElement>('mdView'), d); } catch { view = null; q('mdNote').textContent = 'This phone cannot show a preview just now; the model can still be saved.'; }
  const name = q<HTMLInputElement>('mdName'), shelf = q<HTMLSelectElement>('mdShelf');
  name.value = m.name;
  name.oninput = () => { m.name = name.value; };
  name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
  const sync = () => {
    for (const b of box.querySelectorAll<HTMLButtonElement>('[data-as]')) {
      b.classList.toggle('on', b.dataset.as === m.as);
      b.setAttribute('aria-pressed', String(b.dataset.as === m.as));
    }
    const cells = cellsFor(size(), m.h), shown = view?.set(d, m.as, { h: m.h, cells, yaw: m.yaw, up: m.up });
    const tall = shown?.height ?? m.h;
    q('mdSize').textContent = `${tall.toFixed(tall < 1 ? 2 : 1).replace(/\.?0+$/, '')} ${tall === 1 ? 'cell' : 'cells'} tall, on ${cells === 1 ? 'one cell' : `${cells} × ${cells} cells`}`;
    q<HTMLButtonElement>('mdLess').disabled = m.h <= 0.3;
    q<HTMLButtonElement>('mdMore').disabled = m.h >= 4 || (cells === 4 && tall < m.h - 0.01);
    q('mdUp').classList.toggle('on', m.up);
    q('mdUp').setAttribute('aria-pressed', String(m.up));
    const names = host!.shelves(m.as === 'figure' ? 'figure' : 'thing');
    if (!names.includes(m.shelf) || m.shelf === own) m.shelf = '';
    shelf.innerHTML = '';
    for (const [value, label] of [['', `${own} (a shelf of its own)`], ...names.filter((n) => n !== own).map((n) => [n, n])]) {
      const o = document.createElement('option');
      o.value = value; o.textContent = label; o.selected = value === m.shelf;
      shelf.append(o);
    }
  };
  for (const b of box.querySelectorAll<HTMLButtonElement>('[data-as]')) {
    b.onclick = () => {
      const as = b.dataset.as as As, set = as === 'set', s = made.stats;
      if (as === m.as) return;
      m.as = as;
      if (!m.sized) m.h = defaultHeight();
      // The other budget: the file is worked through again when that would change what comes out.
      const again = set ? !made.set && (s.trisOut < s.trisIn || s.notes.some((n) => /smaller/.test(n))) : made.set && (s.trisOut > PIECE.tris || s.bytesOut > PIECE.bytes || s.atlas > PIECE.atlas);
      if (again) return process(set);
      sync();
    };
  }
  const step = (dir: number) => { const by = m.h + (dir > 0 ? 1e-6 : -1e-6) < 1.5 ? 0.1 : 0.25; m.h = Math.min(4, Math.max(0.3, Math.round((m.h + dir * by) * 20) / 20)); m.sized = true; sync(); };
  q('mdLess').onclick = () => step(-1);
  q('mdMore').onclick = () => step(1);
  q('mdTurn').onclick = () => { m.yaw = (m.yaw + 1) & 3; if (!m.sized) m.h = defaultHeight(); sync(); };
  q('mdUp').onclick = () => { m.up = !m.up; if (!m.sized) m.h = defaultHeight(); sync(); };
  shelf.onchange = () => { m.shelf = shelf.value; };
  q('mdDrop').onclick = () => { forget(); host!.repaint(); };
  q('mdSave').onclick = async () => {
    m.name = name.value.replace(/\s+/g, ' ').trim().slice(0, 32);
    if (!m.name) { q('mdNote').textContent = 'Give it a name first.'; name.focus(); return; }
    m.pic = (await view?.snap()) ?? null;
    void save(ctx);
  };
  sync();
}

/** Store the file and its picture, and put the piece in this device's pack. Every way this can fail ends on a page with Try again. */
async function save(ctx: PrepCtx): Promise<void> {
  const made = m.made, { app } = ctx;
  if (!made || !host) return go('idle');
  const label = m.name, set = m.as === 'set', budget = set ? SET : PIECE;
  if (!app.full()) return failed('Only the GM can add pieces to this table.', 'save');
  if (made.set !== set && (made.stats.trisOut > budget.tris || made.glb.length > budget.bytes)) return failed('This model is too large for a figure or a thing. Save it as a set piece.', 'save');
  if (tableSize() + made.glb.length > HARD_BYTES) return failed(`The table’s packs are full (${bytesText(HARD_BYTES)}). Remove something in Packs first.`, 'save');
  try {
    m.note = `Saving “${label}” (${bytesText(made.glb.length)})…`;
    m.steps = [];
    go('saving');
    let outcomes: ServerOutcome[] = [];
    const ref: BlobRef = await app.blobs.put(made.glb, GLB_MIME, { report: (o) => { outcomes = o; } });
    let pic: BlobRef | undefined;
    if (m.pic) pic = await app.blobs.put(m.pic.bytes, m.pic.mime).catch(() => undefined);
    const ns = ownNs(app.me), group = m.as === 'figure' ? 'minis' : 'props', cells = cellsFor(size(), m.h);
    const taken = new Set(listPacks().find((p) => p.ns === ns)?.pieces.map((p) => p.name) ?? []);
    const entry: Entry = {
      name: label, icon: m.as === 'figure' ? '🗿' : set ? '🏛️' : '🏺', kind: 'model', ref, h: m.h, cells, tris: made.stats.trisOut,
      ...(made.set ? { set: true } : {}), ...(m.yaw ? { yaw: m.yaw } : {}), ...(m.up ? { up: true } : {}), ...(made.stats.atlas ? { tex: true } : {}), ...(pic ? { pic } : {}),
    };
    const own = host.packName(ctx), done = addPiece(ns, group, pieceKey(label, (k) => taken.has(k)), entry, { shelf: m.shelf, pack: own });
    if (!done.ok) return failed(done.reason, 'save');
    host.result({ name: label, ok: true, text: `${storedText(ref, outcomes)}. ${before(made.stats)}. Find it in Build → ${m.as === 'figure' ? 'Figures' : 'Things'}, on the shelf “${m.shelf || own}”.`, ...(done.id ? { piece: { group, id: done.id } } : {}) });
    forget();
    host.repaint();
  } catch (e) {
    failed(e instanceof Error && e.message ? `That did not work: ${e.message}` : 'That did not work.', 'save');
  }
}

/** For tests: where the flow is. */
export const modelFlow = (): { step: string; steps: string[]; stats: IngestStats | null } => ({ step: m.step, steps: m.steps, stats: m.made?.stats ?? null });
