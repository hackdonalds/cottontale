// Drawing a model's pictures onto its one atlas and encoding it inside a byte budget (see
// `AtlasJob` in ingest.ts). Runs in the import worker on an OffscreenCanvas; on a browser
// whose workers have no canvas, the worker asks the page to run this same code instead.
import type { AtlasJob } from './ingest';

type Canvas = OffscreenCanvas | HTMLCanvasElement;
type G = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function blobOf(c: Canvas, type: string, quality: number): Promise<Blob | null> {
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality }).catch(() => null);
  return new Promise((done) => c.toBlob(done, type, quality));
}

/** Can this thread draw an atlas at all? */
export const canDraw = (): boolean => typeof createImageBitmap === 'function' && (typeof OffscreenCanvas === 'function' || typeof document !== 'undefined');

export async function drawAtlas(job: AtlasJob): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const c: Canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(job.size, job.size) : Object.assign(document.createElement('canvas'), { width: job.size, height: job.size });
  const g = c.getContext('2d') as G | null;
  if (!g) throw new Error('no canvas');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, job.size, job.size);
  g.imageSmoothingQuality = 'high';
  for (const it of job.items) {
    // One picture at a time, made small where it is decoded, and let go of at once.
    const blob = new Blob([it.bytes as Uint8Array<ArrayBuffer>], { type: it.mime });
    let bmp: ImageBitmap;
    try { bmp = await createImageBitmap(blob, { resizeWidth: it.w, resizeHeight: it.h, resizeQuality: 'high', imageOrientation: 'none', premultiplyAlpha: 'none' }); } catch {
      try { bmp = await createImageBitmap(blob); } catch { throw new Error('One of this model\'s pictures cannot be opened on this phone.'); }
    }
    // Once a pixel larger first: the picture's own edge colours, where filtering would otherwise reach its neighbours.
    g.drawImage(bmp, it.x - 1, it.y - 1, it.w + 2, it.h + 2);
    g.drawImage(bmp, it.x, it.y, it.w, it.h);
    bmp.close();
  }
  g.fillStyle = '#ffffff';
  g.fillRect(job.white.x - 1, job.white.y - 1, job.white.w + 2, job.white.h + 2);
  // WebP where the browser writes it (Safari hands back a PNG instead), else JPEG: nothing here is see-through.
  let type = 'image/webp';
  for (const q of [0.86, 0.72, 0.55, 0.4]) {
    let blob = await blobOf(c, type, q);
    if (blob && blob.type !== type) { type = 'image/jpeg'; blob = await blobOf(c, type, q); }
    if (blob && blob.type === type && blob.size <= job.maxBytes) return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: type };
  }
  return null;
}
