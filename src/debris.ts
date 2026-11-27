// Debris: the chunks that fly when something on the table is broken.
// All of them, from every break in progress, are one instanced mesh (one draw call, one shared
// shape and material, a colour per chunk), and each follows a worked-out arc (see `chunkAt`):
// no physics engine, and nothing at all once the last chunk has shrunk away.
import * as THREE from 'three';
import { chunkAt, type Chunk, type ChunkPose } from './breaking';

const CAP = 96; // four breaks at once; a fifth pushes the oldest out

interface Burst { chunks: Chunk[]; colors: THREE.Color[]; t: number }

export class Debris {
  private mesh: THREE.InstancedMesh;
  private bursts: Burst[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private at = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private pose: ChunkPose = { p: [0, 0, 0], scale: 0, angle: 0 };

  constructor(scene: THREE.Scene) {
    // A squat, slightly skewed box reads as a shard of stone or a splinter at this size.
    const geo = new THREE.BoxGeometry(1, 0.7, 0.85).applyMatrix4(new THREE.Matrix4().makeShear(0.25, 0, 0, 0.15, 0, 0));
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.95 }), CAP);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true; // but it casts none: the shadows are not redrawn while it flies
    scene.add(this.mesh);
  }

  /** How many chunks are in the air or settling (for the checks). */
  get count(): number { return this.bursts.reduce((n, b) => n + b.chunks.length, 0); }

  /** Set a break's chunks flying, in the colours of what broke. */
  burst(chunks: Chunk[], tones: string[]): void {
    const shades = tones.map((t) => new THREE.Color(t));
    const colors = chunks.map((c) => shades[Math.floor(c.tone * shades.length) % shades.length].clone().multiplyScalar(0.8 + ((c.tone * 7) % 1) * 0.35));
    this.bursts.push({ chunks, colors, t: 0 });
    while (this.bursts.reduce((n, b) => n + b.chunks.length, 0) > CAP) this.bursts.shift();
  }

  clear(): void {
    this.bursts.length = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** Move the chunks along. Returns true while there is (or just was) something to draw. */
  update(dt: number): boolean {
    if (!this.bursts.length) return false;
    let n = 0;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i], start = n;
      b.t += dt;
      for (let j = 0; j < b.chunks.length; j++) {
        const c = b.chunks[j], p = this.pose;
        if (!chunkAt(c, b.t, p)) continue;
        this.q.setFromAxisAngle(this.axis.set(...c.axis), p.angle);
        this.mesh.setMatrixAt(n, this.m.compose(this.at.set(...p.p), this.q, this.scale.setScalar(p.scale)));
        this.mesh.setColorAt(n++, b.colors[j]);
      }
      if (n === start) this.bursts.splice(i, 1); // every chunk of it is gone
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    return true; // also for the frame that clears the last of them away
  }
}
