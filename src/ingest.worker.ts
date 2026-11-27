// The import worker: one model, start to finish, off the page's thread (see ingest.ts). The
// page starts one for each import and ends it afterwards (or when the GM cancels), so nothing
// of a model stays in memory once it is done.
//
//   page → { file, set }
//   worker → { t: 'step', text } … then { t: 'done', glb, stats } or { t: 'fail', reason }
//   worker → { t: 'atlas', id, job }, page → { t: 'atlas', id, made }   (only where a worker has no canvas)
import { canDraw, drawAtlas } from './atlasCanvas';
import { INPUT_BYTES, ModelError, glbHeader, inspect, parseJson } from './glb';
import { ingest, type AtlasJob } from './ingest';

type Made = { bytes: Uint8Array; mime: string } | null;
const scope = self as unknown as { postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };
const waiting = new Map<number, (made: Made) => void>();
let asked = 0;

scope.onmessage = (e) => {
  const m = e.data as { t?: string; id?: number; made?: Made; file?: Blob; set?: boolean };
  if (m.t === 'atlas') { waiting.get(m.id!)?.(m.made ?? null); waiting.delete(m.id!); return; }
  if (m.file) void run(m.file, !!m.set);
};

async function run(file: Blob, set: boolean): Promise<void> {
  const step = (text: string) => scope.postMessage({ t: 'step', text });
  try {
    step('Reading the file');
    // The first bytes say how long the description is, and the description how big the model: both are read before the rest.
    const head = glbHeader(new Uint8Array(await file.slice(0, 20).arrayBuffer()), file.size);
    inspect(parseJson(new Uint8Array(await file.slice(head.jsonAt, head.jsonAt + head.jsonLen).arrayBuffer())));
    if (file.size > INPUT_BYTES) throw new ModelError('That file is too large.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const here = typeof OffscreenCanvas === 'function' && canDraw();
    const atlas = (job: AtlasJob): Promise<Made> => (here ? drawAtlas(job) : new Promise((done) => { waiting.set(++asked, done); scope.postMessage({ t: 'atlas', id: asked, job }); }));
    const { glb, stats } = await ingest(bytes, { set }, { step, atlas });
    const out = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
    scope.postMessage({ t: 'done', glb: out, stats }, [out]);
  } catch (e) {
    scope.postMessage({ t: 'fail', reason: e instanceof ModelError || (e instanceof Error && /picture/.test(e.message)) ? e.message : 'This model could not be read (it may be damaged, or too large for this phone).' });
  }
}
