// The table top the scene stands on: dark planked wood with the grid scored into it,
// painted once into a tiling texture (no image to download, no extra draw call).
import * as THREE from 'three';

/** How many cells one repeat of the texture covers: wide enough that planks do not visibly repeat. */
export const TABLE_SPAN = 8;

export function tableTexture(px: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const g = cv.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const cell = px / TABLE_SPAN, planks = 4, ph = px / planks;
  for (let p = 0; p < planks; p++) {
    const y0 = p * ph, tone = 0.9 + rnd() * 0.2;
    g.fillStyle = `rgb(${Math.round(46 * tone)},${Math.round(33 * tone)},${Math.round(25 * tone)})`;
    g.fillRect(0, y0, px, ph);
    // Grain: long wavering strokes that leave one side of the tile and come back in on the other.
    for (let i = 0; i < 46; i++) {
      const y = y0 + rnd() * ph, a = rnd() * ph * 0.05, f = 1 + Math.floor(rnd() * 3), ph0 = rnd() * 6.28, dark = rnd() < 0.62;
      g.strokeStyle = dark ? `rgba(14,9,6,${0.1 + rnd() * 0.22})` : `rgba(150,112,78,${0.05 + rnd() * 0.1})`;
      g.lineWidth = Math.max(1, (0.4 + rnd() * 1.6) * px / 512);
      g.beginPath();
      for (let x = 0; x <= px; x += px / 32) g.lineTo(x, y + Math.sin((x / px) * 6.2832 * f + ph0) * a);
      g.stroke();
    }
    // The seam between two planks, with a worn highlight on the lower lip.
    g.fillStyle = 'rgba(8,5,4,.75)';
    g.fillRect(0, y0, px, Math.max(1, px / 256));
    g.fillStyle = 'rgba(190,150,110,.1)';
    g.fillRect(0, y0 + Math.max(1, px / 256), px, Math.max(1, px / 256));
    // Planks butt end to end at a different place in every row.
    const x = Math.floor(rnd() * TABLE_SPAN) * cell + cell / 2;
    g.fillStyle = 'rgba(8,5,4,.6)';
    g.fillRect(x, y0, Math.max(1, px / 256), ph);
  }
  // The grid: scored lines, a dark cut with a faint light edge, not a drawn-on overlay.
  const w = Math.max(1.5, px / 256);
  for (let i = 0; i < TABLE_SPAN; i++) {
    g.fillStyle = 'rgba(8,5,4,.72)';
    g.fillRect(i * cell - w / 2, 0, w, px);
    g.fillRect(0, i * cell - w / 2, px, w);
    g.fillStyle = 'rgba(215,175,130,.22)';
    g.fillRect(i * cell + w / 2, 0, w, px);
    g.fillRect(0, i * cell + w / 2, px, w);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
