// The table screen: a TV or tablet lying on the table, showing the scene to everyone around it.
// It is a seat of its own kind. It has no chrome (nobody holds it), it changes nothing (not
// even on a table without a GM), and it sees what the party sees: fog as the players have it,
// no hidden mini, and with line of sight on, whatever any player's mini can see (`PARTY`,
// src/rules.ts). It follows the table to its active board and the camera to whose turn it is.
//
// Two halves live here. `showDisplay` is the screen itself, opened by a link
// (`?ui=2&display=1#room=…`): no lobby, no name asked. The rest is the GM's side, in the Table
// drawer's People section: the link (to copy, share or scan), and "Show this on the table
// screen", which sends the GM's camera for screens to glide to (the live message `cam`; only a
// GM's is taken up, and only by a screen). "Follow me" sends it as the GM looks around.
//
// A screen says what it is with every hello (`d` in `hi`, `Peer.disp` in src/net.ts), so it is
// listed as a table screen and never as a player: nobody can make it a mini's owner. The flag
// costs one small field; telling screens by a reserved name would let any player take it.

import './display.css';
import { MINIS } from '../catalog';
import { qr } from '../qr';
import * as registry from '../registry';
import { turnOrder, type Turn } from '../rules';
import { esc, startSession, type Session } from '../session';
import type { Ctx } from './buildSheets';
import { btn, h } from './dom';
import { mountSystem } from './sheet';

export const SCREEN_NAME = 'Table screen';
/** A screen is nobody's colour. */
const SCREEN_COLOR = '#8b8d98';
/** With "Follow me" on, the GM's camera is sent at most this often, and only while it moves. */
const FOLLOW_MS = 250;

/** The link that opens a table as its screen: the invite, with `display=1` (and the new chrome, which the screen is part of). */
export function screenLink(invite: string): string {
  const u = new URL(invite);
  u.searchParams.set('ui', '2');
  u.searchParams.set('display', '1');
  return u.href;
}

// ---- the screen itself ------------------------------------------------------------

export async function showDisplay(code: string, relays: string[]): Promise<void> {
  // Of the old chrome only the roll toast is shown; the sheet stays (closed) because sheet rolls are read by it.
  const hud = document.getElementById('hud')!;
  for (const kid of [...hud.children]) if (!['sheet', 'rules', 'toast'].includes(kid.id)) kid.remove();
  hud.hidden = false;
  document.getElementById('lobby')!.hidden = true;
  document.body.classList.add('display', 'player');
  const banner = h('div', { class: 'banner', role: 'status', hidden: true });
  const root = h('div', { id: 'app' }, banner);
  document.body.append(root);

  let ready = false, toastTimer: ReturnType<typeof setTimeout>, drawn = '';
  const s: Session = await startSession({
    canvas: document.getElementById('c') as HTMLCanvasElement, name: SCREEN_NAME, code, relays, color: SCREEN_COLOR, display: true,
    hooks: {
      notice: () => {}, log: () => {}, grabbed: () => {}, // lines for whoever holds the phone: nobody holds this one
      rolled: (shown, by) => {
        const t = document.getElementById('toast')!;
        t.innerHTML = `<big>${shown}</big>${by}`;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
      },
      changed: () => { if (ready) render(); },
    },
  });
  s.attachRules(mountSystem({ store: s.store, net: s.net, board: s.board, me: s.meId, pk: s.me, here: s.here, say: () => {}, send: s.send, openSheet: () => {}, hold: s.hold, secret: s.secretRoll }));

  /** Whose turn it is, large enough to read from a chair: "Round 2 · Greyback". A mini the party cannot see is not named. */
  function render(): void {
    const turn = s.store.get<Turn>('turn'), cur = turn && turnOrder(s.store).find((o) => o.id === turn.id);
    const html = cur ? `<i style="background:${s.shown(cur.v) ? esc(cur.v.c) : 'transparent'}"></i>Round ${Math.round(Number(turn.round)) || 1}${s.shown(cur.v) ? ` · <b>${esc(cur.v.n || MINIS[cur.v.k]?.name || 'Figure')}</b>` : ''}` : '';
    if (html === drawn) return;
    drawn = html;
    banner.hidden = !html;
    banner.innerHTML = html;
  }
  ready = true;
  s.touch();
  render();
  Object.assign(window, { __ct: { store: s.store, net: s.net, board: s.board, sound: s.sound, session: s, blobs: s.blobs, packs: s.packs, sounds: s.tableSounds, registry } });
}

