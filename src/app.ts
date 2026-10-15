import { FixedStepClock } from './core/clock';
import type { IntegratorId } from './core/integrators';
import { formatPercent, formatSI } from './core/units';
import { Camera } from './render/camera';
import { TimeGraph } from './render/graph';
import { type RenderLayers, Renderer, type WorldView } from './render/renderer';
import { theme } from './render/theme';
import { Trail } from './render/trail';
import { SCENES } from './scenes';
import type { Scene } from './scenes/types';
import { Controls } from './ui/controls';
import { byId } from './ui/dom';
import { attachCameraInput } from './ui/input';
import { StatsPanel, type WorldStats } from './ui/stats';

/** Sampling intervals in simulated seconds. */
const TRAIL_INTERVAL = 1 / 120;
const GRAPH_INTERVAL = 1 / 60;
/** Stats and legend text refresh rate, ms of real time. */
const STATS_INTERVAL = 120;

/** Wires the simulation loop to rendering and UI. */
export class App {
  private readonly camera = new Camera();
  private readonly clock = new FixedStepClock(1 / 60);
  private readonly renderer: Renderer;
  private readonly graph: TimeGraph;
  private readonly stats: StatsPanel;
  private readonly controls: Controls;

  private scene!: Scene;
  private views: WorldView[] = [];
  private integrator: IntegratorId = 'velocity-verlet';
  private layers: RenderLayers;

  /** Simulated time since the last (re)start, s. Tracked here because a diverged world stops its own clock. */
  private time = 0;
  private stepCount = 0;
  private nextTrailSample = 0;
  private nextGraphSample = 0;
  private stepsLastFrame = 0;
  private lastFrame: number | null = null;
  private fps = 0;
  private fpsFrames = 0;
  private fpsWindowStart: number | null = null;
  private lastStats = -Infinity;
  private needsFit = true;

