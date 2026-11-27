// Shared board state: a last-writer-wins map. Every key holds the newest value
// anyone has written (null = deleted). Merging is commutative and idempotent, so
// peers can exchange ops and whole snapshots in any order and still converge.

export type Row = [key: string, value: unknown, time: number, by: string];
export interface Entry { v: unknown; t: number; b: string }

/** Keys that belong to one board; everything else (GM, settings, the board list) is table-wide. */
const BOARD_KEY = /^(?:[bmf]:|turn$)/;

export class Store {
  entries = new Map<string, Entry>();
  private clock = 0;
  /**
   * Which board the table is looking at. A table can hold several boards; the
   * main one uses plain keys and the others are stored as `@<id>/<key>`. Code
   * above the store always uses plain keys and sees only the current board.
   */
  private scope = '';
  /** Fired for every effective change, local or remote. */
  onChange: (key: string, value: unknown, prev: unknown) => void = () => {};
  /** Fired for local writes only, so the network layer can broadcast them. */
  onLocal: (row: Row) => void = () => {};

  constructor(public me: string) {}

  setBoard(id: string): void { this.scope = id ? `@${id}/` : ''; }
  private phys(key: string): string { return this.scope && BOARD_KEY.test(key) ? this.scope + key : key; }
  /** The plain key for a stored key, or null if it belongs to a board we are not looking at. */
  private plain(key: string): string | null {
    if (key[0] === '@') return this.scope && key.startsWith(this.scope) ? key.slice(this.scope.length) : null;
    return this.scope && BOARD_KEY.test(key) ? null : key;
  }

  get<T = unknown>(key: string): T | null {
    return (this.entries.get(this.phys(key))?.v ?? null) as T | null;
  }

  set(key: string, value: unknown): void { this.setRaw(this.phys(key), value); }

  /** Write a stored key directly, whatever board it belongs to (copying or deleting whole boards). */
  setRaw(key: string, value: unknown): void {
    this.clock = Math.max(Date.now(), this.clock + 1);
    const row: Row = [key, value, this.clock, this.me];
    if (this.merge(row)) this.onLocal(row);
  }

  /** Apply a row if it is newer than what we hold. Returns true if applied. */
  merge([key, value, time, by]: Row): boolean {
    if (typeof key !== 'string' || typeof time !== 'number' || typeof by !== 'string') return false;
    const cur = this.entries.get(key);
    if (cur && (time < cur.t || (time === cur.t && by <= cur.b))) return false;
    this.entries.set(key, { v: value ?? null, t: time, b: by });
    this.clock = Math.max(this.clock, time);
    const prev = cur?.v ?? null, plain = this.plain(key);
    if (plain !== null && (prev !== null || value !== null)) this.onChange(plain, value ?? null, prev);
    return true;
  }

  dump(): Row[] {
    return [...this.entries].map(([k, e]) => [k, e.v, e.t, e.b]);
  }

  /** Live (non-deleted) keys with a given prefix, on the current board. */
  *keys(prefix: string): Generator<string> {
    const p = this.phys(prefix), cut = p.length - prefix.length;
    for (const [k, e] of this.entries) if (e.v !== null && k.startsWith(p)) yield k.slice(cut);
  }
}
