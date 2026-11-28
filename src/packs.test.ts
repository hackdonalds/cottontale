import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MINIS, MINI_SHELVES, PROPS, PROP_SHELVES, makeMini, makeProp } from './catalog';
import { known } from './registry';
import { Store } from './store';
import {
  HARD_BYTES, MAX_PACKS, MAX_PIECES, SOFT_BYTES, addPiece, budget, fits, initPacks, isWaiting, listPacks, onPacks, ownNs, packBytes, packChanged, packSize,
  packThumb, parsePack, pieceKey, pieceState, readPacks, registerPieceKind, removePack, removePiece, renamePack, stopPacks, storedText, tableSize, want, type Entry,
} from './packs';
import { AtlasAlloc, PER_PAGE, cellOf } from './standee';
import {
  TILE_BYTES, TOKEN_BYTES, alphaOf, brush, bytesText, clampCrop, cropRect, decodeSize, encodeSteps, fit, floodErase, hasAlpha, imageSize, setAlpha, stroke, zoomCrop, type Pixels,
} from './pixels';

const H = (c: string) => c.repeat(64);
const ref = (n = 1000, c = 'a') => ({ h: H(c), n, m: 'image/png' });
const standee = (name = 'Orc', n = 1000, c = 'a'): Entry => ({ name, kind: 'standee', ref: ref(n, c) });
const pack = (id: string, over: object = {}) => ({ v: 1, id, name: 'Mine', pieces: { props: {}, minis: {} }, ...over });
const tick = (ms = 120) => new Promise((r) => setTimeout(r, ms));

describe('parsePack', () => {
  it('keeps what it understands and drops the rest', () => {
    const m = parsePack(pack('u-ada', {
      name: '  Ada’s   monsters  ', evil: true,
      pieces: {
        minis: { orc: { ...standee(), h: 99, big: true, script: 'alert(1)' }, 'Bad Name': standee(), nope: 7, noref: { name: 'x', kind: 'standee' } },
        props: { rug: { name: 'Rug', kind: 'flat', ref: ref(5000, 'b'), cells: 40.4 }, orc: standee('Twin') },
      },
      shelves: { minis: { Monsters: ['orc', 'ghost', 'orc'], '': ['orc'] }, props: { Furniture: ['rug'], Empty: ['nothing'] }, blocks: { x: ['orc'] } },
    }), 'u-ada')!;
    expect(m.name).toBe('Ada’s monsters');
    expect(Object.keys(m.pieces.minis)).toEqual([]); // 'orc' is a prop: props are read first, and one name is one piece
    expect(Object.keys(m.pieces.props)).toEqual(['rug', 'orc']);
    expect(m.pieces.props.rug).toEqual({ cells: 16, name: 'Rug', kind: 'flat', ref: ref(5000, 'b') });
    expect(m.pieces.props.orc).toEqual({ h: 1, name: 'Twin', kind: 'standee', ref: ref() });
    expect(m.shelves).toEqual({ props: { Furniture: ['rug'] } });
    expect('evil' in m).toBe(false);
  });
  it('clamps a standee and refuses what is not a pack', () => {
    const m = parsePack(pack('p', { pieces: { minis: { a: { ...standee(), h: 99, big: true, icon: 'abcdefghijkl', x: 1 } } } }))!;
    expect(m.pieces.minis.a).toEqual({ h: 4, big: true, name: 'Orc', icon: 'abcdefgh', kind: 'standee', ref: ref() });
    expect(parsePack(pack('p'), 'q')).toBeNull(); // stored under another key than it claims
    expect(parsePack({ ...pack('p'), v: 2 })).toBeNull();
    expect(parsePack(pack('Bad Id'))).toBeNull();
    expect(parsePack(null)).toBeNull();
    expect(parsePack([pack('p')])).toBeNull();
    expect(parsePack(pack('p', { pieces: 'lots' }))!.pieces).toEqual({ props: {}, minis: {} });
  });
  it('holds every kind to its budget, and a pack to its count', () => {
    const over = parsePack(pack('p', { pieces: {
      minis: { ok: standee('a', TOKEN_BYTES + 28), fat: standee('b', TOKEN_BYTES + 29), flat: { name: 'no', kind: 'flat', ref: ref() } },
      props: { tile: { name: 't', kind: 'flat', ref: ref(TILE_BYTES + 28) }, huge: { name: 't', kind: 'flat', ref: ref(TILE_BYTES + 29) }, lies: { ...standee(), ref: { ...ref(), h: 'zz' } } },
    } }))!;
    expect(Object.keys(over.pieces.minis)).toEqual(['ok']); // too big for a token; a tile cannot be a figure
    expect(Object.keys(over.pieces.props)).toEqual(['tile']);
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`p${i}`, standee(`P${i}`)]));
    const full = parsePack(pack('p', { pieces: { props: many, minis: { late: standee() } } }))!;
    expect(Object.keys(full.pieces.props).length).toBe(MAX_PIECES);
    expect(Object.keys(full.pieces.minis).length).toBe(0);
  });
  it('keeps the place of a kind this app does not know, without reading its fields', () => {
    const m = parsePack(pack('p', { pieces: { props: { car: { name: 'Car', kind: 'model-9', ref: { h: H('c'), n: 3_000_000, m: 'model/gltf-binary' }, scale: 3 } } } }))!;
    expect(m.pieces.props.car).toEqual({ name: 'Car', kind: 'model-9', ref: { h: H('c'), n: 3_000_000, m: 'model/gltf-binary' } });
    expect(parsePack(pack('p', { pieces: { props: { car: { name: 'Car', kind: 'Not A Kind', ref: ref() } } } }))!.pieces.props).toEqual({});
  });
  it('a table follows at most eight packs, the same eight on every device', () => {
    const s = new Store('me');
    for (let i = 11; i >= 0; i--) s.set(`pk:p${String(i).padStart(2, '0')}`, pack(`p${String(i).padStart(2, '0')}`));
    s.set('pk:aaa', { junk: true });
    expect(readPacks(s).map((m) => m.id)).toEqual(Array.from({ length: MAX_PACKS }, (_, i) => `p0${i}`));
  });
});