  constructor() {
    this.renderer = new Renderer(byId('sim'), this.camera);
    this.graph = new TimeGraph(byId('graph'), byId('legend'), byId('tooltip'));
    this.stats = new StatsPanel(byId('stats'));
    this.controls = new Controls(SCENES, {
      scene: (id) => this.loadScene(id),
      integrator: (id) => this.setIntegrator(id),
      togglePause: () => this.setPaused(!this.clock.paused),
      step: () => this.stepOnce(),
      reset: () => this.reset(),
      fit: () => this.fit(),
      timeScale: (v) => (this.clock.timeScale = v),
      dt: (v) => (this.clock.dt = v),
      layers: (layers) => (this.layers = layers),
    });
    this.layers = this.controls.layers;
    attachCameraInput(byId('sim'), this.camera, {
      onCursor: (p) => this.controls.showCursor(p),
      onFit: () => this.fit(),
    });

    this.loadScene(location.hash.slice(1) || SCENES[0].id);
    window.addEventListener('hashchange', () => {
      const id = location.hash.slice(1);
      if (id !== this.scene.id) this.loadScene(id);
    });
    this.setPaused(false);
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  private loadScene(id: string): void {
    this.scene = SCENES.find((s) => s.id === id) ?? SCENES[0];
    this.clock.dt = this.scene.dt;
    this.controls.setDt(this.scene.dt);
    this.controls.showScene(this.scene, this.integrator);
    this.buildWorlds();
    this.needsFit = true;
    history.replaceState(null, '', `#${this.scene.id}`);
  }

  private setIntegrator(id: IntegratorId): void {
    this.integrator = id;
    this.controls.showScene(this.scene, id);
    this.buildWorlds();
  }

  private buildWorlds(): void {
    this.views = this.scene.build(this.integrator).map((world) => ({
      world,
      trails: Array.from({ length: world.particles.count }, () => new Trail()),
    }));

    if (this.scene.graph === 'energy') {
      byId('graph-title').textContent = 'Енергія';
      this.graph.configure(
        [
          { label: 'Кінетична', color: theme.series[0] },
          { label: 'Потенціальна', color: theme.series[1] },
          { label: 'Повна', color: theme.series[2] },
        ],
        (v) => formatSI(v, 'Дж'),
      );
    } else {
      byId('graph-title').textContent = 'Зміна повної енергії ΔE/E₀';
      this.graph.configure(
        this.views.map(({ world }) => ({ label: world.label, color: world.color })),
        formatPercent,
      );
    }
    this.stats.configure(
      this.views.map(({ world }) => ({ label: world.label, color: world.color })),
      !!this.scene.analytic,
    );
    this.restart();
  }

  private reset(): void {
    for (const { world } of this.views) world.reset();
    this.restart();
  }

  /** Clears time, trails and graph after the worlds are back at their initial state. */
  private restart(): void {
    this.time = 0;
    this.stepCount = 0;
    this.clock.reset();
    for (const view of this.views) for (const trail of view.trails) trail.clear();
    this.graph.clear();
    this.nextTrailSample = 0;
    this.nextGraphSample = 0;
    this.sample();
    this.lastStats = -Infinity;
  }

  private setPaused(paused: boolean): void {
    this.clock.paused = paused;
    this.controls.setPaused(paused);
  }

  private stepOnce(): void {
    this.setPaused(true);
    this.advance(1);
    this.lastStats = -Infinity;
  }

  private fit(): void {
    this.camera.fit(this.scene.view);
  }

  private advance(steps: number): void {
    const dt = this.clock.dt;
    for (let s = 0; s < steps; s++) {
      for (const { world } of this.views) world.step(dt);
      this.time += dt;
      this.stepCount++;
      this.sample();
      if (this.scene.loopAfter !== undefined && this.time >= this.scene.loopAfter) this.reset();
    }
  }

  private sample(): void {
    const eps = 1e-12;
    if (this.time >= this.nextTrailSample - eps) {
      for (const { world, trails } of this.views) {
        if (world.diverged) continue;
        const pos = world.particles.pos;
        trails.forEach((trail, i) => trail.push(pos[2 * i], pos[2 * i + 1]));
      }
      this.nextTrailSample = this.time + TRAIL_INTERVAL;
    }
    if (this.time >= this.nextGraphSample - eps) {
      this.graph.push(this.time, this.graphValues());
      this.nextGraphSample = this.time + GRAPH_INTERVAL;
    }
  }

  private graphValues(): number[] {
    if (this.scene.graph === 'energy') {
      const world = this.views[0].world;
      const kinetic = world.kineticEnergy();
      const potential = world.potentialEnergy();
      return [kinetic, potential, kinetic + potential];
    }
    return this.views.map(({ world }) => (world.diverged ? NaN : world.energyDrift()));
  }

  private worldStats(): WorldStats[] {
    const analytic = this.scene.analytic;
    return this.views.map(({ world }, w) => {
      let error: number | null = null;
      if (analytic) {
        error = 0;
        for (let i = 0; i < world.particles.count; i++) {
          error = Math.max(error, world.particles.position(i).distanceTo(analytic(w, i, world.t)));
        }
      }
      return { energy: world.totalEnergy(), drift: world.energyDrift(), error, diverged: world.diverged };
    });
  }

  /** Frames per second averaged over half-second windows. */
  private countFrame(now: number): void {
    this.fpsWindowStart ??= now;
    this.fpsFrames++;
    const elapsed = now - this.fpsWindowStart;
    if (elapsed >= 500) {
      this.fps = (this.fpsFrames * 1000) / elapsed;
      this.fpsFrames = 0;
      this.fpsWindowStart = now;
    }
  }

  private readonly frame = (now: number): void => {
    const realDt = this.lastFrame === null ? 0 : (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    this.countFrame(now);

    const steps = this.clock.advance(realDt);
    this.advance(steps);
    this.stepsLastFrame = steps;

    this.renderer.resize();
    if (this.needsFit) {
      this.fit();
      this.needsFit = false;
    }
    this.renderer.render(this.views, this.layers, this.scene.analytic);
    this.graph.draw();

    if (now - this.lastStats >= STATS_INTERVAL) {
      this.lastStats = now;
      this.stats.update(
        {
          time: this.time,
          steps: this.stepCount,
          dt: this.clock.dt,
          stepsPerFrame: this.stepsLastFrame,
          fps: this.fps,
        },
        this.worldStats(),
      );
      this.graph.updateLegend();
      this.controls.showStatus(
        this.clock.paused ? 'Пауза' : this.clock.lagging ? 'Не встигає: частину часу пропущено' : '',
      );
    }

    requestAnimationFrame(this.frame);
  };
}
