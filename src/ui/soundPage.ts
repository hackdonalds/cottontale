// Prep → Sound: the table's own sounds, from the phone. Three parts on one page: the list of what the
// table has (try, rename, use on this board, remove), adding a recording (a file, or the microphone
// where the phone offers it), and a small mixer that builds a soundscape from the engine's own layers.
// Also the soundboard row of the Atmosphere sheet. The rules (what an entry is, budgets, formats, the
// mixer's arithmetic) are in src/sounds.ts; this file is only the screen.
//
// The page may be drawn again from nothing at any time (ui/prep.ts), so what is being added or mixed
// lives here in the module, not in the page.

import type { ServerOutcome } from '../blob';
import type { Scape } from '../sound';
import {
  BUDGET, MAX_MIX, MAX_SOUND_NAME, budgetOf, checkBudget, decodeRef, fmtBytes, fmtTime, mixRecipe, parseMixPresets, refBytes, shrinkWav, soundFormat, tableSoundId,
  type MixPick, type MixPreset, type SoundFormat, type SoundKind, type TableSound, type TableSounds,
} from '../sounds';
import { atmo, setAtmo } from '../theme';
import { registerPrepPage } from './prep';

export interface SoundPageHost {
  store: { get<T = unknown>(key: string): T | null; set(key: string, value: unknown): void };
  full(): boolean;
  /** The emotes a table effect may give a voice to. */
  emotes: string[];
  /** Turn sound on for this device. */
  soundOn(): void;
}

const ico = (id: string) => `<svg><use href="#i-${id}"/></svg>`;
const STOP = '<svg viewBox="0 0 24 24"><rect x="6.500" y="6.500" width="11" height="11" rx="2"/></svg>';
type Props = Partial<Record<string, unknown>> & { class?: string; html?: string; text?: string; label?: string };
/** A little element builder: `class`, `html`, `text`, `label` (title and aria-label), `data-*`, and anything else as a property. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: (Node | string | null | false | undefined)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'html') e.innerHTML = String(v);
    else if (k === 'text') e.textContent = String(v);
    else if (k === 'label') { e.title = String(v); e.setAttribute('aria-label', String(v)); }
    else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role' || k === 'for') e.setAttribute(k, String(v));
    else (e as unknown as Record<string, unknown>)[k] = v;
  }
  for (const kid of kids) if (kid) e.append(kid);
  return e;
}
const slider = (name: string, value: number, on: (v: number) => void, label = name): HTMLLabelElement => {
  const input = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(value) });
  input.setAttribute('aria-label', label);
  input.oninput = () => on(+input.value);
  return h('label', { class: 'slider' }, h('span', { text: name }), input);
};
const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };
const KIND: Record<SoundKind, string> = { music: 'Music', ambience: 'Ambience', effect: 'Effect' };
const MIME_NAME: Record<string, string> = { 'audio/mpeg': 'MP3', 'audio/mp4': 'M4A', 'audio/aac': 'AAC', 'audio/wav': 'WAV', 'audio/ogg': 'Ogg', 'audio/webm': 'WebM', 'audio/flac': 'FLAC', 'audio/3gpp': '3GP' };

/** How each server answered, in words. */
function outcomeLines(outcomes: ServerOutcome[]): string[] {
  return outcomes.map((o) => `${host(o.url)}: ${o.ok ? 'took it' : `said no (${o.reason ?? 'no reason given'})`}`);
}

/** How long a sound file is, from its header (never by decoding it). Rejects if this device cannot read it. */
export function probeDuration(file: Blob, wait = 10_000): Promise<number> {
  return new Promise((ok, no) => {
    const el = new Audio(), url = URL.createObjectURL(file);
    const end = (fn: () => void) => { clearTimeout(timer); el.onloadedmetadata = el.ondurationchange = el.onerror = null; el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); fn(); };
    const timer = setTimeout(() => end(() => no(new Error('timed out'))), wait);
    const settle = () => { const d = el.duration; if (Number.isFinite(d) && d > 0) end(() => ok(d)); };
    el.preload = 'metadata';
    el.onerror = () => end(() => no(new Error('unreadable')));
    el.ondurationchange = settle;
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration)) settle();
      else el.currentTime = 1e7; // a recording without a length in its header: seeking to the end makes the browser find it
    };
    el.src = url;
  });
}

