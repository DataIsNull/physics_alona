import { describe, expect, it } from 'vitest';
import { FixedStepClock } from './clock';

describe('FixedStepClock', () => {
  it('carries leftover time between frames', () => {
    const clock = new FixedStepClock(0.01);
    expect(clock.advance(0.025)).toBe(2);
    expect(clock.advance(0.005)).toBe(1); // 0.005 leftover + 0.005
  });

  it('applies time scale and pause', () => {
    const clock = new FixedStepClock(0.01);
    clock.timeScale = 2;
    expect(clock.advance(0.05)).toBe(10);
    clock.paused = true;
    expect(clock.advance(1)).toBe(0);
  });

  it('caps steps per frame and drops the backlog', () => {
    const clock = new FixedStepClock(0.001);
    clock.maxStepsPerFrame = 50;
    expect(clock.advance(0.2)).toBe(50);
    expect(clock.lagging).toBe(true);
    expect(clock.advance(0.0005)).toBe(0);
    expect(clock.lagging).toBe(false);
  });

  it('clamps long gaps to a quarter second', () => {
    const clock = new FixedStepClock(0.01);
    expect(clock.advance(10)).toBe(25);
  });
});
