// Pixels, without a library: what the import page (ui/importPage.ts) does to a picture between
// the camera and the table. Everything here is pure and runs under node (unit tests):
// reading a picture's size from its first bytes, the crop frame, cutting a background away
// (tap a colour to flood-erase it, an eraser and a restore brush), and the sums that keep a
// picture inside its budget.

/** RGBA pixels, as a canvas hands them out. */
export interface Pixels { width: number; height: number; data: Uint8ClampedArray }

// ---- how big is this picture? (asked before decoding anything a stranger sent) ----------

export interface ImageSize { w: number; h: number; type: 'png' | 'jpeg' | 'webp' | 'gif' }

/** The size a PNG, JPEG, WebP or GIF says it has, from its header. Null for anything else. */
export function imageSize(b: Uint8Array): ImageSize | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1], u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const tag = (i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  const ok = (w: number, h: number, type: ImageSize['type']): ImageSize | null => (w > 0 && h > 0 ? { w, h, type } : null);
  if (b.length >= 24 && b[0] === 0x89 && tag(1, 'PNG\r\n\x1a\n') && tag(12, 'IHDR')) {
    return ok(u16(16) * 65536 + u16(18), u16(20) * 65536 + u16(22), 'png');
  }
  if (b.length >= 10 && tag(0, 'GIF8')) return ok(u16le(6), u16le(8), 'gif');
  if (b.length >= 30 && tag(0, 'RIFF') && tag(8, 'WEBP')) {
    if (tag(12, 'VP8 ') && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff, 'webp');
    if (tag(12, 'VP8L') && b[20] === 0x2f) return ok(1 + (((b[22] & 0x3f) << 8) | b[21]), 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | (b[22] >> 6)), 'webp');
    if (tag(12, 'VP8X')) return ok(1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), 'webp');
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; } // padding
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) { i += 2; continue; } // markers with nothing after them
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(u16(i + 7), u16(i + 5), 'jpeg');
      i += 2 + u16(i + 2);
    }
  }
  return null;
}

// ---- sizes and budgets ------------------------------------------------------------------

/** A token is 256 px (512 when large) and at most 60 kB; a map tile at most 2048 px and 600 kB. */
export const TOKEN_PX = 256, TOKEN_BIG_PX = 512, TILE_PX = 2048;
export const TOKEN_BYTES = 60 * 1024, TILE_BYTES = 600 * 1024;
/** No picture is decoded larger than this (iOS canvases stop at 4096 px a side and 16.7 megapixels). */
export const DECODE_SIDE = 4096, DECODE_PIXELS = 16_700_000;
/** A file bigger than this is not even opened. */
export const INPUT_BYTES = 40 * 1024 * 1024;

