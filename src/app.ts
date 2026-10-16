import { FixedStepClock } from './core/clock';
import type { IntegratorId } from './core/integrators';
import type { Simulation } from './core/simulation';
import type { Vec2 } from './core/vec2';
import { METRES } from './core/units';
import { World } from './core/world';
import { Camera } from './render/camera';
import { TimeGraph } from './render/graph';
import { type RenderLayers, Renderer, type SimView } from './render/renderer';
import { Trail } from './render/trail';
import { SCENES } from './scenes';
import type { GraphSpec, Scene } from './scenes/types';
import type { AnalyticFn, Overlay } from './render/renderer';
import { Controls, DEFAULT_DT_RANGE, DEFAULT_SPEED_RANGE } from './ui/controls';
import { byId } from './ui/dom';
import { attachCameraInput } from './ui/input';
import { StatsPanel, type WorldStats } from './ui/stats';

/**
 * Trails and graphs are sampled on real time (per displayed frame), so a
 * year-per-second orbit and a ×1 spring both get smooth curves.
 */
const TRAIL_SAMPLES_PER_SECOND = 120;
const GRAPH_SAMPLES_PER_SECOND = 60;
/** Trail points closer than this on screen are skipped, px. */
const TRAIL_SPACING_PX = 1.5;
/** Stats and legend text refresh rate, ms of real time. */
const STATS_INTERVAL = 120;
/** Real time the physics may take per frame before the clock drops the backlog, ms. */
const PHYSICS_BUDGET_MS = 30;

/** Wires the simulation loop to rendering and UI. */
export class App {
  private readonly camera = new Camera();
  private readonly clock = new FixedStepClock(1 / 60);
  private readonly renderer: Renderer;
  private readonly graph: TimeGraph;
  private readonly stats: StatsPanel;
  private readonly controls: Controls;