describe('names and budgets', () => {
  it('a device has a namespace of its own, and pieces get names that fit an id', () => {
    expect(ownNs('0a1b2c3d4e')).toBe('u-0a1b2c3d4e');
    expect(ownNs('AB:cd')).toBe('u-abcd');
    expect(ownNs('')).toBe('u-me');
    const taken = new Set(['orc', 'orc-2']);
    expect(pieceKey('Orc', (k) => taken.has(k))).toBe('orc-3');
    expect(pieceKey('  The Under-King  of Trolls & Sons!!', () => false)).toBe('the-under-king-of-trolls');
    expect(pieceKey('🧌', () => false)).toBe('piece');
  });
  it('adds up what a pack weighs and where the table stands', () => {
    const m = parsePack(pack('p', { pieces: { minis: { a: standee('a', 1000), b: standee('b', 2500) }, props: { c: standee('c', 500) } } }))!;
    expect(packBytes(m)).toBe(4000);
    expect(budget(0)).toMatchObject({ level: 'ok', part: 0 });
    expect(budget(SOFT_BYTES).level).toBe('soft');
    expect(budget(SOFT_BYTES - 1).level).toBe('ok');
    expect(budget(HARD_BYTES + 5)).toMatchObject({ level: 'hard', part: 1 });
    expect(budget(HARD_BYTES / 4).part).toBe(0.25);
    expect(fits(HARD_BYTES - 10, 10)).toBe(true);
    expect(fits(HARD_BYTES - 10, 11)).toBe(false);
    expect(fits(0, 0)).toBe(false);
  });
  it('says plainly where a file ended up', () => {
    expect(storedText(ref())).toBe('Saved on this phone and shared with players directly');
    expect(storedText({ ...ref(), s: ['https://a', 'https://b'] }, [{ url: 'https://a', ok: true }, { url: 'https://b', ok: true }])).toBe('Stored on 2 servers');
    expect(storedText({ ...ref(), s: ['https://a'] }, [{ url: 'https://a', ok: true }, { url: 'https://b', ok: false, status: 413 }])).toBe('Stored on 1 server (1 more said no)');
    expect(storedText(ref(), [{ url: 'https://b', ok: false, status: 413, reason: 'too large' }])).toBe('Saved on this phone and shared with players directly (no server took it: too large)');
  });
  it('fits pictures and plans how to get under a budget', () => {
    expect(fit(4000, 3000, 2048)).toEqual([2048, 1536]);
    expect(fit(100, 50, 256)).toEqual([100, 50]);
    expect(fit(5000, 1, 100)).toEqual([100, 1]);
    const [w, h] = decodeSize(12000, 9000);
    expect(w).toBeLessThanOrEqual(4096);
    expect(w * h).toBeLessThanOrEqual(16_700_000);
    expect(Math.abs(w / h - 4 / 3)).toBeLessThan(0.01);
    expect(decodeSize(8000, 8000, 4096, 1_000_000)).toEqual([1000, 1000]);
    const steps = [...encodeSteps(256)];
    expect(steps[0]).toEqual([256, 0.86]);
    expect(steps[3][0]).toBe(205);
    expect(steps.at(-1)![0]).toBeLessThanOrEqual(64);
    expect(steps.every(([s], i) => i === 0 || s <= steps[i - 1][0])).toBe(true);
    expect(bytesText(900)).toBe('900 B');
    expect(bytesText(60 * 1024)).toBe('60 kB');
    expect(bytesText(1.25 * 1024 * 1024)).toBe('1.3 MB');
    expect(bytesText(HARD_BYTES)).toBe('100 MB');
  });
});

