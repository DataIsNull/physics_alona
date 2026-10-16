import type { GasWorld } from '../thermo/gas';
import type { Camera } from './camera';
import { theme } from './theme';

/** Sequential blue ramp for speed: slow atoms dim, fast atoms bright (one hue, as magnitude should be). */
const RAMP = ['#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];

export function drawGas(ctx: CanvasRenderingContext2D, camera: Camera, gas: GasWorld): void {
  // The box.
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 2;
  ctx.strokeRect(
    camera.toScreenX(gas.x0),
    camera.toScreenY(gas.y0 + gas.height),
    gas.width * camera.scale,
    gas.height * camera.scale,
  );

  const vScale = gas.thermalSpeed() * 1.8;
  for (let i = 0; i < gas.n; i++) {
    const x = camera.toScreenX(gas.x[i]);
    const y = camera.toScreenY(gas.y[i]);
    const r = Math.max(gas.radiusOf(i) * camera.scale, 1.5);
    const species = gas.speciesList[gas.species[i]];
    let color = species.color;
    if (gas.colorBy === 'speed' && gas.isSmall(i)) {
      const speed = Math.hypot(gas.vx[i], gas.vy[i]);
      color = RAMP[Math.min(RAMP.length - 1, Math.floor((speed / vScale) * RAMP.length))];
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    if (!gas.isSmall(i)) {
      ctx.strokeStyle = theme.surface;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  if (gas.grab) {
    const i = gas.grab.particle;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(camera.toScreenX(gas.x[i]), camera.toScreenY(gas.y[i]));
    ctx.lineTo(camera.toScreenX(gas.grab.target.x), camera.toScreenY(gas.grab.target.y));
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
