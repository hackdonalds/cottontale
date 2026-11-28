// Prep → Packs: the table's own packs (packs.ts). Each with its pieces as pictures, what it
// weighs against the table's budget, and the three things one does to a pack: rename it, take
// a piece out, take all of it away. Anything that removes asks first, in the page itself.
import { HARD_BYTES, SOFT_BYTES, budget, listPacks, onPacks, packThumbUrl, removePack, removePiece, renamePack, tableSize, type PackInfo, type PieceInfo } from '../packs';
import { BOARD_TRIS, boardTriangles } from '../model';
import { bytesText } from '../pixels';
import { registerPrepPage, type PrepCtx } from './prep';

/** What the page is in the middle of. Kept here, not in the page: Prep may draw it again at any time. */
const ui = { rename: '', text: '', drop: '', piece: '', dropPiece: false, note: '' };
let off: (() => void) | null = null;

const ico = (id: string) => `<svg><use href="#i-${id}"/></svg>`;
const sort = (p: PieceInfo) => (p.entry.kind === 'model' ? `${p.entry.set === true ? 'Set piece' : p.group === 'minis' ? 'Figure' : 'Thing'} (3D model, ${Number(p.entry.tris).toLocaleString('en-US')} triangles)` : p.entry.kind === 'flat' ? 'Map tile' : p.entry.kind === 'standee' ? (p.group === 'minis' ? 'Figure' : 'Thing') : p.entry.kind);
const STATE: Record<string, string> = { failed: 'Its file cannot be found right now', unknown: 'A kind of piece this app does not know', loading: 'Fetching…' };
/** Triangles of imported models on the board in front of us, in steps coarse enough not to redraw the page for every piece placed. */
const heavy = (store: PrepCtx['app']['store']) => Math.floor(boardTriangles(store) / 10_000);
const sigOf = (full: boolean, store?: PrepCtx['app']['store']) => JSON.stringify([full, store ? heavy(store) : 0, listPacks().map((p) => [p.ns, p.name, p.pieces.map((x) => [x.id, x.entry.name, x.state, !!packThumbUrl(x.id)])])]);

function draw(el: HTMLElement, ctx: PrepCtx): void {
  const full = ctx.app.full(), packs = listPacks(), at = el.scrollTop;
  el.dataset.sig = sigOf(full, ctx.app.store);
  el.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'pkPage';
  el.append(page);
  const b = budget(tableSize());
  const total = document.createElement('div');
  total.className = `pkTotal ${b.level}`;
  total.innerHTML = `<span><b>${bytesText(b.bytes)}</b> of ${bytesText(HARD_BYTES)} for this table’s own pieces</span><div class="pkBar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(b.part * 100)}" aria-label="Space used"><i style="width:${Math.max(b.bytes ? 1 : 0, b.part * 100)}%"></i></div>`;
  if (b.level !== 'ok') total.insertAdjacentHTML('beforeend', `<p class="hint">${b.level === 'hard' ? 'Full: nothing more can be added until something is removed.' : `Over ${bytesText(SOFT_BYTES)}: players on a slow connection will wait for these.`}</p>`);
  page.append(total);
  const tris = boardTriangles(ctx.app.store);
  if (tris > BOARD_TRIS) {
    const p = document.createElement('p');
    p.className = 'hint bad';
    p.id = 'pkHeavy';
    p.textContent = `The 3D models on this board come to ${tris.toLocaleString('en-US')} triangles. Past ${BOARD_TRIS.toLocaleString('en-US')} or so a phone starts to struggle: use fewer copies, or simpler models.`;
    page.append(p);
  }
  if (ui.note) { const p = document.createElement('p'); p.className = 'hint bad'; p.setAttribute('role', 'alert'); p.textContent = ui.note; page.append(p); }
  for (const p of packs) page.append(pack(p, full, () => draw(el, ctx)));
  if (!packs.length) page.insertAdjacentHTML('beforeend', `<div class="soon">${ico('cube')}<p>This table has no pieces of its own yet. Photos, pictures and 3D models from this phone become figures, things and map tiles.</p></div>`);
  if (full) {
    const add = document.createElement('button');
    add.className = 'primary';
    add.id = 'pkImport';
    add.innerHTML = `${ico('open')}Add pictures or models`;
    add.onclick = () => ctx.open('import');
    page.append(add);
  }
  page.insertAdjacentHTML('beforeend', '<p class="hint">Packs travel with the table: everyone here sees these pieces, and “Save table” keeps the list. The pictures themselves stay on the phones and servers that hold them.</p>');
  el.scrollTop = at;
}

