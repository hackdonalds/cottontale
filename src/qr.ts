// A QR code for a link, as a grid of dark and light squares. Pure, and only what a link
// needs: bytes (UTF-8), error correction level L, versions 1 to 10 (up to 271 bytes).
// Whoever draws it leaves four light squares of margin around it.

/** Per version (index 0 unused): codewords in all, check codewords per block, blocks. */
const SPEC: [total: number, check: number, blocks: number][] = [
  [0, 0, 0], [26, 7, 1], [44, 10, 1], [70, 15, 1], [100, 20, 1], [134, 26, 1],
  [172, 18, 2], [196, 20, 2], [242, 24, 2], [292, 30, 2], [346, 18, 4],
];
/** Where the small alignment squares are centred, along either axis. */
const ALIGN: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// Arithmetic in GF(256), for the Reed–Solomon check codewords.
function mul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function checkWords(data: number[], n: number): number[] {
  const gen = new Array<number>(n).fill(0);
  gen[n - 1] = 1;
  for (let i = 0, root = 1; i < n; i++, root = mul(root, 2)) {
    for (let j = 0; j < n; j++) gen[j] = mul(gen[j], root) ^ (gen[j + 1] ?? 0);
  }
  const rem = new Array<number>(n).fill(0);
  for (const b of data) {
    const f = b ^ rem.shift()!;
    rem.push(0);
    for (let i = 0; i < n; i++) rem[i] ^= mul(gen[i], f);
  }
  return rem;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** How hard a grid is to read (the standard's four penalties): the mask with the least is the one used. */
function penalty(g: boolean[][]): number {
  const n = g.length, lines: string[] = [];
  let dark = 0, out = 0;
  for (let y = 0; y < n; y++) {
    let row = '', col = '';
    for (let x = 0; x < n; x++) {
      row += g[y][x] ? '1' : '0';
      col += g[x][y] ? '1' : '0';
      if (g[y][x]) dark++;
      if (x + 1 < n && y + 1 < n && g[y][x] === g[y][x + 1] && g[y][x] === g[y + 1][x] && g[y][x] === g[y + 1][x + 1]) out += 3;
    }
    lines.push(row, col);
  }
  for (const l of lines) {
    for (const run of l.match(/0{5,}|1{5,}/g) ?? []) out += run.length - 2;
    for (const like of ['10111010000', '00001011101']) for (let i = l.indexOf(like); i >= 0; i = l.indexOf(like, i + 1)) out += 40;
  }
  return out + Math.floor(Math.abs((dark * 20) / (n * n) - 10)) * 10;
}

/** The code for `text`: rows of squares, true = dark. Null when it is too long for a code this small. */
export function qr(text: string): boolean[][] | null {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  const room = (v: number) => SPEC[v][0] - SPEC[v][1] * SPEC[v][2] - (v < 10 ? 2 : 3);
  while (ver <= 10 && bytes.length > room(ver)) ver++;
  if (ver > 10) return null;
  const [total, check, blocks] = SPEC[ver], dataLen = total - check * blocks;

  // The message: "bytes follow", how many, the bytes, an end mark, and padding to fill the code.
  const bits: number[] = [];
  const put = (value: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(4, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataLen * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataLen; pad ^= 0xec ^ 0x11) data.push(pad);

  // Cut into blocks (the last ones a byte longer), each with its check codewords, then dealt out a byte at a time.
  const short = Math.floor(dataLen / blocks), long = dataLen % blocks, parts: { d: number[]; c: number[] }[] = [];
  for (let b = 0, at = 0; b < blocks; b++) {
    const d = data.slice(at, (at += short + (b >= blocks - long ? 1 : 0)));
    parts.push({ d, c: checkWords(d, check) });
  }
  const words: number[] = [];
  for (let i = 0; i <= short; i++) for (const p of parts) if (i < p.d.length) words.push(p.d[i]);
  for (let i = 0; i < check; i++) for (const p of parts) words.push(p.c[i]);

  // The grid: first what every code has (and where data may not go), then the data, then the mask.
  const n = ver * 4 + 17;
  const g = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const fixed = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const set = (x: number, y: number, dark: boolean) => { if (x >= 0 && x < n && y >= 0 && y < n) { g[y][x] = dark; fixed[y][x] = true; } };
  for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); }
  }
  const al = ALIGN[ver], last = al.length - 1;
  al.forEach((cx, i) => al.forEach((cy, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; // the big corner squares are there
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  /** The 15 bits that say which correction level and mask: written twice, beside the corners. */
  const format = (mask: number) => {
    const v = (1 << 3) | mask; // level L
    let rem = v;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((v << 10) | rem) ^ 0x5412, bit = (i: number) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(i));
    set(8, n - 8, true);
  };
  format(0); // reserves the squares; the real bits go in once the mask is chosen
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((v >>> i) & 1) === 1, a = n - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, dark); set(b, a, dark);
    }
  }
  // Data snakes up and down in columns two wide, from the bottom right, skipping what is fixed.
  for (let right = n - 1, i = 0; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < n; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? n - 1 - v : v;
      if (fixed[y][x] || i >= words.length * 8) continue;
      g[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
      i++;
    }
  }
  let best: boolean[][] | null = null, least = Infinity;
  for (let m = 0; m < 8; m++) {
    format(m);
    const masked = g.map((row, y) => row.map((dark, x) => (fixed[y][x] ? dark : dark !== MASKS[m](x, y))));
    const p = penalty(masked);
    if (p < least) { least = p; best = masked; }
  }
  return best;
}