// ---- the GM's side: Table → People ---------------------------------------------------

let open = false, following = false, sendTimer: ReturnType<typeof setTimeout> | undefined;

/** Send the GM's view as the camera moves: nothing while it is still, and never more than four a second. */
function follow(s: Session, on: boolean): void {
  following = on;
  s.board.onCamera = on ? () => {
    sendTimer ??= setTimeout(() => {
      sendTimer = undefined;
      if (following && s.screens().length) s.showView();
    }, FOLLOW_MS);
  } : () => {};
  if (on) s.showView();
}

/** The code as a picture: one canvas pixel a square, scaled up by CSS, with the light margin a camera needs. */
function qrCanvas(text: string): HTMLCanvasElement | null {
  const grid = qr(text), edge = 4;
  if (!grid) return null;
  const n = grid.length + edge * 2, c = h('canvas', { class: 'qr', width: n, height: n, role: 'img', 'aria-label': 'QR code of the table screen link' });
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, n, n);
  g.fillStyle = '#000';
  grid.forEach((row, y) => row.forEach((dark, x) => { if (dark) g.fillRect(x + edge, y + edge, 1, 1); }));
  return c;
}

/** The table screens that are here, for the People list: named as what they are, not as players. */
export function screenChips(s: Session): HTMLElement[] {
  return s.screens().map(() => h('span', { class: 'person screen', text: SCREEN_NAME }));
}

/** Table → People, for whoever runs the table: how to put it on a screen, and what that screen shows. */
export function screenSection({ s, drawer, notice }: Ctx): HTMLElement[] {
  if (!s.full()) return [];
  const link = screenLink(s.invite), here = s.screens().length > 0, gm = s.amGM();
  if (following && !(gm && here)) follow(s, false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); notice.say('Link copied. Open it on the screen on the table.'); }
    catch { notice.say('Could not copy the link. It is written out here.'); }
  };
  const share = async () => { try { await navigator.share({ title: 'Cottontale', text: 'Table screen', url: link }); } catch { /* put away again */ } };
  return [
    h('div', { class: 'chips' },
      btn('Table screen', () => { open = !open; drawer.redraw(); }, { icon: 'map', on: open, title: 'Show the table on a TV or tablet' }),
      here && gm && btn('Show this on the table screen', () => { s.showView(); drawer.close(); notice.say('The table screen is going to your view.'); }, { icon: 'eye' }),
      here && gm && btn(`Follow me: ${following ? 'on' : 'off'}`, () => { follow(s, !following); drawer.redraw(); }, { icon: 'move', on: following, title: 'The table screen looks where you look' }),
    ),
    here && !gm ? h('p', { class: 'hint', text: 'Become the GM to show the table screen your view.' }) : null,
    open ? h('div', { class: 'screenlink' },
      qrCanvas(link),
      h('p', { class: 'url', text: link }),
      h('div', { class: 'chips' }, btn('Copy link', () => void copy(), { icon: 'copy' }), !!navigator.share && btn('Share', () => void share(), { icon: 'link' })),
      h('p', { class: 'hint', text: 'Open this link on a TV or tablet on the table, or scan it. The screen shows what the party sees: no hidden figures, nothing to tap. It follows the turns, and your view when you send it.' }),
    ) : null,
  ].filter((el): el is HTMLDivElement | HTMLParagraphElement => !!el);
}