// ---- the soundboard row of the Atmosphere sheet ----------------------------------------------

/** The table's effects that are buttons: one tap, and everyone hears it. Shown to whoever may change the table. */
export function renderSoundboard(el: HTMLElement, ts: TableSounds, full: boolean): void {
  const board = full ? ts.board() : [], sig = JSON.stringify(board.map(([id, s]) => [id, s.name]));
  el.hidden = !board.length;
  if (el.dataset.sig !== sig) { // the same buttons stay under the finger while the table changes
    el.dataset.sig = sig;
    el.innerHTML = '';
    if (board.length) el.append(h('p', { class: 'hint', text: 'Soundboard — one tap, and everyone hears it' }));
    for (const [id, s] of board) {
      const b = h('button', { text: s.name, 'data-sfx': id });
      b.onclick = () => ts.hit(id);
      el.append(b);
    }
  }
  renderSoundState(ts);
}
/** One quiet line under the soundscapes while the GM's recording is on its way. */
function renderSoundState(ts: TableSounds): void {
  const line = document.getElementById('sndState'), s = ts.sound;
  if (!line) return;
  const text = !s.enabled || s.playing === 'off' || s.playing === 'trial' ? '' : s.recording === 'loading' ? 'Fetching the recording…' : s.recording === 'failed' ? 'The recording cannot be had right now. Trying again…' : '';
  line.hidden = !text;
  line.textContent = text;
}

// ---- the page ----------------------------------------------------------------------------------

interface Draft {
  kind: SoundKind; file: Blob; mime: string; format: SoundFormat; seconds: number; fileName: string;
  name: string; loop: boolean; gain: number; as: string; local: string; notes: string[];
  busy?: boolean; error?: string;
}
interface Note { text: string; bad?: boolean; lines?: string[] }

