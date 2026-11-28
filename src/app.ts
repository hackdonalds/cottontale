// The new chrome (the redesign, behind `?ui=2` until it takes over from main.ts): a session
// (src/session.ts) with the dock, notices and pages of src/ui on top. This file only wires
// them together; what each part does lives in its own module.

import './ui/shell.css';
import { startSession, type Session } from './session';
import { mountDock, type Dock } from './ui/dock';
import { mountNotice } from './ui/notice';

export async function play(name: string, code: string, relays: string[], color: string): Promise<void> {
  document.getElementById('hud')?.remove(); // the old chrome: its ids are free for the pages that are reused
  const root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
  const notice = mountNotice(root);
  let dock: Dock | undefined;
  const plain = (html: string) => html.replace(/<[^>]+>/g, '');
  const session: Session = await startSession({
    canvas: document.getElementById('c') as HTMLCanvasElement, name, code, relays, color,
    hooks: {
      notice: (text) => notice.say(text),
      log: () => {}, // the dice and chat log arrives with Play mode
      rolled: (shown, by) => notice.say(`${shown} · ${plain(by)}`),
      changed: () => { dock?.render(); inset(); },
      grabbed: () => {},
    },
  });
  document.getElementById('lobby')!.hidden = true;
  dock = mountDock(root, session, notice);
  /** Tell the board how much of the canvas the dock covers, so "the middle of the table" is the middle of what can be seen. */
  let was = '';
  function inset(): void {
    if (!dock) return;
    const r = dock.el.getBoundingClientRect(), side = r.height > r.width;
    const now = side ? `0,${Math.round(innerWidth - r.left)}` : `${Math.round(innerHeight - r.top)},0`;
    if (now === was) return;
    was = now;
    const [bottom, right] = now.split(',').map(Number);
    session.board.setInset(bottom, right);
  }
  addEventListener('resize', () => setTimeout(inset));
  dock.render();
  inset();
  Object.assign(window, { __ct: { store: session.store, net: session.net, board: session.board, sound: session.sound, session } });
}
