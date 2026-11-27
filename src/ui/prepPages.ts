// The pages Prep starts with. Theme is real: a gallery of the themes on offer. The others
// say what will live there until the module that owns them registers a page with the same id
// (registerPrepPage replaces by id, so nothing here needs to change when they arrive).

import type { GameTheme } from '../theme';
import { registerPrepPage, type PrepCtx } from './prep';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One line about a theme's mood, in words. */
function mood(t: GameTheme): string {
  return [cap(t.mood.sky), cap(t.mood.season), t.mood.amb !== 'off' ? cap(t.mood.amb) : ''].filter(Boolean).join(' · ');
}

/** The themes as large cards. Tapping one is exactly tapping it in the Atmosphere sheet (`app.pickTheme`). */
function themes(el: HTMLElement, { app }: PrepCtx): void {
  const at = el.scrollTop, cur = app.theme()?.id, offered = app.themes();
  const held = el.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.theme : undefined;
  el.innerHTML = '';
  const cards = document.createElement('div');
  cards.className = 'cards';
  for (const t of offered) {
    const b = document.createElement('button'), n = t.pieces.blocks.length + t.pieces.props.length + t.pieces.minis.length;
    b.className = `card sky-${t.mood.sky}`;
    b.dataset.theme = t.id;
    b.innerHTML = '<big></big><b></b><small></small><small></small>';
    const [icon, name, line, count] = b.children;
    icon.textContent = t.icon;
    name.textContent = t.name;
    line.textContent = mood(t);
    count.textContent = t.id === cur ? 'On the table — tap to let go' : `${n} piece${n === 1 ? '' : 's'} to the front`;
    b.classList.toggle('on', t.id === cur);
    b.setAttribute('aria-pressed', String(t.id === cur));
    b.disabled = !app.full();
    b.onclick = () => app.pickTheme(t);
    cards.append(b);
    if (t.id === held) setTimeout(() => b.focus({ preventScroll: true })); // drawn again under the finger that tapped it
  }
  if (offered.length) el.append(cards);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = offered.length
    ? 'A theme sets the sky, season, firelight and soundscape in one tap, and brings its pieces to the front of the library. Letting go of it keeps the mood.'
    : 'No themes on offer here.';
  el.append(hint);
  el.scrollTop = at;
}

/** A page that is not built yet: what it is for, so the list already reads as the plan. */
function soon(icon: string, text: string): (el: HTMLElement) => void {
  return (el) => {
    const box = document.createElement('div');
    box.className = 'soon';
    box.innerHTML = `<svg><use href="#i-${icon}"/></svg><p></p><p class="hint">Not here yet.</p>`;
    box.querySelector('p')!.textContent = text;
    el.append(box);
  };
}

export function registerBuiltinPrepPages(): void {
  registerPrepPage({ id: 'theme', title: 'Theme', icon: 'moon', order: 10, hint: 'The mood, and the pieces up front', render: themes, update: themes });
  registerPrepPage({ id: 'packs', title: 'Packs', icon: 'cube', order: 20, hint: 'Extra pieces for the library', render: soon('cube', 'Packs of extra blocks, things and figures: see what this table has, add more, and take them away again.') });
  registerPrepPage({ id: 'import', title: 'Import', icon: 'open', order: 30, hint: 'Bring in tables, maps and models', render: soon('open', 'Bring things in from files: whole tables, scenes, and models of your own for the library.') });
  registerPrepPage({ id: 'rules', title: 'Rules', icon: 'list', order: 40, hint: 'The game system and its character sheets', render: soon('list', 'Choose the game this table plays: its dice, its stats and the character sheets the figures carry.') });
  registerPrepPage({ id: 'sound', title: 'Sound', icon: 'sound', order: 50, hint: 'Soundscapes and effects', render: soon('sound', 'The soundscapes and effects this table can play, and how loud.') });
}
