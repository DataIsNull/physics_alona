import { INTEGRATORS, type IntegratorId, integratorInfo } from '../core/integrators';
import { type LengthUnit, METRES, formatDuration, formatLength } from '../core/units';
import type { Vec2 } from '../core/vec2';
import type { RenderLayers } from '../render/renderer';
import { STAGES } from '../scenes';
import type { Params, Scene, SceneParam } from '../scenes/types';
import { byId, noFocusOnClick } from './dom';

export interface ControlHandlers {
  scene(id: string): void;
  integrator(id: IntegratorId): void;
  togglePause(): void;
  step(): void;
  reset(): void;
  fit(): void;
  timeScale(value: number): void;
  dt(value: number): void;
  layers(layers: RenderLayers): void;
}

const SLIDER_MAX = 1000;
export const DEFAULT_DT_RANGE = [1e-4, 0.5] as const;
export const DEFAULT_SPEED_RANGE = [0.05, 20] as const;

/** Range input mapped onto a logarithmic value range. */
class LogSlider {
  constructor(
    private readonly input: HTMLInputElement,
    private readonly output: HTMLOutputElement,
    private lo: number,
    private hi: number,
    private readonly format: (v: number) => string,
    onChange: (v: number) => void,
    snap?: (v: number) => number,
  ) {
    input.min = '0';
    input.max = String(SLIDER_MAX);
    input.step = '1';
    input.addEventListener('input', () => {
      const raw = this.lo * (this.hi / this.lo) ** (Number(input.value) / SLIDER_MAX);
      const value = snap ? snap(raw) : raw;
      this.output.value = this.format(value);
      onChange(value);
    });
  }

  setRange(lo: number, hi: number): void {
    this.lo = lo;
    this.hi = hi;
  }

  set(value: number): void {
    this.input.value = String(Math.round((SLIDER_MAX * Math.log(value / this.lo)) / Math.log(this.hi / this.lo)));
    this.output.value = this.format(value);
  }
}

/** Toolbar, scene info and keyboard shortcuts. */
export class Controls {
  private readonly sceneSelect = byId<HTMLSelectElement>('scene');
  private readonly integratorSelect = byId<HTMLSelectElement>('integrator');
  private readonly playButton = byId<HTMLButtonElement>('play');
  private readonly status = byId('status');
  private readonly cursor = byId('cursor');
  private readonly dtSlider: LogSlider;
  private readonly speedSlider: LogSlider;
  private readonly layerInputs = {
    trails: byId<HTMLInputElement>('layer-trails'),
    analytic: byId<HTMLInputElement>('layer-analytic'),
    velocities: byId<HTMLInputElement>('layer-velocities'),
    contacts: byId<HTMLInputElement>('layer-contacts'),
  };

  constructor(
    scenes: readonly Scene[],
    private readonly on: ControlHandlers,
  ) {
    const groups = new Map<number, HTMLOptGroupElement>();
    for (const scene of scenes) {
      let group = groups.get(scene.stage);
      if (!group) {
        group = document.createElement('optgroup');
        group.label = STAGES[scene.stage] ?? `Етап ${scene.stage}`;
        groups.set(scene.stage, group);
        this.sceneSelect.append(group);
      }
      group.append(new Option(scene.title, scene.id));
    }
    for (const info of INTEGRATORS) this.integratorSelect.add(new Option(`${info.name} (порядок ${info.order})`, info.id));

    this.sceneSelect.addEventListener('change', () => on.scene(this.sceneSelect.value));
    this.integratorSelect.addEventListener('change', () => on.integrator(this.integratorSelect.value as IntegratorId));

    const buttons: Array<[string, () => void]> = [
      ['play', on.togglePause],
      ['step', on.step],
      ['reset', on.reset],
      ['fit', on.fit],
    ];
    for (const [id, handler] of buttons) {
      const button = byId<HTMLButtonElement>(id);
      noFocusOnClick(button);
      button.addEventListener('click', handler);
    }

    this.speedSlider = new LogSlider(
      byId('time-scale'),
      byId('time-scale-out'),
      ...DEFAULT_SPEED_RANGE,
      // Up to ×60 read as a factor; beyond that as simulated time per real second.
      (v) => (v <= 60 ? `×${v < 1 ? v.toFixed(2) : Number(v.toPrecision(3))}` : `${formatDuration(v, 2)}/с`),
      on.timeScale,
      (v) => (Math.abs(v - 1) < 0.06 ? 1 : v),
    );
    this.speedSlider.set(1);
    this.dtSlider = new LogSlider(byId('dt'), byId('dt-out'), ...DEFAULT_DT_RANGE, (v) => formatDuration(v), on.dt);

    for (const input of Object.values(this.layerInputs)) {
      input.addEventListener('change', () => on.layers(this.layers));
    }

    window.addEventListener('keydown', (e) => this.onKey(e));

    // On phones the scene description would cover half the canvas; start it collapsed.
    if (window.matchMedia('(max-width: 860px)').matches) byId<HTMLDetailsElement>('hud').open = false;
  }