describe('the pages of the atlas', () => {
  it('hands out every cell of a page once, the top-left quarter first', () => {
    const a = new AtlasAlloc(), seen = new Set<string>();
    for (let i = 0; i < PER_PAGE; i++) {
      const s = a.alloc();
      expect(s.page).toBe(0);
      expect(s.x < 8 && s.y < 8).toBe(true);
      if (i < 16) expect(s.x < 4 && s.y < 4).toBe(true);
      seen.add(`${s.x},${s.y}`);
      expect(a.extent(0)).toBe(i < 16 ? 1024 : 2048);
    }
    expect(seen.size).toBe(PER_PAGE);
    expect(a.alloc()).toMatchObject({ page: 1, index: 0, x: 0, y: 0 });
    expect(a.pages).toBe(2);
    expect(cellOf(0)).toEqual([0, 0]);
    expect(cellOf(3)).toEqual([1, 1]);
    expect(cellOf(63)).toEqual([7, 7]);
  });
  it('gives a large picture a square of four cells that nothing else is in', () => {
    const a = new AtlasAlloc(), small = a.alloc(), big = a.alloc(2), next = a.alloc();
    expect(small).toMatchObject({ index: 0, span: 1 });
    expect(big).toMatchObject({ index: 4, span: 2, x: 2, y: 0 });
    expect(new Set([4, 5, 6, 7].map((i) => cellOf(i).join())).size).toBe(4);
    expect([4, 5, 6, 7].map((i) => cellOf(i)).every(([x, y]) => x >= 2 && x < 4 && y < 2)).toBe(true);
    expect(next.index).toBe(1);
    expect(a.count(0)).toBe(6);
  });
  it('uses a freed cell again, and a page of large pictures holds sixteen', () => {
    const a = new AtlasAlloc(), s = [a.alloc(), a.alloc(), a.alloc()];
    a.free(s[1]);
    expect(a.alloc().index).toBe(1);
    expect(a.extent(5)).toBe(0);
    const b = new AtlasAlloc();
    for (let i = 0; i < 16; i++) expect(b.alloc(2).page).toBe(0);
    expect(b.alloc(2).page).toBe(1);
    expect(b.alloc().page).toBe(1); // page 0 is full
  });
});

