// Notices: one line on the table, saying what just happened or what to do next. It takes the
// place of the system lines that used to go to a closed log. One at a time, it fades by
// itself, and a touch never lands on it: the table underneath stays the table.

export interface Notice { say(text: string, ms?: number): void; clear(): void }

export function mountNotice(root: HTMLElement): Notice {
  const el = document.createElement('div');
  el.className = 'notice';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  root.append(el);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); el.classList.remove('show'); };
  return {
    say(text, ms = Math.min(6000, 1800 + text.length * 45)) {
      el.textContent = text;
      el.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(clear, ms);
    },
    clear,
  };
}
