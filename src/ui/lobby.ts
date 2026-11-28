// The lobby of the new chrome (`?ui=2`): who you are, and which table. Plain words, one
// decision a screen. Opened from an invite link there is nothing to decide: a name, a colour,
// Join. Otherwise there are two things to do, start a table or join one, and the table this
// device sat at last is one tap away. What only a few people ever need (the table's code, the
// relays that carry it) is folded away under Advanced. Whoever starts a table is its GM (app.ts).

import './lobby.css';
import { PLAYER_COLORS } from '../catalog';
import { DEFAULT_RELAYS } from '../net';
import { btn, h } from './dom';

const ls = {
  get: (k: string) => { try { return localStorage.getItem(`cottontale:${k}`); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`cottontale:${k}`, v); } catch { /* storage full or blocked */ } },
};

/** A table code nobody will guess: it is also the key the table is encrypted with. */
export function randomCode(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(12));
  return [...r].map((b, i) => (i && i % 4 === 0 ? '-' : '') + abc[b % abc.length]).join('');
}
/** What somebody pasted to join: an invite link (its code, and the relays it names), or the bare code. */
export function readInvite(text: string): { code: string; relays?: string[] } {
  const t = text.trim(), at = t.indexOf('#');
  const p = new URLSearchParams(at >= 0 ? t.slice(at + 1) : /^room=/.test(t) ? t : '');
  const room = p.get('room')?.trim();
  if (room) return { code: room, relays: p.get('relays')?.split(',') };
  return { code: /^https?:\/\//i.test(t) ? '' : t }; // a link that is no invite is no code either
}
/** The relays in a list somebody typed or a link brought: only what could be one. */
export const readRelays = (text: string): string[] => text.split(/[\s,]+/).filter((r) => /^wss?:\/\/\S+$/.test(r)).slice(0, 12);
export const MIN_CODE = 6;

type Step = 'home' | 'join' | 'invite';

export function mountLobby(): void {
  // The old form steps aside, and gives up its ids: there is one name field and one Join button.
  const old = document.getElementById('lobby')!;
  old.hidden = true;
  old.replaceChildren();

  const hash = new URLSearchParams(location.hash.slice(1));
  const invited = hash.get('room')?.trim() ?? '', last = ls.get('lastRoom') ?? '';
  let step: Step = invited ? 'invite' : 'home', busy = false;
  let color = ls.get('color') ?? PLAYER_COLORS[Math.floor(Math.random() * 8)];
  let relayText = '';
  try { relayText = (hash.get('relays')?.split(',') ?? (JSON.parse(ls.get('relays') ?? 'null') as string[] | null) ?? DEFAULT_RELAYS).join('\n'); } catch { relayText = DEFAULT_RELAYS.join('\n'); }
  let startCode = randomCode(), pasted = '';

  const title = h('h1'), sub = h('p', { class: 'sub' }), err = h('p', { class: 'err', role: 'alert' });
  const name = h('input', { id: 'name', maxlength: 24, placeholder: 'e.g. Dad the Dungeon Master', enterkeyhint: 'go', autocomplete: 'off', value: ls.get('name') ?? '', oninput: () => fail('') });
  const colors = h('span', { class: 'swatches', role: 'group', 'aria-label': 'Your colour' });
  const acts = h('div', { class: 'acts' });
  const el = h('form', { id: 'welcome', class: 'panel', autocomplete: 'off', novalidate: true },
    h('header', {}, title, sub),
    h('div', { class: 'me' }, h('label', {}, 'Your name', name), h('div', { class: 'field' }, h('span', { text: 'Your colour' }), colors)),
    acts, err,
  );

  function paint(): void {
    colors.replaceChildren(...PLAYER_COLORS.map((c) => h('button', { type: 'button', class: c === color ? 'on' : '', style: `--c:${c}`, 'aria-label': `Colour ${c}`, 'aria-pressed': String(c === color), onclick: () => { color = c; paint(); } })));
  }
  function fail(text: string, at?: HTMLElement): void {
    err.textContent = text;
    at?.focus();
  }

  /** Sit down: remember who and where, and hand over to the table (src/app.ts). */
  function go(code: string, started: boolean, relays = readRelays(relayText)): void {
    if (busy) return;
    const who = name.value.trim();
    if (!who) return fail('First, a name for the others to see.', name);
    const fold = acts.querySelector('details');
    if (code.length < MIN_CODE) {
      if (fold) fold.open = true;
      return fail(step === 'home' ? `A table code has at least ${MIN_CODE} characters.` : 'That is not a table code or an invite link.', acts.querySelector<HTMLElement>('#lbPaste, #lbCode') ?? undefined);
    }
    if (!relays.length) {
      if (fold) fold.open = true;
      return fail('The table needs at least one relay to reach the others (Advanced).', acts.querySelector<HTMLElement>('#lbRelays') ?? undefined);
    }
    ls.set('name', who);
    ls.set('color', color);
    ls.set('lastRoom', code);
    ls.set('relays', JSON.stringify(relays));
    busy = true;
    fail('');
    for (const b of el.querySelectorAll('button')) b.disabled = true;
    const main = acts.querySelector('.primary');
    if (main) main.textContent = 'Opening the table…';
    void import('../app').then((m) => m.play(who, code, relays, color, { started })).then(() => el.remove(), (e) => {
      console.error(e);
      busy = false;
      paint();
      render();
      fail('The table would not open. Try again.');
    });
  }

  function render(): void {
    el.dataset.step = step;
    title.textContent = step === 'home' ? '🐇 Cottontale' : step === 'join' ? 'Join a table' : 'Join the table';
    sub.textContent = step === 'home' ? 'A little 3D tabletop for family adventures.' : step === 'join' ? 'Paste the code or the link you were sent.' : 'You are invited. Say who you are and sit down.';
    acts.replaceChildren();
    if (step === 'invite') {
      acts.append(h('button', { id: 'join', class: 'primary', text: 'Join' }));
    } else if (step === 'join') {
      const paste = h('input', { id: 'lbPaste', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', enterkeyhint: 'go', placeholder: 'Table code or invite link', 'aria-label': 'Table code or invite link', value: pasted, oninput: () => { pasted = paste.value; fail(''); } });
      acts.append(paste, h('button', { id: 'join', class: 'primary', text: 'Join' }), btn('Back', () => { step = 'home'; fail(''); render(); }, { icon: 'back' }));
    } else {
      const code = h('input', { id: 'lbCode', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Table code', value: startCode, oninput: () => { startCode = code.value.trim(); fail(''); } });
      const relays = h('textarea', { id: 'lbRelays', rows: 3, spellcheck: 'false', 'aria-label': 'Relays', oninput: () => { relayText = relays.value; fail(''); } });
      relays.value = relayText;
      const back = last ? btn('Back to your table', () => go(last, false), { icon: 'door', title: 'The table this device sat at last' }) : null;
      if (back) back.id = 'lbBack';
      if (back) acts.append(back);
      acts.append(
        h('button', { id: 'lbStart', class: 'primary', text: 'Start a table' }),
        btn('Join a table', () => { step = 'join'; fail(''); render(); }, { icon: 'link' }),
        h('details', {}, h('summary', { text: 'Advanced' }),
          h('label', {}, 'Table code', h('span', { class: 'row' }, code, btn('🎲', () => { code.value = startCode = randomCode(); }, { title: 'Another random code' }))),
          h('p', { class: 'hint', text: 'A new table gets a fresh code. Whoever has it can sit down, so pass it on only as an invite.' }),
          h('label', {}, 'Relays', relays),
          h('p', { class: 'hint', text: 'The servers that pass the table between its players (Nostr relays). Everything they carry is encrypted with the table code.' }),
        ),
      );
    }
  }
  // The form's own action (its primary button, or Go on the keyboard) is the step's one decision.
  el.onsubmit = (e) => {
    e.preventDefault();
    if (step === 'invite') return go(invited, false);
    if (step === 'home') return go(startCode, true);
    const inv = readInvite(pasted), given = inv.relays && readRelays(inv.relays.join(','));
    go(inv.code, false, given?.length ? given : undefined);
  };

  paint();
  render();
  document.body.append(el);
}