  private scene!: Scene;
  private graphSpec!: GraphSpec;
  /** Current values of the scene's sliders. */
  private params: Record<string, number> = {};
  private views: SimView[] = [];
  private sims: Simulation[] = [];
  /** Simulation the pointer is dragging something in. */
  private grabbed: Simulation | null = null;
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
    const canvas = byId<HTMLCanvasElement>('sim');
    attachCameraInput(canvas, this.camera, {
      onCursor: (p, sx, sy) => {
        this.controls.showCursor(p, this.renderer.unit);
        canvas.classList.toggle('can-grab', p !== null && this.pick(sx, sy) !== null);
      },
      onFit: () => this.fit(),
      onGrabStart: (sx, sy) => this.grabAt(sx, sy),
      onGrabMove: (p) => this.dragTo(p),
      onGrabEnd: () => this.release(),
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
    const scene = SCENES.find((s) => s.id === id) ?? SCENES[0];
    this.scene = scene;
    this.integrator = scene.integrator ?? 'velocity-verlet';
    this.clock.dt = scene.dt;
    this.clock.timeScale = scene.speed ?? 1;
    this.controls.setTimeControls(
      scene.dt,
      scene.dtRange ?? DEFAULT_DT_RANGE,
      this.clock.timeScale,
      scene.speedRange ?? DEFAULT_SPEED_RANGE,
    );
    this.renderer.unit = scene.lengthUnit ?? METRES;
    this.controls.showScene(scene, this.integrator);
    this.params = Object.fromEntries((scene.params ?? []).map((p) => [p.id, p.value]));
    this.controls.showParams(scene.params ?? [], this.params, (id, value) => {
      this.params[id] = value;
      if (this.scene.update) this.scene.update(this.sims, this.params);
      else this.buildWorlds();
    });
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
    this.grabbed = null;
    this.sims = this.scene.build(this.integrator, this.params);
    this.views = this.sims.map((sim) => {
      const sources = sim.trailSources();
      return { sim, sources, trails: sources.map(() => new Trail()) };
    });

    const worlds = this.sims;
    this.graphSpec = this.scene.graph(worlds, this.params);
    byId('graph-title').textContent = this.graphSpec.title;
    this.graph.configure(this.graphSpec.series, this.graphSpec.format, this.graphSpec.scale);
    this.stats.configure(
      worlds.map((w) => ({ label: w.label, color: w.color, dissipative: w.dissipative })),
      !!this.scene.analytic || worlds.some((w) => (w.exactError?.() ?? null) !== null),
      this.renderer.unit,
    );
    this.restart();
  }

  private reset(): void {
    for (const sim of this.sims) sim.reset();
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

  /** Runs up to `steps` physics steps; returns how many ran within the frame budget. */
  private advance(steps: number): number {
    const dt = this.clock.dt;
    const start = performance.now();
    for (let s = 0; s < steps; s++) {
      for (const sim of this.sims) sim.step(dt);
      this.time += dt;
      this.stepCount++;
      this.sample();
      if (this.scene.loopAfter !== undefined && this.time >= this.scene.loopAfter) this.reset();
      if (performance.now() - start > PHYSICS_BUDGET_MS) {
        // Heavy scene: show what we have rather than freezing the page.
        this.clock.dropBacklog();
        return s + 1;
      }
    }
    return steps;
  }

  private sample(): void {
    const eps = 1e-12;
    if (this.time >= this.nextTrailSample - eps) {
      const spacing = TRAIL_SPACING_PX / this.camera.scale;
      for (const { sim, sources, trails } of this.views) {
        if (sim.diverged) continue;
        sources.forEach((source, k) => trails[k].push(source.x(), source.y(), spacing));
      }
      this.nextTrailSample = this.time + this.clock.timeScale / TRAIL_SAMPLES_PER_SECOND;
    }
    if (this.time >= this.nextGraphSample - eps) {
      this.graph.push(this.time, this.graphSpec.sample(this.sims));
      this.nextGraphSample = this.time + this.clock.timeScale / GRAPH_SAMPLES_PER_SECOND;
    }
  }

  /** First simulation with something grabbable under a screen point. */
  private pick(sx: number, sy: number): Simulation | null {
    const point = this.camera.toWorld(sx, sy);
    const pixel = 1 / this.camera.scale;
    return this.sims.find((sim) => sim.hitTest(point, pixel)) ?? null;
  }

  private grabAt(sx: number, sy: number): boolean {
    const sim = this.pick(sx, sy);
    if (!sim?.grabAt(this.camera.toWorld(sx, sy), 1 / this.camera.scale)) return false;
    this.grabbed = sim;
    return true;
  }

  private dragTo(p: Vec2): void {
    this.grabbed?.dragTo(p);
  }

  private release(): void {
    this.grabbed?.release();
    this.grabbed = null;
  }

  private worldStats(): WorldStats[] {
    const analytic = this.scene.analytic;
    return this.sims.map((sim, w) => {
      let error: number | null = null;
      if (analytic && sim instanceof World) {
        for (let i = 0; i < sim.particles.count; i++) {
          const exact = analytic(w, i, sim.t, this.params);
          if (exact) error = Math.max(error ?? 0, sim.particles.position(i).distanceTo(exact));
        }
      }
      if (!(sim instanceof World)) error = sim.exactError?.() ?? null;
      return {
        energy: sim.totalEnergy(),
        dissipated: sim.dissipated,
        drift: sim.energyDrift(),
        error,
        diverged: sim.diverged,
      };
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

    this.stepsLastFrame = this.advance(this.clock.advance(realDt));

    this.renderer.resize();
    // A canvas not laid out yet (a hidden tab) has no size to fit to: wait for one.
    if (this.needsFit && this.camera.width > 1) {
      this.fit();
      this.needsFit = false;
    }
    const { analytic, overlay, foreground } = this.scene;
    const params = this.params;
    const exact: AnalyticFn | undefined = analytic && ((w, i, t) => analytic(w, i, t, params));
    const under: Overlay | undefined = overlay && ((ctx, camera, sims) => overlay(ctx, camera, sims, params));
    const over: Overlay | undefined = foreground && ((ctx, camera, sims) => foreground(ctx, camera, sims, params));
    this.renderer.render(this.views, this.layers, exact, under, over);
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
