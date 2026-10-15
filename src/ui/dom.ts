export function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

/** Keeps toolbar buttons from stealing focus, so Space stays bound to play/pause. */
export function noFocusOnClick(el: HTMLElement): void {
  el.addEventListener('mousedown', (e) => e.preventDefault());
}
