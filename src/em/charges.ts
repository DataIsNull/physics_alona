import type { Simulation, TrailSource } from '../core/simulation';
import { COULOMB, VACUUM_PERMEABILITY } from '../core/units';
import { Vec2 } from '../core/vec2';

export interface ChargedParticle {
  pos: Vec2;
  vel?: Vec2;
  /** Charge, C; under the Ampère law, the current along +z (out of the screen), A. */
  q: number;
  /** kg; for wires, kg per metre. */
  mass: number;
  /** Size for drawing and collisions, m. */
  radius: number;
  /** Held in place (it still pushes and pulls the others); the pointer can move it. */
  fixed?: boolean;
  color?: string;
  name?: string;
  trail?: boolean;
}

/** Uniform fields over a rectangle (the whole plane when it has no corners): E in the plane, B along z. */
export interface FieldRegion {
  min?: Vec2;
  max?: Vec2;
  /** V/m */
  E?: Vec2;
  /** T, positive out of the screen. */
  B?: number;
}

export interface ChargeOptions {
  particles: ChargedParticle[];
  /**
   * Forces between particles. 'coulomb': point charges, F = k·q₁q₂/r².
   * 'ampere': straight currents crossing the plane, F/L = μ₀I₁I₂/(2πr),
   * like currents attracting. 'none': only the outside fields act.
   */
  law?: 'coulomb' | 'ampere' | 'none';
  fields?: FieldRegion[];
  /** A gun that fires a copy of `template` every `interval` seconds into a pool of `capacity` particles. */
  emitter?: { template: ChargedParticle; interval: number; capacity: number };
  /** Elastic bounces between particles; on by default whenever they interact. */
  collisions?: boolean;
  /** Particles crossing x = screen are caught there (their landing height is kept). */
  screen?: number;
  /** Particles leaving this box are taken out (emitted ones) or bounce (the rest). */
  box?: { min: Vec2; max: Vec2 };
  /** Exact position of particle k at its age (time since it appeared), when known. */
  exact?: (k: number, age: number) => Vec2 | null;
  label?: string;
  color?: string;
}

/**
 * Charged particles (or straight currents) in the plane. Each step is a
 * Strang splitting that treats the magnetic field exactly: half a rotation
 * of the velocity at the cyclotron frequency qB/m, a kick–drift–kick for the
 * electric forces, and the other half rotation. A magnetic field therefore
 * never changes a particle's speed, and circles close on themselves.
 *
 * Energy: kinetic plus the pair potential (k·q₁q₂/r, or μ₀I₁I₂·ln r/2π)
 * is conserved; work done by the outside fields (a battery holding the
 * plates charged), by the gun and by the pointer is booked as outside work.
 */
export class ChargeWorld implements Simulation {
  readonly label: string;
  readonly color: string;
  readonly dissipative = false;
  readonly dissipated = 0;
  readonly law: 'coulomb' | 'ampere' | 'none';
  readonly fields: FieldRegion[];
  readonly n: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly q: Float64Array;
  readonly mass: Float64Array;
  readonly radius: Float64Array;
  readonly fixed: Uint8Array;
  /** Whether a slot holds a particle (the gun's pool starts empty). */
  readonly active: Uint8Array;
  readonly colors: string[];
  readonly names: string[];
  readonly screen: number | null;
  /** Landing heights on the screen, newest last. */
  readonly hits: number[] = [];
  readonly box: { min: Vec2; max: Vec2 } | null;
  readonly collisions: boolean;

  t = 0;
  steps = 0;
  diverged = false;
  externalWork = 0;
  readonly initialEnergy: number;
  grab: { particle: number; target: Vec2 } | null = null;

  private readonly ax: Float64Array;
  private readonly ay: Float64Array;
  private readonly birth: Float64Array;
  private readonly trailIndices: number[];
  private readonly emitter: ChargeOptions['emitter'] | null;
  private readonly firstEmitted: number;
  private nextEmission = 0;
  private nextSlot = 0;
  private potential = 0;
  private readonly exact: ChargeOptions['exact'] | null;
  private readonly initial: Float64Array[];
  private readonly initialActive: Uint8Array;