/** `w`×`h` made to fit a square of `max`, keeping its shape. Never grows, never under one pixel. */
export function fit(w: number, h: number, max: number): [w: number, h: number] {
  const k = Math.min(1, max / Math.max(w, h, 1));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** The size to decode a picture at: inside `side`, and inside the pixel count a phone's canvas allows. */
export function decodeSize(w: number, h: number, side = DECODE_SIDE, pixels = DECODE_PIXELS): [w: number, h: number] {
  const [fw, fh] = fit(w, h, side);
  const k = Math.min(1, Math.sqrt(pixels / (fw * fh)));
  return [Math.max(1, Math.floor(fw * k)), Math.max(1, Math.floor(fh * k))];
}

/**
 * What to try, in order, to get a picture under its budget: its longest side and a quality.
 * First the full size at falling quality, then smaller and smaller (a format without a quality
 * setting only takes the first of each size).
 */
export function* encodeSteps(side: number, min = 64): Generator<[side: number, quality: number]> {
  for (let s = Math.max(1, Math.round(side)); ; s = Math.round(s * 0.8)) {
    for (const q of [0.86, 0.72, 0.55]) yield [s, q];
    if (s <= min) return;
  }
}

/** "48 kB", "1.2 MB". */
export function bytesText(n: number): string {
  if (n < 1024) return `${Math.max(0, Math.round(n))} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// ---- the crop frame -------------------------------------------------------------------------

/** How the picture lies under the frame: `s` screen pixels per picture pixel, and the picture point at the frame's centre. */
export interface CropView { s: number; cx: number; cy: number }

/** Keep the frame (`fw`×`fh` on screen) covered by the picture (`iw`×`ih`): no zooming out past it, no sliding off it. */
export function clampCrop(v: CropView, iw: number, ih: number, fw: number, fh: number, maxZoom = 8): CropView {
  const cover = Math.max(fw / iw, fh / ih), s = Math.min(Math.max(v.s, cover), cover * maxZoom);
  const hw = fw / s / 2, hh = fh / s / 2;
  return { s, cx: Math.min(Math.max(v.cx, hw), Math.max(hw, iw - hw)), cy: Math.min(Math.max(v.cy, hh), Math.max(hh, ih - hh)) };
}

/** The part of the picture inside the frame, in picture pixels. */
export function cropRect(v: CropView, fw: number, fh: number): { x: number; y: number; w: number; h: number } {
  const w = fw / v.s, h = fh / v.s;
  return { x: v.cx - w / 2, y: v.cy - h / 2, w, h };
}

/** Zoom by `k` keeping the picture point under a screen point (`px`,`py` from the frame's centre) where it is. */
export function zoomCrop(v: CropView, k: number, px = 0, py = 0): CropView {
  const s = v.s * k;
  return { s, cx: v.cx + px / v.s - px / s, cy: v.cy + py / v.s - py / s };
}

// ---- cutting the background away ----------------------------------------------------------------

/** A pixel this see-through counts as already gone. */
const GONE = 8;

/**
 * Tap a colour: everything of about that colour that touches the tapped pixel becomes
 * see-through. `tolerance` is 0–100 (0: exactly that colour; 100: everything connected).
 * Returns how many pixels went. Colours are compared to the tapped one, not to their
 * neighbours, so a soft gradient does not leak into the figure.
 */
export function floodErase(px: Pixels, x: number, y: number, tolerance: number): number {
  const { width: w, height: h, data: d } = px;
  x = Math.floor(x); y = Math.floor(y);
  if (!(x >= 0 && y >= 0 && x < w && y < h)) return 0;
  const at = (y * w + x) * 4;
  if (d[at + 3] < GONE) return 0;
  const r0 = d[at], g0 = d[at + 1], b0 = d[at + 2];
  const t = Math.min(100, Math.max(0, tolerance)) / 100, limit = t * t * 3 * 255 * 255;
  const like = (i: number) => {
    if (d[i + 3] < GONE) return false;
    const dr = d[i] - r0, dg = d[i + 1] - g0, db = d[i + 2] - b0;
    return dr * dr + dg * dg + db * db <= limit;
  };
  // Spans, not single pixels: a phone fills a megapixel in a few milliseconds this way.
  const stack = [x, y];
  let n = 0;
  while (stack.length) {
    const sy = stack.pop()!, sx = stack.pop()!;
    let i = (sy * w + sx) * 4;
    if (!like(i)) continue;
    let l = sx, r = sx;
    while (l > 0 && like(i - 4)) { l--; i -= 4; }
    i = (sy * w + sx) * 4;
    while (r < w - 1 && like(i + 4)) { r++; i += 4; }
    for (let k = l; k <= r; k++) d[(sy * w + k) * 4 + 3] = 0;
    n += r - l + 1;
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= h) continue;
      let open = false;
      for (let k = l; k <= r; k++) {
        const ok = like((ny * w + k) * 4);
        if (ok && !open) stack.push(k, ny);
        open = ok;
      }
    }
  }
  return n;
}

/**
 * A round brush at (`x`,`y`): rubs pixels out, or (with `alpha0`, the picture's own alpha as it
 * came in) puts them back. Colours are never touched, so nothing is lost by rubbing out.
 * Returns the box that changed, for redrawing just that.
 */
export function brush(px: Pixels, x: number, y: number, radius: number, alpha0?: Uint8Array): { x: number; y: number; w: number; h: number } {
  const { width: w, height: h, data: d } = px, r = Math.max(0.5, radius);
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(w - 1, Math.ceil(x + r));
  const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(h - 1, Math.ceil(y + r));
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      if ((i + 0.5 - x) ** 2 + (j + 0.5 - y) ** 2 > r * r) continue;
      d[(j * w + i) * 4 + 3] = alpha0 ? alpha0[j * w + i] : 0;
    }
  }
  return { x: x0, y: y0, w: Math.max(0, x1 - x0 + 1), h: Math.max(0, y1 - y0 + 1) };
}

/** A stroke from one point to the next, without gaps. */
export function stroke(px: Pixels, x0: number, y0: number, x1: number, y1: number, radius: number, alpha0?: Uint8Array): { x: number; y: number; w: number; h: number } {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, radius / 2)));
  let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const b = brush(px, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, radius, alpha0);
    if (!b.w || !b.h) continue;
    ax = Math.min(ax, b.x); ay = Math.min(ay, b.y); bx = Math.max(bx, b.x + b.w); by = Math.max(by, b.y + b.h);
  }
  return ax === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: ax, y: ay, w: bx - ax, h: by - ay };
}

/** Just the alpha of a picture (what Undo and the restore brush keep). */
export function alphaOf(px: Pixels): Uint8Array {
  const a = new Uint8Array(px.width * px.height);
  for (let i = 0; i < a.length; i++) a[i] = px.data[i * 4 + 3];
  return a;
}
export function setAlpha(px: Pixels, a: Uint8Array): void {
  for (let i = 0; i < a.length; i++) px.data[i * 4 + 3] = a[i];
}
/** Is any of it see-through? (Decides between a format with alpha and one without.) */
export function hasAlpha(px: Pixels): boolean {
  for (let i = 3; i < px.data.length; i += 4) if (px.data[i] < 250) return true;
  return false;
}
