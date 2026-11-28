// Small helpers for building the chrome's DOM by hand.

export const ico = (id: string) => `<svg><use href="#i-${id}"/></svg>`;
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;
/** An element: `class`, `html` and `text` are set as such, `on…` are listeners, the rest are attributes (false or undefined: left out). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') (el as unknown as Record<string, unknown>)[k] = v;
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'value') (el as unknown as HTMLInputElement).value = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}
/** A button with an icon and a label. */
export const btn = (label: string, click: () => void, more: { icon?: string; on?: boolean; cls?: string; title?: string; disabled?: boolean } = {}): HTMLButtonElement =>
  h('button', { type: 'button', class: `${more.cls ?? ''}${more.on ? ' on' : ''}`.trim() || undefined, html: `${more.icon ? ico(more.icon) : ''}${esc(label)}`, title: more.title, 'aria-label': more.title, 'aria-pressed': more.on === undefined ? undefined : String(more.on), disabled: more.disabled, onclick: click });