describe('pixels', () => {
  /** A picture from rows of letters: w white, g off-white, r red, k black, . already see-through. */
  const pic = (...rows: string[]): Pixels => {
    const C: Record<string, number[]> = { w: [255, 255, 255, 255], r: [220, 30, 30, 255], k: [0, 0, 0, 255], g: [235, 240, 235, 255], '.': [0, 0, 0, 0] };
    return { width: rows[0].length, height: rows.length, data: new Uint8ClampedArray(rows.flatMap((r) => [...r].flatMap((c) => C[c]))) };
  };
  const mask = (p: Pixels) => Array.from({ length: p.height }, (_, y) => Array.from({ length: p.width }, (_, x) => (p.data[(y * p.width + x) * 4 + 3] ? '#' : '.')).join(''));

  it('tapping a colour erases what touches it and is like it, and nothing else', () => {
    const p = pic(
      'wwwww',
      'wrrrw',
      'wrwrw',
      'wrrrw',
      'wwwww');
    expect(floodErase(p, 0, 0, 10)).toBe(16);
    expect(mask(p)).toEqual(['.....', '.###.', '.###.', '.###.', '.....']); // the white inside the red ring is not connected
    expect(floodErase(p, 0, 0, 10)).toBe(0); // already gone
    expect(floodErase(p, 9, 9, 10)).toBe(0); // outside
    expect(floodErase(p, 2, 2, 0)).toBe(1);
  });
  it('tolerance decides how alike is alike', () => {
    const row = () => pic('wgrk');
    const a = row();
    expect(floodErase(a, 0, 0, 0)).toBe(1);
    const b = row();
    expect(floodErase(b, 0, 0, 10)).toBe(2); // off-white goes with white
    expect(mask(b)).toEqual(['..##']);
    const c = row();
    expect(floodErase(c, 0, 0, 100)).toBe(4);
    const d = pic('w.w');
    expect(floodErase(d, 0, 0, 100)).toBe(1); // does not jump a gap
  });
  it('fills a large area without running out of stack', () => {
    const n = 300, p: Pixels = { width: n, height: n, data: new Uint8ClampedArray(n * n * 4).fill(255) };
    expect(floodErase(p, 150, 150, 5)).toBe(n * n);
  });
  it('the brush rubs out and puts back, and Undo is just the alpha', () => {
    const p = pic('rrrrr', 'rrrrr', 'rrrrr', 'rrrrr', 'rrrrr'), was = alphaOf(p);
    expect(hasAlpha(p)).toBe(false);
    brush(p, 2.5, 2.5, 1);
    expect(mask(p)).toEqual(['#####', '##.##', '#...#', '##.##', '#####']);
    expect(hasAlpha(p)).toBe(true);
    expect(p.data[(2 * 5 + 2) * 4]).toBe(220); // the colour is still there under the hole
    brush(p, 2.5, 2.5, 0.6, was);
    expect(mask(p)).toEqual(['#####', '##.##', '#.#.#', '##.##', '#####']);
    const box = stroke(p, 0.5, 0.5, 4.5, 0.5, 0.5);
    expect(mask(p)[0]).toBe('.....');
    expect(box).toMatchObject({ x: 0, y: 0, w: 5 });
    setAlpha(p, was);
    expect(mask(p)).toEqual(['#####', '#####', '#####', '#####', '#####']);
    expect(brush(p, 50, 50, 2)).toMatchObject({ w: 0 });
  });
  it('the crop frame stays on the picture', () => {
    // A 400×200 picture under a 100×100 frame: at the least zoom the frame is as tall as the picture.
    const v = clampCrop({ s: 0, cx: 200, cy: 100 }, 400, 200, 100, 100);
    expect(v).toEqual({ s: 0.5, cx: 200, cy: 100 });
    expect(cropRect(v, 100, 100)).toEqual({ x: 100, y: 0, w: 200, h: 200 });
    expect(clampCrop({ ...v, cx: -50 }, 400, 200, 100, 100).cx).toBe(100);
    expect(clampCrop({ ...v, cx: 900, cy: 900 }, 400, 200, 100, 100)).toMatchObject({ cx: 300, cy: 100 });
    expect(clampCrop({ ...v, s: 99 }, 400, 200, 100, 100).s).toBe(4);
    const z = zoomCrop(v, 2, 50, 0); // zoom in about the frame's right edge: that point of the picture stays put
    expect(z.s).toBe(1);
    expect(z.cx + 50 / z.s).toBe(v.cx + 50 / v.s);
    const r = cropRect(clampCrop(z, 400, 200, 100, 100), 100, 100);
    expect(r.w).toBe(100);
    expect(r.x >= 0 && r.x + r.w <= 400 && r.y >= 0 && r.y + r.h <= 200).toBe(true);
  });
  it('reads a picture\'s size from its header, and only from formats it knows', () => {
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x30, 0x39, 0, 0, 0, 0x40]);
    expect(imageSize(png)).toEqual({ w: 12345, h: 64, type: 'png' });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xc0, 0, 17, 8, 0x0b, 0xb8, 0x0f, 0xa0, 3, 0, 0, 0, 0]);
    expect(imageSize(jpeg)).toEqual({ w: 4000, h: 3000, type: 'jpeg' });
    const webp = new Uint8Array(30);
    webp.set([...'RIFF'].map((c) => c.charCodeAt(0)));
    webp.set([...'WEBPVP8X'].map((c) => c.charCodeAt(0)), 8);
    webp.set([0xff, 0x07, 0, 0xff, 0x03, 0], 24);
    expect(imageSize(webp)).toEqual({ w: 2048, h: 1024, type: 'webp' });
    expect(imageSize(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))).toBeNull();
    expect(imageSize(new Uint8Array(0))).toBeNull();
    expect(imageSize(png.subarray(0, 20))).toBeNull();
  });
});

