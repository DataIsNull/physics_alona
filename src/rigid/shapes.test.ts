import { describe, expect, it } from 'vitest';
import { Vec2 } from '../core/vec2';
import { box, circle, massData, polygon, regularPolygon } from './shapes';

describe('shapes and mass properties', () => {
  it('box: m = ρ·w·h, I = m(w² + h²)/12', () => {
    const { mass, inertia } = massData(box(2, 0.5), 3);
    expect(mass).toBeCloseTo(3 * 2 * 0.5, 12);
    expect(inertia).toBeCloseTo((mass * (4 + 0.25)) / 12, 12);
  });

  it('circle: I = ½·m·r²', () => {
    const { mass, inertia } = massData(circle(0.4), 2);
    expect(mass).toBeCloseTo(2 * Math.PI * 0.16, 12);
    expect(inertia).toBeCloseTo(0.5 * mass * 0.16, 12);
  });

  it('a many-sided polygon approaches a disc', () => {
    const disc = massData(circle(1), 1);
    const poly = massData(regularPolygon(256, 1), 1);
    expect(poly.mass / disc.mass).toBeCloseTo(1, 3);
    expect(poly.inertia / disc.inertia).toBeCloseTo(1, 3);
  });

  it('recentres on the centroid and fixes clockwise winding', () => {
    // Right triangle given clockwise; its centroid is at (1/3, 1/3) of the legs.
    const tri = polygon([new Vec2(0, 0), new Vec2(0, 3), new Vec2(3, 0)]);
    const cx = tri.xs.reduce((s, x) => s + x, 0) / 3;
    const cy = tri.ys.reduce((s, y) => s + y, 0) / 3;
    expect(cx).toBeCloseTo(0, 12);
    expect(cy).toBeCloseTo(0, 12);
    // Counter-clockwise: positive signed area.
    let area = 0;
    for (let i = 0; i < 3; i++) area += tri.xs[i] * tri.ys[(i + 1) % 3] - tri.ys[i] * tri.xs[(i + 1) % 3];
    expect(area).toBeGreaterThan(0);
    // Outward normals: each points away from the centroid.
    for (let i = 0; i < 3; i++) expect(tri.nxs[i] * tri.xs[i] + tri.nys[i] * tri.ys[i]).toBeGreaterThan(0);
  });

  it('rejects concave polygons', () => {
    const arrow = [new Vec2(0, 0), new Vec2(2, 0), new Vec2(1, 0.3), new Vec2(2, 1), new Vec2(0, 1)];
    expect(() => polygon(arrow)).toThrow(RangeError);
  });
});