  constructor(options: ChargeOptions) {
    this.law = options.law ?? 'coulomb';
    this.fields = options.fields ?? [];
    this.label = options.label ?? 'Заряди';
    this.color = options.color ?? '#3987e5';
    this.emitter = options.emitter ?? null;
    this.screen = options.screen ?? null;
    this.box = options.box ?? null;
    this.collisions = options.collisions ?? this.law !== 'none';
    this.exact = options.exact ?? null;
    const pool = this.emitter?.capacity ?? 0;
    this.firstEmitted = options.particles.length;
    const n = (this.n = options.particles.length + pool);
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.q = new Float64Array(n);
    this.mass = new Float64Array(n);
    this.radius = new Float64Array(n);
    this.fixed = new Uint8Array(n);
    this.active = new Uint8Array(n);
    this.ax = new Float64Array(n);
    this.ay = new Float64Array(n);
    this.birth = new Float64Array(n);
    this.colors = new Array<string>(n).fill('#ffffff');
    this.names = new Array<string>(n).fill('');
    this.trailIndices = [];
    options.particles.forEach((p, i) => {
      this.place(i, p);
      if (p.trail) this.trailIndices.push(i);
    });
    if (this.emitter) for (let i = this.firstEmitted; i < n; i++) this.place(i, this.emitter.template, false);
    this.initial = [this.x.slice(), this.y.slice(), this.vx.slice(), this.vy.slice()];
    this.initialActive = this.active.slice();
    this.computeForces();
    this.initialEnergy = this.totalEnergy();
  }

  private place(i: number, p: ChargedParticle, active = true): void {
    this.x[i] = p.pos.x;
    this.y[i] = p.pos.y;
    this.vx[i] = p.vel?.x ?? 0;
    this.vy[i] = p.vel?.y ?? 0;
    this.q[i] = p.q;
    this.mass[i] = p.mass;
    this.radius[i] = p.radius;
    this.fixed[i] = p.fixed ? 1 : 0;
    this.active[i] = active ? 1 : 0;
    this.colors[i] = p.color ?? (p.q >= 0 ? '#e66767' : '#3987e5');
    this.names[i] = p.name ?? '';
  }

  /** Whether particle i moves (not held, present). */
  private moves(i: number): boolean {
    return this.active[i] === 1 && this.fixed[i] === 0;
  }

  // ── Fields ──────────────────────────────────────────────────────────────

  /** Outside field at a point: [Ex, Ey, Bz]. */
  outsideField(x: number, y: number): [number, number, number] {
    let ex = 0;
    let ey = 0;
    let bz = 0;
    for (const f of this.fields) {
      if (f.min && f.max && (x < f.min.x || x > f.max.x || y < f.min.y || y > f.max.y)) continue;
      ex += f.E?.x ?? 0;
      ey += f.E?.y ?? 0;
      bz += f.B ?? 0;
    }
    return [ex, ey, bz];
  }

  /**
   * Field of the particles at a point, skipping particle `skip`: the electric
   * field k·q·r̂/r² for charges, or the magnetic field μ₀I/(2πr) circling
   * each current. Inside a particle it falls off linearly (a charged ball,
   * a thick wire), so it stays finite.
   */
  particleField(x: number, y: number, skip = -1): [number, number] {
    let fx = 0;
    let fy = 0;
    for (let j = 0; j < this.n; j++) {
      if (j === skip || !this.active[j]) continue;
      const dx = x - this.x[j];
      const dy = y - this.y[j];
      const r2 = dx * dx + dy * dy;
      const R = this.radius[j];
      if (this.law === 'coulomb') {
        const r = Math.sqrt(r2);
        const s = (COULOMB * this.q[j]) / (r >= R ? r2 * r : R * R * R);
        fx += s * dx;
        fy += s * dy;
      } else if (this.law === 'ampere') {
        const s = (VACUUM_PERMEABILITY * this.q[j]) / (2 * Math.PI * Math.max(r2, R * R));
        fx -= s * dy;
        fy += s * dx;
      }
    }
    return [fx, fy];
  }