describe('packs at the table', () => {
  afterEach(() => stopPacks());
  /** A table with one device: a real store, files that are "there" or not, and a kind that builds a box. */
  function table(me = 'gm01', full = true) {
    const store = new Store(me), have = new Set<string>(), built: string[] = [], gone: string[] = [], released: string[] = [];
    store.onChange = (k) => packChanged(k);
    registerPieceKind('test-box', {
      budget: 5000,
      parse: (raw) => ({ size: Math.min(3, Number((raw as { size?: number }).size) || 1) }),
      async build(entry, bytes, ctx) {
        if (bytes[0] !== 7) throw new Error('not a box');
        built.push(ctx.id);
        const mesh = { geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshBasicMaterial() };
        const def = { name: entry.name, icon: '📦', mesh };
        return { ...(ctx.group === 'minis' ? { mini: { ...def, height: 1 } } : { prop: def }), dispose: () => void gone.push(ctx.id) };
      },
    });
    const blobs = {
      get: async (r: unknown) => { const h = (r as { h: string }).h; if (!have.has(h)) throw new Error('not available'); return new Uint8Array([h[0] === 'f' ? 0 : 7]); },
      objectUrl: async (r: unknown) => { const h = (r as { h: string }).h; if (!have.has(h)) throw new Error('not available'); return `blob:${h.slice(0, 4)}`; },
      release: (r: unknown) => void released.push((r as { h: string }).h),
    };
    initPacks({ store, blobs, me, full: () => full });
    return { store, have, built, gone, released, ns: ownNs(me) };
  }
  const box = (name: string, c = 'a', n = 1000): Entry => ({ name, kind: 'test-box', ref: ref(n, c), size: 2 });

  it('a pack in the store is in the library at once, as stand-ins, and built when it is wanted', async () => {
    const t = table();
    expect(addPiece(t.ns, 'minis', 'robot', box('Robot'), { pack: 'Ada’s pieces' })).toEqual({ ok: true, id: 'u-gm01:robot' });
    expect(addPiece(t.ns, 'props', 'keg', box('Keg', 'b'), { shelf: 'Furniture' })).toMatchObject({ ok: true });
    expect(known.mini('u-gm01:robot') && known.prop('u-gm01:keg')).toBe(true);
    expect(MINIS['u-gm01:robot'].name).toBe('Robot');
    expect(MINI_SHELVES['Ada’s pieces']).toEqual(['u-gm01:robot']);
    expect(PROP_SHELVES.Furniture).toContain('u-gm01:keg');
    expect(pieceState('u-gm01:robot')).toBe('waiting');
    expect(isWaiting(makeMini('u-gm01:robot')[0].material)).toBe(true);
    expect(t.built).toEqual([]); // nothing is fetched until a piece is drawn

    want('u-gm01:robot'); // its file is not to be had yet
    await tick();
    expect(pieceState('u-gm01:robot')).toBe('failed');
    t.have.add(H('a'));
    want('u-gm01:robot'); // too soon to try again
    await tick(20);
    expect(t.built).toEqual([]);
  });

  it('every stand-in asks for its own file, however many pieces of a kind a pack holds', () => {
    // (Being drawn is what fetches a piece: its stand-in carries the piece's id. With one shared tag,
    // two figures in a pack both asked for the second one's file and the first stayed a cone for good.)
    const t = table();
    addPiece(t.ns, 'minis', 'pirate', box('Pirate'));
    addPiece(t.ns, 'minis', 'goblin', box('Goblin', 'b'));
    addPiece(t.ns, 'props', 'keg', box('Keg', 'c'));
    addPiece(t.ns, 'props', 'crate', box('Crate', 'd'));
    const tag = (meshes: THREE.Object3D[]) => (meshes[0] as THREE.Mesh).geometry.userData.piece;
    expect([tag(makeMini('u-gm01:pirate')), tag(makeMini('u-gm01:goblin'))]).toEqual(['u-gm01:pirate', 'u-gm01:goblin']);
    expect([tag(makeProp('u-gm01:keg').children), tag(makeProp('u-gm01:crate').children)]).toEqual(['u-gm01:keg', 'u-gm01:crate']);
  });

  it('builds a piece once, tells the registry, and takes it down when the pack goes', async () => {
    const t = table();
    t.have.add(H('a')).add(H('b'));
    addPiece(t.ns, 'minis', 'robot', box('Robot'));
    addPiece(t.ns, 'props', 'keg', box('Keg', 'b'));
    let heard = 0;
    const off = onPacks(() => heard++);
    want('u-gm01:robot');
    want('u-gm01:robot');
    await tick();
    expect(t.built).toEqual(['u-gm01:robot']);
    expect(pieceState('u-gm01:robot')).toBe('ready');
    expect(pieceState('u-gm01:keg')).toBe('waiting');
    expect(isWaiting(makeMini('u-gm01:robot')[0].material)).toBe(false);
    expect(MINIS['u-gm01:robot'].height).toBe(1);
    expect(heard).toBeGreaterThan(0);
    // Renaming the piece or the pack keeps what was built; a new file builds again.
    expect(renamePack(t.ns, 'Machines')).toEqual({ ok: true });
    expect(MINI_SHELVES.Machines).toEqual(['u-gm01:robot']);
    expect(MINI_SHELVES['My pieces']).toBeUndefined();
    addPiece(t.ns, 'minis', 'robot', box('Robot Mk II'));
    expect(MINIS['u-gm01:robot'].name).toBe('Robot Mk II');
    expect(pieceState('u-gm01:robot')).toBe('ready');
    expect(t.gone).toEqual([]);
    t.have.add(H('c'));
    addPiece(t.ns, 'minis', 'robot', box('Robot Mk III', 'c'));
    expect(t.gone).toEqual(['u-gm01:robot']);
    expect(pieceState('u-gm01:robot')).toBe('waiting');
    // The library asks for a picture; it comes when the file does.
    expect(packThumb('u-gm01:keg')).toBeNull();
    await tick();
    expect(packThumb('u-gm01:keg')).toContain('url(blob:bbbb)');
    expect(removePack(t.ns)).toEqual({ ok: true });
    expect(known.mini('u-gm01:robot') || known.prop('u-gm01:keg')).toBe(false);
    expect(PROPS['u-gm01:keg']).toBeUndefined();
    expect(t.released).toEqual([H('b')]);
    expect(listPacks()).toEqual([]);
    off();
  });

  it('a file that is not what it claims stays a stand-in', async () => {
    const t = table();
    t.have.add(H('f'));
    addPiece(t.ns, 'props', 'fake', box('Fake', 'f'));
    want('u-gm01:fake');
    await tick();
    expect(pieceState('u-gm01:fake')).toBe('failed');
    expect(isWaiting(PROPS['u-gm01:fake'].mesh!.material)).toBe(true);
  });

  it('follows packs other devices wrote, and stops when they are taken away', () => {
    const t = table('bo');
    t.store.merge(['pk:u-ada', pack('u-ada', { name: 'Ada', pieces: { minis: { orc: box('Orc') } } }), Date.now() + 5, 'ada']);
    expect(known.mini('u-ada:orc')).toBe(true);
    expect(listPacks()).toMatchObject([{ ns: 'u-ada', name: 'Ada', own: false, bytes: 1000, pieces: [{ id: 'u-ada:orc', group: 'minis', bytes: 1000, state: 'waiting' }] }]);
    t.store.merge(['pk:u-ada', { v: 1, id: 'u-ada', pieces: 'gone wrong' }, Date.now() + 10, 'ada']);
    expect(known.mini('u-ada:orc')).toBe(false);
    expect(listPacks()).toMatchObject([{ ns: 'u-ada', pieces: [] }]);
    t.store.merge(['pk:u-ada', null, Date.now() + 20, 'ada']);
    expect(listPacks()).toEqual([]);
  });

  it('adds, removes and counts, within the limits', () => {
    const t = table();
    expect(removePiece(t.ns, 'minis', 'nobody')).toMatchObject({ ok: false });
    expect(renamePack(t.ns, 'x')).toMatchObject({ ok: false });
    expect(addPiece(t.ns, 'minis', 'Bad Name', box('x'))).toMatchObject({ ok: false });
    expect(addPiece(t.ns, 'minis', 'big', box('x', 'a', 6000))).toMatchObject({ ok: false }); // over its kind's budget
    expect(addPiece(t.ns, 'minis', 'odd', { name: 'x', kind: 'standee', ref: { h: 'no', n: 1, m: '' } } as Entry)).toMatchObject({ ok: false });
    expect(t.store.get(`pk:${t.ns}`)).toBeNull();
    addPiece(t.ns, 'minis', 'a', box('A', 'a', 1000), { shelf: 'Heroes' });
    addPiece(t.ns, 'props', 'b', box('B', 'b', 2500));
    expect(packSize(t.ns)).toBe(3500);
    expect(tableSize()).toBe(3500);
    expect(packSize('u-nobody')).toBe(0);
    expect(MINI_SHELVES.Heroes).toContain('u-gm01:a');
    addPiece(t.ns, 'props', 'a', box('A as a thing', 'a', 1200)); // the same name in the other group moves the piece
    expect(known.mini('u-gm01:a')).toBe(false);
    expect(known.prop('u-gm01:a')).toBe(true);
    expect(MINI_SHELVES.Heroes).not.toContain('u-gm01:a');
    expect(packSize(t.ns)).toBe(3700);
    expect(removePiece(t.ns, 'props', 'a')).toEqual({ ok: true });
    expect(packSize(t.ns)).toBe(2500);
    expect(renamePack(t.ns, '   ')).toMatchObject({ ok: false });
    for (let i = 0; i < MAX_PIECES - 1; i++) expect(addPiece(t.ns, 'minis', `m${i}`, box(`M${i}`)).ok).toBe(true);
    expect(addPiece(t.ns, 'minis', 'onemore', box('x'))).toMatchObject({ ok: false, reason: expect.stringContaining('64') });
    expect(addPiece(t.ns, 'minis', 'm3', box('Replaced')).ok).toBe(true); // replacing is not adding
    for (let i = 1; i < MAX_PACKS; i++) expect(addPiece(`other${i}`, 'props', 'x', box('x')).ok).toBe(true);
    expect(addPiece('ninth', 'props', 'x', box('x'))).toMatchObject({ ok: false, reason: expect.stringContaining('8') });
  });

  it('keeps what a newer app wrote into a manifest it edits', () => {
    const t = table();
    t.store.set(`pk:${t.ns}`, { ...pack(t.ns), future: { a: 1 }, pieces: { props: { car: { name: 'Car', kind: 'model-9', ref: ref(), scale: 3 } }, minis: {} } });
    expect(pieceState('u-gm01:car')).toBe('unknown');
    addPiece(t.ns, 'minis', 'a', box('A'));
    const raw = t.store.get<{ future: unknown; pieces: { props: { car: { scale: number } } } }>(`pk:${t.ns}`)!;
    expect(raw.future).toEqual({ a: 1 });
    expect(raw.pieces.props.car.scale).toBe(3);
    // The kind arrives (another module registers it): the piece is no longer unknown.
    registerPieceKind('model-9', { parse: () => ({}), build: async () => ({}) });
    expect(pieceState('u-gm01:car')).toBe('waiting');
  });

  it('only whoever may change the table changes its packs, and refuses a table that is full', () => {
    const player = table('pl01', false);
    expect(addPiece(player.ns, 'minis', 'a', box('A'))).toMatchObject({ ok: false, reason: expect.stringContaining('GM') });
    expect(removePack(player.ns)).toMatchObject({ ok: false });
    stopPacks();
    const t = table();
    registerPieceKind('test-huge', { parse: () => ({}), build: async () => ({}), budget: 19 * 1024 * 1024 });
    const huge = (i: number): Entry => ({ name: 'H', kind: 'test-huge', ref: ref(19 * 1024 * 1024, 'abcdef'[i]) });
    for (let i = 0; i < 5; i++) expect(addPiece(t.ns, 'props', `h${i}`, huge(i)).ok).toBe(true);
    expect(budget(tableSize()).level).toBe('soft');
    expect(addPiece(t.ns, 'props', 'h5', huge(5))).toMatchObject({ ok: false, reason: expect.stringContaining('full') });
  });
});