  get layers(): RenderLayers {
    return {
      trails: this.layerInputs.trails.checked,
      analytic: this.layerInputs.analytic.checked,
      velocities: this.layerInputs.velocities.checked,
      contacts: this.layerInputs.contacts.checked,
    };
  }

  showScene(scene: Scene, integrator: IntegratorId): void {
    this.sceneSelect.value = scene.id;
    this.integratorSelect.value = integrator;
    this.integratorSelect.disabled = !!scene.fixedIntegrators;
    this.layerInputs.analytic.disabled = !scene.analytic;
    byId('scene-title').textContent = scene.title;
    byId('scene-description').textContent = scene.description;

    const summary = byId('integrator-summary');
    if (scene.fixedIntegrators) {
      summary.textContent = scene.integratorNote ?? 'У цій сцені кожен світ має власний інтегратор.';
    } else {
      const info = integratorInfo(integrator);
      summary.textContent = `${info.name}: ${info.summary}`;
    }
  }

  setPaused(paused: boolean): void {
    this.playButton.classList.toggle('is-paused', paused);
    this.playButton.setAttribute('aria-label', paused ? 'Пуск' : 'Пауза');
    this.playButton.title = paused ? 'Пуск (Пробіл)' : 'Пауза (Пробіл)';
  }

  /** Renders sliders for a scene's parameters; `onChange` fires while dragging. */
  showParams(params: readonly SceneParam[], values: Params, onChange: (id: string, value: number) => void): void {
    const root = byId('params');
    root.replaceChildren();
    root.hidden = params.length === 0;
    if (params.length === 0) return;
    const title = document.createElement('h2');
    title.textContent = 'Параметри';
    root.append(title);
    for (const p of params) {
      const label = document.createElement('label');
      label.className = 'param';
      const name = document.createElement('span');
      name.textContent = p.label;
      const output = document.createElement('output');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(p.min);
      input.max = String(p.max);
      input.step = String(p.step);
      input.value = String(values[p.id] ?? p.value);
      const show = () => (output.value = p.format ? p.format(Number(input.value)) : input.value);
      show();
      input.addEventListener('input', () => {
        show();
        onChange(p.id, Number(input.value));
      });
      label.append(name, output, input);
      root.append(label);
    }
  }

  /** Applies a scene's step and speed ranges and their starting values. */
  setTimeControls(dt: number, dtRange: readonly [number, number], speed: number, speedRange: readonly [number, number]): void {
    this.dtSlider.setRange(...dtRange);
    this.dtSlider.set(dt);
    this.speedSlider.setRange(...speedRange);
    this.speedSlider.set(speed);
  }

  showStatus(text: string): void {
    this.status.textContent = text;
    this.status.hidden = text === '';
  }

  showCursor(world: Vec2 | null, unit: LengthUnit = METRES): void {
    this.cursor.textContent = world ? `x ${formatLength(world.x, unit)}   y ${formatLength(world.y, unit)}` : '';
  }

  private onKey(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    const onSlider = target instanceof HTMLInputElement && target.type === 'range';

    // e.code is layout-independent, so shortcuts work on the Ukrainian layout too.
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this.on.togglePause();
        break;
      case 'Period':
        this.on.step();
        break;
      case 'ArrowRight':
        if (onSlider) return;
        e.preventDefault();
        this.on.step();
        break;
      case 'KeyR':
        this.on.reset();
        break;
      case 'KeyF':
        this.on.fit();
        break;
    }
  }
}