  /** Electric potential of the charges at a point, V (0 for the Ampère law). */
  potentialAt(x: number, y: number): number {
    if (this.law !== 'coulomb') return 0;
    let v = 0;
    for (let j = 0; j < this.n; j++) {
      if (!this.active[j]) continue;
      const r = Math.hypot(x - this.x[j], y - this.y[j]);
      const R = this.radius[j];
      v += (COULOMB * this.q[j]) / (r >= R ? r : (3 * R * R - r * r) / (2 * R));
    }
    return v;
  }

  // ── Dynamics ────────────────────────────────────────────────────────────

  step(dt: number): void {
    if (this.diverged) return;
    const grabbed = this.grab !== null;
    const before = grabbed ? this.totalEnergy() : 0;
    // Bounces happen between the force evaluations; near one, finer steps keep the energy error small.
    const count = this.collisions && this.nearContact(dt) ? 32 : 1;
    for (let k = 0; k < count; k++) this.advance(dt / count);
    if (grabbed) this.externalWork += this.totalEnergy() - before;
    this.steps++;
    this.catchAndEmit();
    if (!Number.isFinite(this.kineticEnergy())) this.diverged = true;
  }

  /** Strang splitting: half rotation, kick, drift (with bounces), kick, half rotation. */
  private advance(dt: number): void {
    if (this.grab) this.computeForces(dt);
    this.rotate(dt / 2);
    this.kick(dt / 2);
    for (let i = 0; i < this.n; i++) {
      if (!this.moves(i)) continue;
      this.x[i] += dt * this.vx[i];
      this.y[i] += dt * this.vy[i];
    }
    if (this.grab && this.fixed[this.grab.particle]) {
      this.x[this.grab.particle] = this.grab.target.x;
      this.y[this.grab.particle] = this.grab.target.y;
    }
    if (this.collisions) this.collide(dt);
    this.bounceOffBox();
    this.computeForces(dt);
    this.kick(dt / 2);
    this.rotate(dt / 2);
    this.t += dt;
  }

  /** Whether any two particles could touch within the next couple of steps. */
  private nearContact(dt: number): boolean {
    for (let i = 0; i < this.n; i++) {
      if (!this.active[i]) continue;
      for (let j = i + 1; j < this.n; j++) {
        if (!this.active[j] || (this.fixed[i] && this.fixed[j])) continue;
        const gap = Math.hypot(this.x[j] - this.x[i], this.y[j] - this.y[i]) - this.radius[i] - this.radius[j];
        const closing = Math.hypot(this.vx[j] - this.vx[i], this.vy[j] - this.vy[i]) * dt;
        if (gap < 3 * closing) return true;
      }
    }
    return false;
  }

