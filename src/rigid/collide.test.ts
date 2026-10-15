import { describe, expect, it } from 'vitest';
import { Vec2 } from '../core/vec2';
import { Body } from './body';
import { type ContactGeometry, collide, contactGeometry } from './collide';
import { box, circle } from './shapes';

const geometry = (a: Body, b: Body): ContactGeometry | null => {
  const m = collide(a, b);
  if (!m) return null;
  const g: ContactGeometry = { nx: 0, ny: 0, px: [], py: [], separation: [] };
  contactGeometry(m, a, b, g);
  return g;
};

describe('narrow phase', () => {
  const ground = new Body({ shape: box(10, 1), position: new Vec2(0, -0.5), static: true }, 0);

  it('box resting on the ground: two points along the bottom edge', () => {
    const crate = new Body({ shape: box(1, 1), position: new Vec2(0.3, 0.49) }, 1);
    const g = geometry(ground, crate)!;
    expect(g.nx).toBeCloseTo(0, 12);
    expect(g.ny).toBeCloseTo(1, 12);
    expect(g.px.length).toBe(2);
    expect(g.px.map((x) => Number(x.toFixed(9))).sort()).toEqual([-0.2, 0.8]);
    for (const s of g.separation) expect(s).toBeCloseTo(-0.01, 12);
  });

  it('tilted box touching with one corner gives one point', () => {
    const crate = new Body({ shape: box(1, 1), position: new Vec2(0, Math.SQRT1_2 - 0.02), angle: Math.PI / 4 }, 1);
    const g = geometry(ground, crate)!;
    expect(g.px.length).toBe(1);
    expect(g.px[0]).toBeCloseTo(0, 9);
    expect(g.separation[0]).toBeCloseTo(-0.02, 9);
  });

  it('normal always points from A to B, whichever face is the reference', () => {
    const crate = new Body({ shape: box(1, 1), position: new Vec2(0, 0.49) }, 1);
    const g = geometry(crate, ground)!; // reversed order
    expect(g.ny).toBeCloseTo(-1, 12);
  });

  it('circles: normal along the centre line, separation = d − r₁ − r₂', () => {
    const a = new Body({ shape: circle(1), position: new Vec2(0, 0) }, 0);
    const b = new Body({ shape: circle(0.5), position: new Vec2(0.9, 1.2) }, 1);
    const g = geometry(a, b)!;
    expect(g.nx).toBeCloseTo(0.6, 12);
    expect(g.ny).toBeCloseTo(0.8, 12);
    expect(g.separation[0]).toBeCloseTo(1.5 - 1.5, 12);
  });

  it('circle on a face and near a corner', () => {
    const onFace = new Body({ shape: circle(0.5), position: new Vec2(2, 0.45) }, 1);
    const face = geometry(ground, onFace)!;
    expect(face.ny).toBeCloseTo(1, 12);
    expect(face.separation[0]).toBeCloseTo(-0.05, 12);

    // Near the top-right corner (5, 0): the normal points from the corner to the centre.
    const nearCorner = new Body({ shape: circle(0.5), position: new Vec2(5.3, 0.3) }, 1);
    const corner = geometry(ground, nearCorner)!;
    expect(corner.nx).toBeCloseTo(Math.SQRT1_2, 12);
    expect(corner.ny).toBeCloseTo(Math.SQRT1_2, 12);
    expect(corner.separation[0]).toBeCloseTo(Math.hypot(0.3, 0.3) - 0.5, 12);
  });

  it('reports nothing for separated shapes', () => {
    expect(collide(ground, new Body({ shape: box(1, 1), position: new Vec2(0, 0.6) }, 1))).toBeNull();
    expect(collide(ground, new Body({ shape: circle(0.5), position: new Vec2(5.4, 0.4) }, 1))).toBeNull();
  });
});
