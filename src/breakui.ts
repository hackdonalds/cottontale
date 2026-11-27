// The Break button: it appears over a wall, door or thing the GM has tapped in play, and
// follows the piece as the camera moves. A second, deliberate tap does the breaking, so a
// stray touch on the scenery never costs a wall.
import type { Board } from './board';

export function breakButton(board: Board, hud: HTMLElement, roof: HTMLElement, tell: (key: string, id: string) => void, crumble: (wood: boolean) => void): void {
  const b = document.createElement('button');
  b.id = 'break';
  b.title = 'Break it';
  b.setAttribute('aria-label', 'Break it');
  b.innerHTML = '<span>🔨</span>Break';
  b.hidden = true;
  b.onclick = () => { navigator.vibrate?.(20); board.breakOffered(); };
  hud.append(b);
  board.onBreak = tell;
  board.onCrumble = crumble;
  board.onOffer = (key) => {
    const spot = key ? board.offerSpot() : null;
    b.hidden = !spot;
    if (!spot) return;
    // Above the piece, and never under the top bar or off an edge.
    const w = b.offsetWidth / 2 + 8, top = roof.getBoundingClientRect().bottom + 8 + b.offsetHeight;
    const x = Math.max(w, Math.min(innerWidth - w, spot.x)), y = Math.max(top, Math.min(innerHeight - 8, spot.y - 6));
    b.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
  };
}