export function registerSoundPage(ts: TableSounds, app: SoundPageHost): void {
  const sound = ts.sound;
  let presets: MixPreset[] = [];
  let draft: Draft | null = null, importNote: Note | null = null, probing = false;
  let open: string | null = null, confirming: string | null = null, retrying: string | null = null;
  const rowNotes = new Map<string, Note>();
  const mixer = { picks: [] as MixPick[], name: '', editing: null as string | null, note: null as Note | null };
  /** What is being tried out on this device: a soundscape of the list (`t:<id>`), the draft, or the mix. */
  let trying: string | null = null, trial: Scape | null = null;
  let root: HTMLElement | null = null, listSig = '';
  const parts = { notice: h('div'), list: h('div', { class: 'sndList' }), add: h('div', { class: 'sndPart' }), mix: h('div', { class: 'sndPart' }) };

  const amb = () => atmo(app.store, 'amb', 'off');
  function audition(what: string | null, scape: Scape | null): void {
    trying = scape ? what : null;
    trial = scape;
    sound.audition(scape);
  }
  const stopTrying = () => { if (trying) audition(null, null); };
  function dropDraft(): void {
    if (trying === 'draft') stopTrying();
    ts.forget(draft?.local);
    draft = null;
  }
  const note = (n: Note | null): HTMLElement | null => n && h('p', { class: `sndMsg${n.bad ? ' bad' : ''}`, role: n.bad ? 'alert' : 'status' }, n.text, ...(n.lines ?? []).map((l) => h('small', { text: l })));
  const playBtn = (on: boolean, label: string, click: () => void): HTMLButtonElement => {
    const b = h('button', { class: `sndPlay${on ? ' on' : ''}`, html: on ? STOP : ico('play'), label: on ? 'Stop' : label, disabled: !sound.enabled });
    b.onclick = click;
    return b;
  };

  // ---- this table's sounds ----
  function meta(s: TableSound): string {
    const file = decodeRef(s.scape?.file ?? s.fx?.file);
    const what = file ? `${fmtBytes(refBytes(file))} · ${MIME_NAME[file.m] ?? 'recording'}` : s.mix ? 'mixed here' : 'a recipe';
    const use = s.kind !== 'effect' ? '' : s.as ? ` · plays as ${asName(s.as).toLowerCase()}` : ' · soundboard';
    return `${KIND[s.kind]} · ${what}${use}`;
  }
  const asName = (as: string): string => ({ '': 'A soundboard button', clack: 'Dice landing', thud: 'A piece set down', ping: 'A ping', emote: 'Any emote' } as Record<string, string>)[as] ?? `Emote: ${as.split(':')[1]}`;
  const asChoices = () => ['', 'clack', 'thud', 'ping', 'emote', ...app.emotes.map((e) => `emote:${e}`)];
  function asSelect(value: string, on: (as: string) => void): HTMLLabelElement {
    const sel = h('select', { 'aria-label': 'What the effect is used as' });
    for (const as of asChoices()) sel.append(h('option', { value: as, text: asName(as) }));
    sel.value = value;
    sel.onchange = () => on(sel.value);
    return h('label', { class: 'slider' }, h('span', { text: 'Use as' }), sel);
  }
  /** Save a change to an entry; what goes wrong is said on its row. */
  function change(id: string, s: TableSound, patch: Partial<TableSound>): void {
    const next = { ...s, ...patch };
    if (patch.as === '') delete next.as;
    const why = ts.save(id, next);
    if (why) rowNotes.set(id, { text: why, bad: true }); else rowNotes.delete(id);
    drawList(true);
  }
  function drawList(force = false): void {
    const all = ts.list(), sig = JSON.stringify([all, amb(), sound.enabled, app.full(), trying, open, confirming, retrying]);
    if (!force && sig === listSig) return;
    // Someone is typing a name: the list waits.
    if (!force && document.activeElement instanceof HTMLInputElement && document.activeElement.type !== 'range' && parts.list.contains(document.activeElement)) return;
    listSig = sig;
    const el = parts.list;
    el.innerHTML = '';
    el.append(h('h3', { text: `This table’s sounds${all.length ? ` (${all.length} of 24)` : ''}` }));
    if (!all.length) el.append(h('p', { class: 'hint', text: 'None yet. Add a recording below, or mix a soundscape from rain, wind, drones and chimes. Everyone at the table hears them.' }));
    for (const [id, s] of all) {
      const tid = tableSoundId(id), isOpen = open === id, file = s.scape?.file ?? s.fx?.file;
      const row = h('div', { class: `sndRow${isOpen ? ' open' : ''}`, 'data-snd': id });
      const play = playBtn(trying === tid, `Try “${s.name}” on this device`, () => {
        if (s.fx) { sound.tryEffect(s.fx); return; }
        if (trying === tid) stopTrying(); else audition(tid, s.scape!);
        drawAll();
      });
      const name = h('button', { class: 'sndName', 'aria-expanded': String(isOpen), label: `${s.name}: ${isOpen ? 'fewer' : 'more'} options` }, h('b', { text: s.name }), h('small', { text: meta(s) }));
      name.onclick = () => { open = isOpen ? null : id; confirming = null; drawList(true); };
      const head = h('div', { class: 'row' }, play, name);
      if (s.scape) {
        const here = amb() === tid;
        const use = h('button', { class: `sndUse${here ? ' on' : ''}`, text: here ? 'On this board' : 'Use here', label: here ? 'Playing on this board: tap for silence' : 'Use on this board', 'aria-pressed': String(here), 'data-use': id });
        use.onclick = () => { setAtmo(app.store, 'amb', here ? 'off' : tid); drawList(true); };
        head.append(use);
      }
      row.append(head);
      const said = note(rowNotes.get(id) ?? null);
      if (said) row.append(said);
      if (isOpen) {
        const more = h('div', { class: 'sndMore' });
        const input = h('input', { value: s.name, maxLength: MAX_SOUND_NAME, 'aria-label': 'Name', enterKeyHint: 'done', autocomplete: 'off' });
        input.onchange = () => { const n = input.value.trim(); if (n && n !== s.name) change(id, s, { name: n, ...(s.scape && { scape: { ...s.scape, name: n } }) }); else input.value = s.name; };
        input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
        more.append(input);
        if (s.fx) more.append(asSelect(s.as ?? '', (as) => change(id, s, { as })));
        if (file) {
          const cur = s.scape?.gain ?? s.fx?.gain ?? 1;
          const vol = slider('Volume', cur, () => {}, `Volume of ${s.name}`), range = vol.querySelector('input')!;
          range.onchange = () => change(id, s, s.scape ? { scape: { ...s.scape, gain: +range.value } } : { fx: { ...s.fx!, gain: +range.value } });
          more.append(vol);
        }
        if (s.scape?.file) {
          const loops = s.scape.loop !== false;
          const loop = h('button', { class: loops ? 'on' : '', text: loops ? 'Loops: on' : 'Loops: off — plays once', 'aria-pressed': String(loops) });
          loop.onclick = () => change(id, s, { scape: { ...s.scape!, loop: !loops } });
          more.append(loop);
        }
        if (s.mix) {
          const edit = h('button', { text: 'Open in the mixer' });
          edit.onclick = () => { mixer.picks = s.mix!.map((p) => ({ ...p })); mixer.name = s.name; mixer.editing = id; mixer.note = null; drawMixer(); parts.mix.scrollIntoView({ block: 'start' }); };
          more.append(edit);
        }
        if (file) {
          // Where the recording is: on servers (anyone can fetch it, any time), or only on the devices that have played it.
          const on = decodeRef(file)?.s ?? [];
          const where = h('p', { class: 'hint', text: on.length ? `On ${on.map(host).join(', ')}: players can fetch it at any time.` : 'On no server: players get it from a device at the table that has it (yours, while you are here).' });
          more.append(where);
          if (!on.length) {
            const again = h('button', { text: retrying === id ? 'Offering it…' : 'Offer it to the servers again', disabled: retrying === id, 'data-retry': id });
            again.onclick = () => void retry(id, s, file);
            more.append(again);
          }
        }
        if (confirming === id) {
          const yes = h('button', { class: 'danger', text: 'Remove', 'data-yes': id }), no = h('button', { text: 'Keep it' });
          yes.onclick = () => {
            if (trying === tid) stopTrying();
            if (amb() === tid) setAtmo(app.store, 'amb', 'off'); // silence by choice, not by a name nobody knows
            if (mixer.editing === id) mixer.editing = null;
            confirming = open = null;
            rowNotes.delete(id);
            ts.remove(id);
            drawAll();
          };
          no.onclick = () => { confirming = null; drawList(true); };
          more.append(h('p', { class: 'sndMsg bad', role: 'alert', text: `Remove “${s.name}” from the table, for everyone?` }), h('div', { class: 'row two' }, yes, no));
        } else {
          const del = h('button', { html: `${ico('trash')}Remove`, 'data-remove': id });
          del.onclick = () => { confirming = id; drawList(true); };
          more.append(del);
        }
        row.append(more);
      }
      el.append(row);
    }
  }
  async function retry(id: string, s: TableSound, file: string): Promise<void> {
    retrying = id;
    drawList(true);
    let outcomes: ServerOutcome[] = [];
    const ref = await ts.reupload(file, (o) => { outcomes = o; });
    retrying = null;
    const took = decodeRef(ref)?.s?.length ?? 0;
    rowNotes.set(id, !ref ? { text: 'The recording is not on this device any more, so it cannot be offered from here.', bad: true }
      : { text: took ? 'A server has it now.' : outcomes.length ? 'No server took it this time.' : 'This table has no file servers set.', bad: !took, lines: outcomeLines(outcomes) });
    const cur = ts.get(id);
    if (ref && took && cur) ts.save(id, cur.scape ? { ...cur, scape: { ...cur.scape, file: ref } } : { ...cur, fx: { ...cur.fx!, file: ref } });
    drawList(true);
  }

  // ---- add a recording ----
  const picker = h('input', { type: 'file', accept: 'audio/*', hidden: true, id: 'sndFile' });
  picker.setAttribute('aria-label', 'A sound file');
  let picking: SoundKind = 'ambience';
  picker.onchange = () => { const f = picker.files?.[0]; picker.value = ''; if (f) void take(f, picking); };
  function pick(kind: SoundKind, mic: boolean): void {
    picking = kind;
    if (mic) picker.setAttribute('capture', ''); else picker.removeAttribute('capture');
    picker.click();
  }
  const refuse = (text: string) => { importNote = { text, bad: true }; probing = false; drawAdd(); };

  /** A file was chosen: is it a sound, does it fit? Then it becomes the draft, to be named and tried before it is uploaded. */
  async function take(file: File, kind: SoundKind): Promise<void> {
    dropDraft();
    importNote = null;
    probing = true;
    drawAdd();
    const effect = kind === 'effect', budget = budgetOf(kind);
    const format = soundFormat(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    if (!format) return refuse('That is not a sound file the table can take. Use an MP3, M4A or WAV file.');
    if (!new Audio().canPlayType(format.probe) && !new Audio().canPlayType(format.mime)) return refuse(`This device cannot play ${format.name} files, so it cannot add one. Use an MP3, M4A or WAV file.`);
    // A WAV effect that is too heavy may still be made to fit; anything else over its budget is refused before more work is done.
    const mayShrink = effect && format.id === 'wav' && file.size <= 8 * 1024 * 1024;
    if (file.size > budget.bytes && !mayShrink) return refuse(checkBudget(kind, file.size, null)!);
    let seconds: number;
    try { seconds = await probeDuration(file); } catch { return refuse('This device could not read that file. Is it a sound file? MP3, M4A and WAV work everywhere.'); }
    const long = checkBudget(kind, 0, seconds);
    if (long) return refuse(long);
    let blob: Blob = file;
    const notes: string[] = [];
    if (file.size > budget.bytes) {
      const small = shrinkWav(new Uint8Array(await file.arrayBuffer()), budget.bytes);
      if (!small) return refuse(checkBudget(kind, file.size, seconds)!);
      blob = new Blob([small.bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
      notes.push(`It was ${fmtBytes(file.size)}, too heavy for an effect, so it was made smaller: one channel at ${Math.round(small.rate / 1000)} kHz, ${fmtBytes(small.bytes.length)}. Try it: if it sounds too dull, use a shorter clip or an MP3.`);
    }
    if (format.warn) notes.push(format.warn);
    const name = file.name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, MAX_SOUND_NAME) || (effect ? 'Effect' : 'Recording');
    draft = { kind, file: blob, mime: format.mime, format, seconds, fileName: file.name, name, loop: !effect, gain: 0.8, as: '', local: ts.local(blob), notes };
    probing = false;
    drawAdd();
  }
  const draftScape = (d: Draft): Scape => ({ name: d.name || 'Recording', file: d.local, loop: d.loop, gain: d.gain });

  async function done(): Promise<void> {
    const d = draft;
    if (!d || d.busy) return;
    const name = d.name.trim();
    if (!name) { d.error = 'Give it a name first.'; drawAdd(); return; }
    if (trying === 'draft') stopTrying();
    d.busy = true;
    d.error = undefined;
    drawAdd();
    let outcomes: ServerOutcome[] = [], ref: string;
    try { ref = await ts.upload(new Uint8Array(await d.file.arrayBuffer()), d.mime, (o) => { outcomes = o; }); } catch {
      d.busy = false;
      d.error = 'The file could not be taken in on this device (is its storage full?). Tap Done to try again.';
      if (draft === d) drawAdd();
      return;
    }
    d.busy = false;
    const entry: TableSound = d.kind === 'effect'
      ? { v: 1, name, kind: 'effect', fx: { voices: [], file: ref, gain: d.gain }, ...(d.as && { as: d.as }) }
      : { v: 1, name, kind: d.kind, scape: { name, file: ref, loop: d.loop, gain: d.gain } };
    const why = ts.save(null, entry);
    if (why) { d.error = why; if (draft === d) drawAdd(); return; }
    const took = outcomes.filter((o) => o.ok).length;
    importNote = {
      text: `“${name}” is in the table’s sounds. ${took ? 'Players fetch it from the server when it plays.' : outcomes.length ? 'No server took it, so players get it straight from this device while it is at the table. You can offer it again from the list.' : 'This table has no file servers set, so players get it straight from this device while it is at the table.'}`,
      bad: !took && outcomes.length > 0, lines: outcomeLines(outcomes),
    };
    if (draft === d) dropDraft();
    drawAll();
  }

  function drawAdd(): void {
    const el = parts.add;
    el.innerHTML = '';
    el.append(h('h3', { text: 'Add a recording' }));
    const adds = h('div', { class: 'sndAdd' });
    const add = (kind: SoundKind, mic: boolean, label: string, hint: string, key: string) => {
      const b = h('button', { 'data-add': key, disabled: probing || !!draft?.busy }, h('b', { text: label }), h('small', { text: hint }));
      b.onclick = () => pick(kind, mic);
      adds.append(b);
    };
    add('ambience', false, 'Add music or ambience', `up to ${fmtTime(BUDGET.track.seconds)}, ${fmtBytes(BUDGET.track.bytes)}`, 'track');
    add('effect', false, 'Add an effect', `up to ${fmtTime(BUDGET.effect.seconds)}, ${fmtBytes(BUDGET.effect.bytes)}`, 'effect');
    // Phones that can hand the microphone to a file input: a growl or a door slam, recorded on the spot.
    if ('capture' in picker && matchMedia('(pointer: coarse)').matches) add('effect', true, 'Record an effect', 'with the microphone', 'mic');
    el.append(adds, picker);
    if (probing) el.append(h('p', { class: 'sndMsg', role: 'status', text: 'Reading the file…' }));
    const said = note(importNote);
    if (said) el.append(said);
    const d = draft;
    if (!d) { el.append(h('p', { class: 'hint', text: 'MP3, M4A and WAV play on every phone. Files are encrypted with the table code before they leave this device.' })); return; }
    const card = h('div', { class: 'sndCard', 'data-draft': d.kind });
    card.append(h('div', { class: 'sndName' }, h('b', { text: d.fileName }), h('small', { text: `${d.format.name} · ${fmtTime(d.seconds)} · ${fmtBytes(d.file.size)}` })));
    for (const n of d.notes) card.append(h('p', { class: 'sndMsg', text: n }));
    const name = h('input', { value: d.name, maxLength: MAX_SOUND_NAME, placeholder: 'Name', 'aria-label': 'Name', enterKeyHint: 'done', autocomplete: 'off', id: 'sndDraftName' });
    name.oninput = () => { d.name = name.value; };
    name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
    card.append(name);
    if (d.kind === 'effect') card.append(asSelect(d.as, (as) => { d.as = as; }));
    else {
      const kinds = h('div', { class: 'row two' });
      for (const k of ['ambience', 'music'] as const) {
        const b = h('button', { class: d.kind === k ? 'on' : '', text: KIND[k], 'aria-pressed': String(d.kind === k) });
        b.onclick = () => { d.kind = k; drawAdd(); };
        kinds.append(b);
      }
      const loop = h('button', { class: d.loop ? 'on' : '', text: d.loop ? 'Loops: on' : 'Loops: off — plays once', 'aria-pressed': String(d.loop), 'data-loop': '' });
      loop.onclick = () => { d.loop = !d.loop; if (trying === 'draft') audition('draft', draftScape(d)); drawAdd(); };
      card.append(kinds, loop);
    }
    const vol = slider('Volume', d.gain, (v) => { d.gain = v; });
    vol.querySelector('input')!.onchange = () => { if (trying === 'draft') audition('draft', draftScape(d)); };
    card.append(vol);
    const tryIt = h('button', { class: trying === 'draft' ? 'on' : '', html: trying === 'draft' ? `${STOP}Stop` : `${ico('play')}Try it`, disabled: !sound.enabled || !!d.busy, 'data-try': '' });
    tryIt.onclick = () => {
      if (d.kind === 'effect') { sound.tryEffect({ voices: [], file: d.local, gain: d.gain }); return; }
      if (trying === 'draft') stopTrying(); else audition('draft', draftScape(d));
      drawAll();
    };
    const ok = h('button', { class: 'primary', text: d.busy ? 'Sending…' : 'Done', disabled: !!d.busy, 'data-done': '' });
    ok.onclick = () => void done();
    const cancel = h('button', { text: 'Cancel', disabled: !!d.busy });
    cancel.onclick = () => { dropDraft(); importNote = null; drawAll(); };
    card.append(h('div', { class: 'row three' }, tryIt, ok, cancel));
    if (d.busy) card.append(h('progress', { 'aria-label': 'Encrypting and sending the file' }), h('p', { class: 'hint', role: 'status', text: 'Encrypting the file and offering it to the file servers…' }));
    if (d.error) card.append(h('p', { class: 'sndMsg bad', role: 'alert', text: d.error }));
    else if (!d.busy) card.append(h('p', { class: 'hint', text: 'Try it plays on this device only. Done puts it in the table’s sounds for everyone.' }));
    el.append(card);
  }

  // ---- the mixer ----
  let remix: ReturnType<typeof setTimeout> | undefined;
  const mixed = () => mixRecipe(mixer.name || 'Mix', mixer.picks, presets);
  /** A slider moved while the mix is sounding: let the fingers settle, then play it as it is now. */
  function mixChanged(): void {
    clearTimeout(remix);
    if (trying !== 'mix') return;
    remix = setTimeout(() => { if (trying === 'mix') { const r = mixed(); if (r) audition('mix', r); else { stopTrying(); drawMixer(); } } }, 220);
  }
  function drawMixer(): void {
    const el = parts.mix;
    el.innerHTML = '';
    el.append(h('h3', { text: mixer.editing ? `Mix a soundscape — changing “${ts.get(mixer.editing)?.name ?? mixer.name}”` : 'Mix a soundscape' }));
    if (!presets.length) { el.append(h('p', { class: 'hint', text: 'The mixer’s sounds have not loaded.' })); return; }
    el.append(h('p', { class: 'hint', text: `No files needed: layer up to ${MAX_MIX} of these, and set each one’s volume and tone.` }));
    const chips = h('div', { class: 'sndChips' });
    for (const p of presets) {
      const on = mixer.picks.some((q) => q.id === p.id);
      const b = h('button', { class: `chip${on ? ' on' : ''}`, text: `${p.icon} ${p.name}`.trim(), 'aria-pressed': String(on), 'data-mix': p.id, disabled: !on && mixer.picks.length >= MAX_MIX });
      b.onclick = () => {
        mixer.picks = on ? mixer.picks.filter((q) => q.id !== p.id) : [...mixer.picks, { id: p.id, vol: 0.5, tone: 0.5 }];
        mixer.note = null;
        if (trying === 'mix') { const r = mixed(); if (r) audition('mix', r); else stopTrying(); }
        drawMixer();
      };
      chips.append(b);
    }
    el.append(chips);
    for (const pick of mixer.picks) {
      const p = presets.find((q) => q.id === pick.id);
      if (!p) continue;
      el.append(h('div', { class: 'sndLayer', 'data-layer': p.id }, h('b', { text: `${p.icon} ${p.name}`.trim() }),
        slider('Volume', pick.vol, (v) => { pick.vol = v; mixChanged(); }, `${p.name}: volume`),
        slider('Tone', pick.tone, (v) => { pick.tone = v; mixChanged(); }, `${p.name}: tone, low to high`)));
    }
    if (mixer.picks.length) {
      const listen = h('button', { class: trying === 'mix' ? 'on' : '', html: trying === 'mix' ? `${STOP}Stop` : `${ico('play')}Listen`, disabled: !sound.enabled, 'data-listen': '' });
      listen.onclick = () => {
        const r = mixed();
        if (trying === 'mix' || !r) stopTrying(); else audition('mix', r);
        drawAll();
      };
      const name = h('input', { value: mixer.name, maxLength: MAX_SOUND_NAME, placeholder: 'Name it', 'aria-label': 'Name of the soundscape', enterKeyHint: 'done', autocomplete: 'off', id: 'sndMixName' });
      name.oninput = () => { mixer.name = name.value; };
      name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
      const save = h('button', { class: 'primary', text: mixer.editing ? 'Save changes' : 'Save to the table', 'data-save': '' });
      save.onclick = () => {
        const n = mixer.name.trim(), r = n ? mixRecipe(n, mixer.picks, presets) : null;
        if (!n) { mixer.note = { text: 'Give it a name first.', bad: true }; drawMixer(); return; }
        if (!r) { mixer.note = { text: 'Nothing in this mix makes a sound: turn a volume up.', bad: true }; drawMixer(); return; }
        const id = mixer.editing && ts.get(mixer.editing) ? mixer.editing : null;
        const why = ts.save(id, { v: 1, name: n, kind: ts.get(id ?? '')?.kind ?? 'ambience', scape: r, mix: mixer.picks.map((p) => ({ ...p })) });
        if (why) { mixer.note = { text: why, bad: true }; drawMixer(); return; }
        if (trying === 'mix') stopTrying();
        mixer.note = { text: `“${n}” is in the table’s sounds. Tap “Use here” on it to play it on this board.` };
        mixer.picks = [];
        mixer.name = '';
        mixer.editing = null;
        drawAll();
      };
      const row = h('div', { class: 'row two' }, listen, save);
      if (mixer.editing) {
        const cancel = h('button', { text: 'Cancel' });
        cancel.onclick = () => { if (trying === 'mix') stopTrying(); mixer.picks = []; mixer.name = ''; mixer.editing = null; drawAll(); };
        row.append(cancel);
        row.className = 'row three';
      }
      el.append(name, row);
    }
    const said = note(mixer.note);
    if (said) el.append(said);
  }

  function drawNotice(): void {
    parts.notice.innerHTML = '';
    if (sound.enabled) return;
    const on = h('button', { text: 'Turn sound on', 'data-soundon': '' });
    on.onclick = () => { app.soundOn(); drawAll(); };
    parts.notice.append(h('div', { class: 'sndMsg sndOff' }, h('span', { text: 'Sound is off on this device, so you cannot try anything here.' }), on));
  }
  function drawAll(): void {
    if (!root?.isConnected) return;
    drawNotice();
    drawList(true);
    drawAdd();
    drawMixer();
  }

  // The engine stopped or started something by itself (sound switched off, the tab hidden): the buttons follow.
  sound.onState = () => {
    renderSoundState(ts);
    if (trying && sound.playing !== 'trial' && !(trial && sound.auditioning(trial))) { trying = null; trial = null; }
    if (root?.isConnected) { drawNotice(); drawList(); }
  };
  void fetch('./sounds/mixer.json').then((r) => r.json()).then((raw) => { presets = parseMixPresets(raw); if (root?.isConnected) drawMixer(); }).catch(() => {});

  registerPrepPage({
    id: 'sound', title: 'Sound', icon: 'sound', order: 50, hint: 'Music, ambience, effects and a mixer',
    render(el) {
      root = h('div', { class: 'snd' }, parts.notice, parts.list, parts.add, parts.mix);
      el.append(root);
      listSig = '';
      drawAll();
      // Leaving the page (Back, or Prep closing) ends whatever was being tried: the table's own soundscape comes back.
      const mine = root, watch = new MutationObserver(() => {
        if (mine.isConnected) return;
        watch.disconnect();
        if (root === mine) { root = null; stopTrying(); }
      });
      watch.observe(el, { childList: true });
    },
    update() { if (root?.isConnected) { drawNotice(); drawList(); } },
  });
}
