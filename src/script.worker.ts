// The worker a game system's scripts run in (see src/scriptbox.ts for the box itself, and
// src/script.ts for who starts this and when). It loads the QuickJS engine once and then
// answers one request at a time. Nothing of the app is in here: no store, no keys, no table.
import variant from '@jitl/quickjs-wasmfile-release-sync';
import wasmLocation from '@jitl/quickjs-wasmfile-release-sync/wasm?url';
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import { checkScript, runScript } from './scriptbox';

export type Ask = { id: number; run: { source: string; ctx: unknown; seed: number } } | { id: number; check: string };

const post = (m: unknown) => (postMessage as (m: unknown) => void)(m);
const engine = newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmLocation }));
engine.then(() => {
  // The engine is in: this worker needs nothing from the network any more. (A script cannot
  // reach these anyway, it lives inside the engine; this is the second lock on the door.)
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel']) {
    try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch { /* not ours to change */ }
  }
  post({ ready: true });
}, () => post({ ready: false }));

onmessage = (ev: MessageEvent<Ask>) => {
  const ask = ev.data;
  void engine.then((qjs) => {
    post({ id: ask.id, started: true }); // the clock on this call starts now (see CALL_MS in src/script.ts)
    if ('run' in ask) post({ id: ask.id, result: runScript(qjs, ask.run.source, ask.run.ctx, ask.run.seed) });
    else post({ id: ask.id, said: checkScript(qjs, ask.check) });
  }).catch(() => post({ id: ask.id, result: { edits: [], rolls: [], logs: [], error: 'the box broke', fatal: true } }));
};
