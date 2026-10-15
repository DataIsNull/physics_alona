import { describe, expect, it } from 'vitest';
import { Vec2 } from '../core/vec2';
import { Camera } from './camera';

function camera(): Camera {
  const cam = new Camera();
  cam.setViewport(800, 600);
  cam.center = new Vec2(3, -2);
  cam.scale = 40;
  return cam;
}

describe('Camera', () => {
  it('maps the centre to the middle of the viewport with y up', () => {
    const cam = camera();
    expect(cam.toScreen(new Vec2(3, -2))).toEqual(new Vec2(400, 300));
    expect(cam.toScreenY(-1)).toBeLessThan(300); // higher y → higher on screen
  });

  it('round-trips world ↔ screen', () => {
    const cam = camera();
    const p = new Vec2(7.25, 1.5);
    const s = cam.toScreen(p);
    expect(cam.toWorld(s.x, s.y).equals(p, 1e-12)).toBe(true);
  });

  it('keeps the point under the cursor fixed when zooming', () => {
    const cam = camera();
    const before = cam.toWorld(120, 450);
    cam.zoomAt(120, 450, 3.7);
    expect(cam.toWorld(120, 450).equals(before, 1e-12)).toBe(true);
    expect(cam.scale).toBeCloseTo(148);
  });

  it('fits bounds inside the padded viewport', () => {
    const cam = camera();
    cam.fit({ min: new Vec2(-10, -1), max: new Vec2(10, 1) }, 20);
    expect(cam.scale).toBeCloseTo(760 / 20);
    expect(cam.center.equals(Vec2.ZERO, 1e-12)).toBe(true);
  });
});