function pack(p: PackInfo, full: boolean, redraw: () => void): HTMLElement {
  const s = document.createElement('section');
  s.className = 'pkPack';
  s.dataset.ns = p.ns;
  const act = (fn: () => { ok: boolean; reason?: string }) => { const r = fn(); ui.note = r.ok ? '' : r.reason ?? ''; ui.rename = ui.drop = ui.piece = ''; ui.dropPiece = false; redraw(); };
  const button = (cls: string, html: string, click: () => void, title?: string) => {
    const b = document.createElement('button');
    b.className = cls;
    b.innerHTML = html;
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.onclick = click;
    return b;
  };
  const head = document.createElement('div');
  head.className = 'pkHead';
  if (ui.rename === p.ns) {
    const input = document.createElement('input');
    input.className = 'pkName';
    input.maxLength = 32;
    input.value = ui.text;
    input.setAttribute('aria-label', 'Pack name');
    input.oninput = () => { ui.text = input.value; };
    input.onkeydown = (e) => { if (e.key === 'Enter') act(() => renamePack(p.ns, ui.text)); };
    head.append(input, button('primary pkSave', 'Save', () => act(() => renamePack(p.ns, ui.text))), button('pkCancel', ico('x'), () => { ui.rename = ''; redraw(); }, 'Keep the old name'));
    setTimeout(() => { if (input.isConnected && document.activeElement !== input) input.focus({ preventScroll: true }); });
  } else {
    head.innerHTML = '<span><b></b><small></small></span>';
    head.querySelector('b')!.textContent = p.name;
    head.querySelector('small')!.textContent = `${p.pieces.length} piece${p.pieces.length === 1 ? '' : 's'} · ${bytesText(p.bytes)}${p.own ? ' · made on this device' : ''}`;
    if (full) {
      head.append(
        button('pkRename', 'Rename', () => { ui.rename = p.ns; ui.text = p.name; ui.drop = ''; redraw(); }),
        button('pkDrop', ico('trash'), () => { ui.drop = p.ns; ui.rename = ''; redraw(); }, `Remove the pack “${p.name}”`),
      );
    }
  }
  s.append(head);
  if (ui.drop === p.ns) {
    const ask = document.createElement('div');
    ask.className = 'pkAsk';
    ask.setAttribute('role', 'alertdialog');
    ask.innerHTML = '<p></p>';
    ask.querySelector('p')!.textContent = `Remove “${p.name}” and its ${p.pieces.length} piece${p.pieces.length === 1 ? '' : 's'}, for everyone? Copies on the boards stay as grey stand-ins.`;
    ask.append(button('pkKeep', 'Keep it', () => { ui.drop = ''; redraw(); }), button('danger pkYes', `${ico('trash')}Remove the pack`, () => act(() => removePack(p.ns))));
    s.append(ask);
  }
  const grid = document.createElement('div');
  grid.className = 'pkGrid';
  for (const x of p.pieces) {
    const url = packThumbUrl(x.id);
    const t = button(`pkPiece${ui.piece === x.id ? ' on' : ''}`, `<i${url ? ` style="background-image:url(${url})"` : ''}></i><span></span>`, () => { ui.piece = ui.piece === x.id ? '' : x.id; ui.dropPiece = false; redraw(); });
    if (!url) t.querySelector('i')!.textContent = x.entry.icon ?? '🖼️';
    t.querySelector('span')!.textContent = x.entry.name;
    t.dataset.piece = x.id;
    t.setAttribute('aria-pressed', String(ui.piece === x.id));
    grid.append(t);
  }
  s.append(grid);
  const sel = p.pieces.find((x) => x.id === ui.piece);
  if (sel) {
    const d = document.createElement('div');
    d.className = 'pkAsk';
    d.innerHTML = '<p><b></b><br /><small></small></p>';
    d.querySelector('b')!.textContent = sel.entry.name;
    d.querySelector('small')!.textContent = [sort(sel), bytesText(sel.bytes), STATE[sel.state] ?? ''].filter(Boolean).join(' · ');
    if (ui.dropPiece) {
      d.setAttribute('role', 'alertdialog');
      d.querySelector('small')!.textContent = 'Remove it for everyone? Copies on the boards stay as grey stand-ins.';
      d.append(button('pkKeep', 'Keep it', () => { ui.dropPiece = false; redraw(); }), button('danger pkYes', `${ico('trash')}Remove`, () => act(() => removePiece(p.ns, sel.group, sel.name))));
    } else if (full) d.append(button('pkDropPiece', `${ico('trash')}Remove this piece`, () => { ui.dropPiece = true; redraw(); }));
    s.append(d);
  }
  return s;
}

export function registerPacksPage(): void {
  registerPrepPage({
    id: 'packs', title: 'Packs', icon: 'cube', order: 20, hint: 'The table’s own pieces, and what they weigh',
    now: () => { const n = listPacks().reduce((sum, p) => sum + p.pieces.length, 0); return n ? `${n} piece${n === 1 ? '' : 's'}` : ''; },
    render(el, ctx) {
      off?.();
      // A picture arriving is not a change to the table: listen for it while the page is up.
      off = onPacks(() => { if (el.isConnected && el.dataset.page === 'packs') { if (el.dataset.sig !== sigOf(ctx.app.full(), ctx.app.store)) draw(el, ctx); } else { off?.(); off = null; } });
      draw(el, ctx);
    },
    update(el, ctx) { if (el.dataset.sig !== sigOf(ctx.app.full(), ctx.app.store)) draw(el, ctx); },
  });
}
