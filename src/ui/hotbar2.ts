// The hotbar of the new chrome: while a brush is in hand, one slim row of pictures just above
// the dock (a short column beside the rail on a phone held sideways) — the pinned pieces, then
// the ones used last. A tap takes one in hand. It is not a second dock row: no labels, and it
// is only there while it is useful — gone when the brush is put down, when a drawer is open,
// and when there is nothing to show. What it shows is decided in ui/library.ts (`hotbarKeys`).

import './hotbar2.css';
import * as registry from '../registry';
import { armKey, favourites, recents, type Ctx } from './buildSheets';
import { esc, h } from './dom';
import { face, nameOf } from './face';
import { hotbarKeys, steady } from './library';

export interface Hotbar { render(): void; el: HTMLElement }

export function mountHotbar(root: HTMLElement, { s, drawer }: Ctx): Hotbar {
  const el = h('div', { class: 'hotbar', role: 'toolbar', 'aria-label': 'Pinned and recent pieces', hidden: true });
  root.append(el);
  el.onclick = (e) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>('button[data-key]')?.dataset.key;
    if (key) armKey(s, key);
  };

  let shown: readonly string[] = [], drawn = '';
  function render(): void {
    const keys = s.armed() && drawer.id === null ? hotbarKeys(favourites(), recents(), (k) => nameOf(k) !== null) : [];
    el.hidden = !keys.length;
    if (!keys.length) { shown = []; return; }
    // Taking a piece from the row makes it the most recent one: the row keeps its order all the same, so nothing moves under the thumb.
    shown = steady(shown, keys);
    const hand = s.inHand().key, pinned = new Set(favourites());
    const html = shown.map((k) => {
      const name = esc(nameOf(k)!);
      return `<button type="button" data-key="${esc(k)}" class="hb${k === hand ? ' on' : ''}${pinned.has(k) ? ' fav' : ''}" title="${name}" aria-label="${name}" aria-pressed="${k === hand}">${face(k)}</button>`;
    }).join('');
    if (html === drawn) return;
    drawn = html;
    el.innerHTML = html;
    // The piece in hand is in view (the row scrolls sideways, the column up and down).
    const on = el.querySelector<HTMLElement>('.on');
    if (!on) return;
    if (on.offsetLeft < el.scrollLeft || on.offsetLeft + on.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = on.offsetLeft - 2;
    if (on.offsetTop < el.scrollTop || on.offsetTop + on.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = on.offsetTop - 2;
  }
  // Packs come and go, and their pictures arrive late.
  registry.onRegistry(render);
  s.packs.onPacks(render);
  return { render, el };
}