  /** Exact rotation of each velocity in the local magnetic field for time dt: angle −qB·dt/m. */
  private rotate(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      if (!this.moves(i)) continue;
      const bz = this.outsideField(this.x[i], this.y[i])[2];
      if (bz === 0) continue;
      const angle = (-this.q[i] * bz * dt) / this.mass[i];
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const vx = this.vx[i];
      this.vx[i] = c * vx - s * this.vy[i];
      this.vy[i] = s * vx + c * this.vy[i];
    }
  }

  /** Velocity kick by the electric forces; the outside field's share of the energy change is outside work. */
  private kick(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      if (!this.moves(i)) continue;
      const [ex, ey] = this.outsideField(this.x[i], this.y[i]);
      const k = (this.q[i] / this.mass[i]) * dt;
      const vx = this.vx[i] + k * ex;
      const vy = this.vy[i] + k * ey;
      // Work of the outside field: the kinetic energy it alone adds in this kick.
      if (ex !== 0 || ey !== 0) this.externalWork += 0.5 * this.mass[i] * (vx * vx + vy * vy - this.vx[i] ** 2 - this.vy[i] ** 2);
      this.vx[i] = vx + dt * this.ax[i];
      this.vy[i] = vy + dt * this.ay[i];
    }
  }

  /** Pair accelerations and potential at the current positions, plus the pointer's spring. */
  private computeForces(dt = 0): void {
    const { n, x, y, q, mass, ax, ay, active } = this;
    ax.fill(0);
    ay.fill(0);
    let pe = 0;
    if (this.law !== 'none') {
      for (let i = 0; i < n; i++) {
        if (!active[i]) continue;
        for (let j = i + 1; j < n; j++) {
          if (!active[j]) continue;
          const dx = x[i] - x[j];
          const dy = y[i] - y[j];
          const r2 = dx * dx + dy * dy;
          const R = Math.max(this.radius[i] + this.radius[j], 1e-30);
          let f: number; // force on i along r̂ᵢⱼ, divided by r
          if (this.law === 'coulomb') {
            // Softened inside contact (two touching balls), so the force stays finite.
            const r = Math.sqrt(Math.max(r2, R * R));
            f = (COULOMB * q[i] * q[j]) / (r * r * r);
            pe += r2 >= R * R ? (COULOMB * q[i] * q[j]) / r : (COULOMB * q[i] * q[j] * (3 * R * R - r2)) / (2 * R * R * R);
          } else {
            const k = (VACUUM_PERMEABILITY * q[i] * q[j]) / (2 * Math.PI);
            f = -k / Math.max(r2, R * R);
            // U = k·ln r: like currents (k > 0) lower their energy by coming together.
            pe += r2 >= R * R ? k * Math.log(Math.sqrt(r2)) : k * (Math.log(R) + (r2 / (R * R) - 1) / 2);
          }
          if (!this.fixed[i]) {
            ax[i] += (f * dx) / mass[i];
            ay[i] += (f * dy) / mass[i];
          }
          if (!this.fixed[j]) {
            ax[j] -= (f * dx) / mass[j];
            ay[j] -= (f * dy) / mass[j];
          }
        }
      }
    }
    if (this.grab && dt > 0 && !this.fixed[this.grab.particle]) {
      const i = this.grab.particle;
      const w = 0.1 / dt;
      ax[i] += w * w * (this.grab.target.x - x[i]) - 2 * w * this.vx[i];
      ay[i] += w * w * (this.grab.target.y - y[i]) - 2 * w * this.vy[i];
    }
    this.potential = pe;
  }

  /**
   * Elastic bounces between touching particles, at the moment of contact: the pair is wound back along its drift to where it
   * first touched, its velocities are reflected, and it drifts on for the
   * rest of the step. Reflecting where the drift happened to end instead
   * would leave the pair too deep in each other's field and lose energy.
   */
  private collide(dt: number): void {
    const { n, x, y, vx, vy, mass, radius } = this;
    for (let i = 0; i < n; i++) {
      if (!this.active[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!this.active[j] || (this.fixed[i] && this.fixed[j])) continue;
        const dx = x[j] - x[i];
        const dy = y[j] - y[i];
        const R = radius[i] + radius[j];
        const d2 = dx * dx + dy * dy;
        if (d2 >= R * R) continue;
        const wx = vx[j] - vx[i];
        const wy = vy[j] - vy[i];
        const dw = dx * wx + dy * wy;
        if (dw >= 0) continue; // already separating
        // Time back to contact: |d − w·τ| = R.
        const w2 = wx * wx + wy * wy;
        const tau = Math.min(dt, (dw + Math.sqrt(dw * dw - w2 * (d2 - R * R))) / w2);
        const cx = dx - wx * tau;
        const cy = dy - wy * tau;
        const c = Math.hypot(cx, cy) || 1;
        const nx = cx / c;
        const ny = cy / c;
        // Inverse masses: a held particle acts like a wall.
        const wi = this.fixed[i] ? 0 : 1 / mass[i];
        const wj = this.fixed[j] ? 0 : 1 / mass[j];
        const approach = -(wx * nx + wy * ny);
        if (approach <= 0) continue;
        const impulse = (2 * approach) / (wi + wj);
        const dvix = -impulse * wi * nx;
        const dviy = -impulse * wi * ny;
        const dvjx = impulse * wj * nx;
        const dvjy = impulse * wj * ny;
        vx[i] += dvix;
        vy[i] += dviy;
        vx[j] += dvjx;
        vy[j] += dvjy;
        // Since contact the pair should have moved with the new velocities.
        x[i] += dvix * tau;
        y[i] += dviy * tau;
        x[j] += dvjx * tau;
        y[j] += dvjy * tau;
      }
    }
  }

  /** Bounces off the box walls, mirroring both the position and the velocity. */
  private bounceOffBox(): void {
    const { x, y, vx, vy, radius } = this;
    const box = this.box;
    if (!box) return;
    for (let i = 0; i < this.firstEmitted; i++) {
      if (!this.moves(i)) continue;
      const r = radius[i];
      if (x[i] < box.min.x + r && vx[i] < 0) {
        x[i] = 2 * (box.min.x + r) - x[i];
        vx[i] = -vx[i];
      }
      if (x[i] > box.max.x - r && vx[i] > 0) {
        x[i] = 2 * (box.max.x - r) - x[i];
        vx[i] = -vx[i];
      }
      if (y[i] < box.min.y + r && vy[i] < 0) {
        y[i] = 2 * (box.min.y + r) - y[i];
        vy[i] = -vy[i];
      }
      if (y[i] > box.max.y - r && vy[i] > 0) {
        y[i] = 2 * (box.max.y - r) - y[i];
        vy[i] = -vy[i];
      }
    }
  }

  /** The screen catches particles, the box takes out strays, and the gun fires on schedule. */
  private catchAndEmit(): void {
    for (let i = this.firstEmitted; i < this.n; i++) {
      if (!this.active[i]) continue;
      const caught = this.screen !== null && this.x[i] >= this.screen;
      const box = this.box;
      const lost = box !== null && (this.x[i] < box.min.x || this.x[i] > box.max.x || this.y[i] < box.min.y || this.y[i] > box.max.y);
      if (!caught && !lost) continue;
      if (caught) {
        this.hits.push(this.y[i]);
        if (this.hits.length > 400) this.hits.shift();
      }
      // The energy it carries leaves the system.
      this.externalWork -= 0.5 * this.mass[i] * (this.vx[i] ** 2 + this.vy[i] ** 2);
      this.active[i] = 0;
    }
    const e = this.emitter;
    if (!e || this.t < this.nextEmission) return;
    this.nextEmission += e.interval;
    const slot = this.firstEmitted + this.nextSlot;
    this.nextSlot = (this.nextSlot + 1) % e.capacity;
    if (this.active[slot]) this.externalWork -= 0.5 * this.mass[slot] * (this.vx[slot] ** 2 + this.vy[slot] ** 2);
    this.place(slot, e.template);
    this.birth[slot] = this.t;
    this.externalWork += 0.5 * this.mass[slot] * (this.vx[slot] ** 2 + this.vy[slot] ** 2);
    if (this.law !== 'none') this.computeForces();
  }

  // ── Measurements ────────────────────────────────────────────────────────

  /** Time since particle i appeared, s. */
  age(i: number): number {
    return this.t - this.birth[i];
  }

  speed(i: number): number {
    return Math.hypot(this.vx[i], this.vy[i]);
  }

  /** Index of the first particle with this name, or −1. */
  find(name: string): number {
    return this.names.indexOf(name);
  }

  // ── Simulation interface ────────────────────────────────────────────────

  reset(): void {
    const [x, y, vx, vy] = this.initial;
    this.x.set(x);
    this.y.set(y);
    this.vx.set(vx);
    this.vy.set(vy);
    this.active.set(this.initialActive);
    this.birth.fill(0);
    this.hits.length = 0;
    this.t = 0;
    this.steps = 0;
    this.diverged = false;
    this.externalWork = 0;
    this.nextEmission = 0;
    this.nextSlot = 0;
    this.grab = null;
    this.computeForces();
  }

  kineticEnergy(): number {
    let e = 0;
    for (let i = 0; i < this.n; i++) if (this.moves(i)) e += 0.5 * this.mass[i] * (this.vx[i] ** 2 + this.vy[i] ** 2);
    return e;
  }

  potentialEnergy(): number {
    return this.potential;
  }

  totalEnergy(): number {
    return this.kineticEnergy() + this.potentialEnergy();
  }

  energyBalance(): number {
    return this.totalEnergy() - this.externalWork;
  }

  energyDrift(): number {
    const scale = Math.max(Math.abs(this.initialEnergy), Math.abs(this.externalWork), this.kineticEnergy()) || 1;
    return (this.energyBalance() - this.initialEnergy) / scale;
  }

  exactError(): number | null {
    if (!this.exact) return null;
    let worst: number | null = null;
    for (let i = 0; i < this.n; i++) {
      if (!this.moves(i)) continue;
      const p = this.exact(i, this.age(i));
      if (!p) continue;
      const d = Math.hypot(p.x - this.x[i], p.y - this.y[i]);
      worst = worst === null ? d : Math.max(worst, d);
    }
    return worst;
  }

  /** Exact position of particle i now, if the scene knows it. */
  exactPosition(i: number): Vec2 | null {
    return this.exact && this.moves(i) ? this.exact(i, this.age(i)) : null;
  }

  trailSources(): TrailSource[] {
    return this.trailIndices.map((i) => ({ color: this.colors[i], x: () => this.x[i], y: () => this.y[i] }));
  }

  hitTest(point: Vec2, pixel: number): boolean {
    return this.nearest(point, pixel) !== null;
  }

  grabAt(point: Vec2, pixel: number): boolean {
    const i = this.nearest(point, pixel);
    if (i === null) return false;
    this.grab = { particle: i, target: point };
    return true;
  }

  dragTo(point: Vec2): void {
    if (this.grab) this.grab.target = point;
  }

  release(): void {
    this.grab = null;
    this.computeForces();
  }

  private nearest(point: Vec2, pixel: number): number | null {
    let best: number | null = null;
    let bestD = Infinity;
    for (let i = 0; i < this.firstEmitted; i++) {
      const d = Math.hypot(this.x[i] - point.x, this.y[i] - point.y);
      if (d <= this.radius[i] + 8 * pixel && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    return best;
  }
}

/**
 * Field line through a point: steps along the unit field direction (midpoint
 * rule) both ways until it runs into a particle, leaves `bounds`, closes on
 * itself, or reaches `maxSteps`. Returns the points in order.
 */
export function traceFieldLine(
  field: (x: number, y: number) => [number, number],
  start: Vec2,
  step: number,
  maxSteps: number,
  stop: (x: number, y: number) => boolean,
  direction: 1 | -1 = 1,
): Vec2[] {
  const points = [start];
  let x = start.x;
  let y = start.y;
  for (let k = 0; k < maxSteps; k++) {
    const [ax, ay] = field(x, y);
    const a = Math.hypot(ax, ay);
    if (a === 0) break;
    const mx = x + (0.5 * step * direction * ax) / a;
    const my = y + (0.5 * step * direction * ay) / a;
    const [bx, by] = field(mx, my);
    const b = Math.hypot(bx, by);
    if (b === 0) break;
    x += (step * direction * bx) / b;
    y += (step * direction * by) / b;
    points.push(new Vec2(x, y));
    if (stop(x, y)) break;
    // A closed loop (magnetic lines) ends where it began.
    if (k > 8 && Math.hypot(x - start.x, y - start.y) < 0.6 * step) {
      points.push(start);
      break;
    }
  }
  return points;
}
