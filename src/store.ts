// Shared board state: a last-writer-wins map. Every key holds the newest value
// anyone has written (null = deleted). Merging is commutative and idempotent, so
// peers can exchange ops and whole snapshots in any order and still converge.

export type Row = [key: string, value: unknown, time: number, by: string];
export interface Entry { v: unknown; t: number; b: string }

export class Store {
  entries = new Map<string, Entry>();
  private clock = 0;
  /** Fired for every effective change, local or remote. */
  onChange: (key: string, value: unknown, prev: unknown) => void = () => {};
  /** Fired for local writes only, so the network layer can broadcast them. */
  onLocal: (row: Row) => void = () => {};

  constructor(public me: string) {}

  get<T = unknown>(key: string): T | null {
    return (this.entries.get(key)?.v ?? null) as T | null;
  }

  set(key: string, value: unknown): void {
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
    const prev = cur?.v ?? null;
    if (prev !== null || value !== null) this.onChange(key, value ?? null, prev);
    return true;
  }

  dump(): Row[] {
    return [...this.entries].map(([k, e]) => [k, e.v, e.t, e.b]);
  }

  /** Live (non-deleted) keys with a given prefix. */
  *keys(prefix: string): Generator<string> {
    for (const [k, e] of this.entries) if (e.v !== null && k.startsWith(prefix)) yield k;
  }
}
