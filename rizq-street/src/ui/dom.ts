/** Tiny DOM builder: h('div.card', {onclick}, children…). */
type Child = Node | string | number | null | undefined | false;
type Props = Partial<Record<string, unknown>> & { style?: Partial<CSSStyleDeclaration> | string };

export function h<K extends keyof HTMLElementTagNameMap>(sel: K | `${K}.${string}` | `${K}#${string}`, props: Props | Child = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const [tagAndId, ...classes] = sel.split('.');
  const [tag, id] = tagAndId.split('#');
  const el = document.createElement(tag as K);
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  if (props && !(props instanceof Node) && typeof props === 'object') {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'class') {
        el.className += ' ' + String(v);
      } else if (k in el && typeof v !== 'string') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else {
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
  } else if (props !== null && props !== undefined && props !== false) {
    children.unshift(props as Child);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function clear(el: HTMLElement): HTMLElement {
  el.replaceChildren();
  return el;
}

/** "1,250" wrapped so it stays left-to-right inside Arabic text. */
export function num(text: string | number): HTMLSpanElement {
  return h('span.num', String(text));
}
