import { formatPercent, formatSI } from '../core/units';

export interface WorldStats {
  energy: number;
  drift: number;
  /** Largest distance from the exact solution, m; null without one. */
  error: number | null;
  diverged: boolean;
}

export interface ClockStats {
  time: number;
  steps: number;
  dt: number;
  stepsPerFrame: number;
  fps: number;
}

interface WorldRow {
  energy: HTMLElement;
  drift: HTMLElement;
  error: HTMLElement | null;
  card: HTMLElement;
}

/** Side panel with clock readouts and per-world energy/accuracy cards. */
export class StatsPanel {
  private clock: Record<keyof ClockStats, HTMLElement> | null = null;
  private rows: WorldRow[] = [];

  constructor(private readonly root: HTMLElement) {}

  configure(worlds: ReadonlyArray<{ label: string; color: string }>, hasAnalytic: boolean): void {
    this.root.replaceChildren();

    const clockBlock = block('Час');
    const clockList = el('dl', 'kv');
    this.clock = {
      time: pair(clockList, 'Модельний час'),
      steps: pair(clockList, 'Кроків'),
      dt: pair(clockList, 'Крок dt'),
      stepsPerFrame: pair(clockList, 'Кроків за кадр'),
      fps: pair(clockList, 'Кадрів/с'),
    };
    clockBlock.append(clockList);

    const worldBlock = block('Енергія і точність');
    this.rows = worlds.map(({ label, color }) => {
      const card = el('div', 'world-card');
      const head = el('div', 'world-head');
      const key = el('span', 'line-key');
      key.style.background = color;
      const name = el('span');
      name.textContent = label;
      head.append(key, name);
      const list = el('dl', 'kv');
      card.append(head, list);
      worldBlock.append(card);
      return {
        card,
        energy: pair(list, 'Повна енергія E'),
        drift: pair(list, 'Зміна ΔE/E₀'),
        error: hasAnalytic ? pair(list, 'Похибка положення') : null,
      };
    });
    if (hasAnalytic) {
      const note = el('p', 'note');
      note.textContent = 'Похибка — найбільша відстань тіла від точного розв’язку.';
      worldBlock.append(note);
    }

    const help = block('Керування');
    const list = el('ul', 'help');
    for (const [keys, action] of [
      ['Пробіл', 'пауза / пуск'],
      ['. або →', 'один крок'],
      ['R', 'скинути'],
      ['F або подвійний клік', 'показати все'],
      ['Перетягування', 'рух камери'],
      ['Колесо / щипок', 'масштаб'],
    ]) {
      const item = el('li');
      const kbd = el('kbd');
      kbd.textContent = keys;
      item.append(kbd, ` ${action}`);
      list.append(item);
    }
    help.append(list);

    this.root.append(clockBlock, worldBlock, help);
  }

  update(clock: ClockStats, worlds: readonly WorldStats[]): void {
    if (!this.clock) return;
    this.clock.time.textContent = formatSI(clock.time, 'с', 4);
    this.clock.steps.textContent = clock.steps.toLocaleString('uk-UA');
    this.clock.dt.textContent = formatSI(clock.dt, 'с');
    this.clock.stepsPerFrame.textContent = String(clock.stepsPerFrame);
    this.clock.fps.textContent = clock.fps.toFixed(0);

    worlds.forEach((stats, i) => {
      const row = this.rows[i];
      if (!row) return;
      row.card.classList.toggle('diverged', stats.diverged);
      row.energy.textContent = stats.diverged ? 'розійшлося' : formatSI(stats.energy, 'Дж', 4);
      row.drift.textContent = stats.diverged ? '—' : formatPercent(stats.drift);
      if (row.error) row.error.textContent = stats.error === null || stats.diverged ? '—' : formatSI(stats.error, 'м');
    });
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function block(title: string): HTMLElement {
  const section = el('section', 'stats-block');
  const h = el('h2');
  h.textContent = title;
  section.append(h);
  return section;
}

function pair(list: HTMLElement, label: string): HTMLElement {
  const dt = el('dt');
  dt.textContent = label;
  const dd = el('dd');
  list.append(dt, dd);
  return dd;
}
