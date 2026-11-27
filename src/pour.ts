// Pouring loose pieces out over the table.
//
// Like the dice (dice.ts): the device that pours works the whole fall out up front
// with rigid bodies on the real terrain, records it, and sends the recording. Everyone
// plays it back, and when it ends the pourer writes where the pieces came to rest into
// the shared table. Nobody else runs any physics, and nothing has to match between devices.
import { columns, type Solid } from './dice';
import { LOOSE, POUR_FPS, POUR_FRAMES, POUR_REACH, decodeLoose, looseId, pourRoom, pourStarts, restOf, type Pour, type V3 } from './loose';
import type { Store } from './store';

const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const spread = (r: number) => (rnd() * 2 - 1) * r;

/**
 * Let `n` pieces of a kind go above the stroke from `a` to `b` and record how they fall:
 * onto the ground and the blocks, off the `solids` standing there (the loose pieces
 * already lying about among them), and off each other.
 */
export async function simulatePour(kind: string, n: number, a: V3, b: V3, store: Store, solids: Solid[] = []): Promise<Pour> {
  const C = await import('cannon-es');
  const def = LOOSE[kind];
  const world = new C.World({ gravity: new C.Vec3(0, -32, 0), allowSleep: true });
  world.defaultContactMaterial.friction = 0.55;
  world.defaultContactMaterial.restitution = 0.22;
  const o = [Math.round((a[0] + b[0]) * 50), Math.max(0, Math.round(Math.max(a[1], b[1]) * 100)), Math.round((a[2] + b[2]) * 50)] as V3; // cm
  const shape = (s: { h: V3; round?: boolean }) => (s.round ? new C.Cylinder(s.h[0], s.h[0], s.h[1] * 2, 10) : new C.Box(new C.Vec3(...s.h)));

  const ground = new C.Body({ type: C.Body.STATIC, shape: new C.Plane() });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);
  for (const [x, y, z, h] of columns(store, Math.floor(o[0] / 100), Math.floor(o[2] / 100), POUR_REACH / 2 + 4)) {
    world.addBody(new C.Body({ type: C.Body.STATIC, shape: new C.Box(new C.Vec3(0.5, h / 2, 0.5)), position: new C.Vec3(x + 0.5, y + h / 2, z + 0.5) }));
  }

  const size = Math.max(...def.h);
  const bodies = pourStarts(n, a, b, size, rnd).map((p) => {
    const body = new C.Body({
      mass: def.mass, shape: shape(def),
      position: new C.Vec3(...p),
      velocity: new C.Vec3(spread(0.9), -rnd(), spread(0.9)),
      angularVelocity: new C.Vec3(spread(5), spread(5), spread(5)),
      linearDamping: 0.2, angularDamping: 0.3,
      allowSleep: true, sleepSpeedLimit: 0.3, sleepTimeLimit: 0.25,
    });
    body.quaternion.setFromEuler(spread(Math.PI), spread(Math.PI), spread(Math.PI));
    world.addBody(body);
    return body;
  });
  // What stands on the table. A thing a piece would start inside of is left out: it would be shot out of it.
  for (const s of solids) {
    const fixed = new C.Body({ type: C.Body.STATIC, shape: shape(s), position: new C.Vec3(...s.p) });
    if (s.q) fixed.quaternion.set(...s.q);
    const [hx, hy, hz] = s.round ? [s.h[0], s.h[1], s.h[0]] : s.h;
    const inside = bodies.some((p) => {
      const at = fixed.pointToLocalFrame(p.position);
      return Math.abs(at.x) < hx + size && Math.abs(at.y) < hy + size && Math.abs(at.z) < hz + size;
    });
    if (!inside) world.addBody(fixed);
  }

  const q: number[][] = bodies.map(() => []);
  const last = bodies.map(() => [0, 0, 0, 0, 0, 0, 0]);
  let frames = 0, quiet = 0, slice = performance.now();
  for (let step = 0; frames < POUR_FRAMES; step++) {
    if (step % 4 === 0) {
      let still = true;
      bodies.forEach((p, i) => {
        // Never through the table, whatever the engine says: what is stored must be a place a piece can be.
        const now = [
          Math.round(p.position.x * 100) - o[0], Math.max(0, Math.round(p.position.y * 100)) - o[1], Math.round(p.position.z * 100) - o[2],
          Math.round(p.quaternion.x * 1000), Math.round(p.quaternion.y * 1000), Math.round(p.quaternion.z * 1000), Math.round(p.quaternion.w * 1000),
        ];
        for (let c = 0; c < 7; c++) {
          const d = now[c] - last[i][c];
          if (Math.abs(d) > (c < 3 ? 1 : 6)) still = false;
          q[i].push(d);
        }
        last[i] = now;
      });
      frames++;
      // Done when every piece is asleep, or nothing has visibly moved for a while (a heap can jitter for ever).
      quiet = still ? quiet + 1 : 0;
      if (frames > 12 && (quiet >= 12 || bodies.every((p) => p.sleepState === C.Body.SLEEPING))) break;
    }
    world.step(1 / (POUR_FPS * 4)); // small steps: the pieces are small and thin
    if (performance.now() - slice > 10) { // stay responsive on slow phones
      await new Promise((r) => setTimeout(r));
      slice = performance.now();
    }
  }
  return { o, i: kind, ids: bodies.map(() => looseId(rnd)), n: frames, q };
}

/** What a pour needs from the table it happens on. */
export interface PourHost {
  store: Store;
  /** The board being looked at, as an id ('' is the main one). */
  here(): string;
  count(): number;
  solidsNear(c: V3, reach: number): Solid[];
  send(t: Pour): void;
  play(t: Pour): Promise<void>;
  /** Write a batch of edits as one undo step. */
  commit(edits: [string, unknown][]): void;
}

let pouring = false;
/**
 * Pour `want` pieces out along the stroke `a`–`b`. Returns how many were dropped
 * (0: the board is full, or another pour is still being worked out).
 */
export async function pour(host: PourHost, kind: string, want: number, a: V3, b: V3): Promise<number> {
  const n = pourRoom(host.count(), want);
  if (pouring || !n || !LOOSE[kind]) return 0;
  pouring = true;
  try {
    const bd = host.here();
    const mid: V3 = [(a[0] + b[0]) / 2, Math.max(a[1], b[1]), (a[2] + b[2]) / 2];
    const t = await simulatePour(kind, n, a, b, host.store, host.solidsNear(mid, POUR_REACH / 2 + 4));
    if (host.here() !== bd) return 0; // looked away while it was being worked out
    host.send(t);
    pouring = false; // the next pour may start while this one is still falling
    await host.play(t);
    const rest = restOf(t);
    if (host.here() === bd) host.commit(rest);
    // The pourer moved to another board mid-fall: the pieces still belong to the one they fell on.
    else for (const [k, v] of rest) if (decodeLoose(v)) host.store.setRaw(bd ? `@${bd}/${k}` : k, v);
    return rest.length;
  } finally {
    pouring = false;
  }
}
