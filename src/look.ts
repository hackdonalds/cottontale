// The diorama look: how the finished picture differs from the plain render.
// Soft contact shadows where things meet (ambient occlusion), glow around fire and
// crystal, a shallow depth of field that makes the scene read as a miniature on a
// table, and a darker, warmer grade with a vignette.
//
// It comes in steps, because every pass is a screenful of work for a phone:
// 0 everything; 1 glow and grade only. With the look switched off the board draws
// straight to the screen as it always did (see Board.adapt).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Grade } from './theme';

/** The grade every table has unless its theme brings another (see theme.ts): a little less colour, warm lights over cool shadows, a soft vignette. */
export const GRADE_DEFAULT: Required<Grade> = { sat: 0.9, warmth: 1, contrast: 0.35, vignette: 0.55 };

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: GRADE_DEFAULT.sat }, uWarm: { value: GRADE_DEFAULT.warmth }, uContrast: { value: GRADE_DEFAULT.contrast }, uVignette: { value: GRADE_DEFAULT.vignette } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    uniform float uSat, uWarm, uContrast, uVignette;
    void main() {
      vec3 c = clamp(texture2D(tDiffuse, vUv).rgb, 0.0, 1.0);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = max(mix(vec3(l), c, uSat), 0.0);               // paint, not plastic: pull the saturation in
      c = mix(c, c * mix(vec3(1.0), vec3(1.06, 1.0, 0.9), uWarm), smoothstep(0.1, 0.9, l));   // warm lights
      c = mix(c * mix(vec3(1.0), vec3(0.9, 0.96, 1.1), uWarm), c, smoothstep(0.0, 0.35, l));  // cool shadows
      c = c * c * (3.0 - 2.0 * c) * uContrast + c * (1.0 - uContrast);   // a little more contrast in the middle
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * uVignette;                   // vignette
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Look {
  private composer: EffectComposer;
  private bokeh: BokehPass;
  private ao: GTAOPass;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private gradeSig = JSON.stringify(GRADE_DEFAULT);
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, type: THREE.HalfFloatType }));
    this.composer.addPass(new RenderPass(scene, camera));
    const ao = (this.ao = new GTAOPass(scene, camera, size.x, size.y));
    ao.blendIntensity = 1.15;
    ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1.25, samples: 12 });
    this.composer.addPass(ao);
    this.composer.addPass((this.bloom = new UnrealBloomPass(size, 0.32, 0.7, 0.92)));
    this.bokeh = new BokehPass(scene, camera, { focus: 14, aperture: 0.0006, maxblur: 0.0045 });
    this.composer.addPass(this.bokeh);
    // Grading comes last, on the finished picture: its curves are made for values between
    // black and white, and the light before tone mapping runs far brighter than white.
    this.composer.addPass(new OutputPass());
    this.composer.addPass((this.grade = new ShaderPass(GRADE)));
  }
  /** How far light spills around the brightest things: little in daylight, a lot in the dark. */
  setGlow(strength: number): void { this.bloom.strength = strength; }
  /** The grade: a theme's, with the usual for whatever it leaves out. Returns whether anything changed. */
  setGrade(grade: Grade = {}): boolean {
    const g = { ...GRADE_DEFAULT, ...grade }, sig = JSON.stringify(g);
    if (sig === this.gradeSig) return false;
    const u = this.grade.uniforms as Record<string, { value: number }>;
    this.gradeSig = sig;
    u.uSat.value = g.sat;
    u.uWarm.value = g.warmth;
    u.uContrast.value = g.contrast;
    u.uVignette.value = g.vignette;
    return true;
  }
  /** 0: every pass. 1: only the cheap ones (glow and grade). */
  setLevel(level: number): void {
    this.ao.enabled = this.bokeh.enabled = level === 0;
  }
  setSize(w: number, h: number, ratio: number): void {
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
  }
  /** Draw the table, in focus at `focus` units from the camera. */
  render(focus: number): void {
    (this.bokeh.uniforms as Record<string, { value: number }>).focus.value = focus;
    this.composer.render();
  }
}
