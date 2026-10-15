import type { Vec2 } from '../core/vec2';
import type { Camera } from '../render/camera';

export interface CameraInputHandlers {
  /** World position under the pointer, or null when it leaves the canvas. */
  onCursor(world: Vec2 | null): void;
  onFit(): void;
}

/** Drag to pan, wheel or pinch to zoom, double-click to frame the scene. */
export function attachCameraInput(canvas: HTMLCanvasElement, camera: Camera, handlers: CameraInputHandlers): void {
  const pointers = new Map<number, { x: number; y: number }>();
  const local = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    canvas.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    handlers.onCursor(camera.toWorld(p.x, p.y));
    const prev = pointers.get(e.pointerId);
    if (!prev) return;

    if (pointers.size === 1) {
      camera.panBy(p.x - prev.x, p.y - prev.y);
    } else if (pointers.size === 2) {
      // Pinch: zoom by the change in finger distance around their midpoint.
      const other = [...pointers].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(p.x - other.x, p.y - other.y);
      camera.panBy((p.x - prev.x) / 2, (p.y - prev.y) / 2);
      if (before > 0) camera.zoomAt((p.x + other.x) / 2, (p.y + other.y) / 2, after / before);
    }
    pointers.set(e.pointerId, p);
  });

  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => {
    if (pointers.size === 0) handlers.onCursor(null);
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = local(e);
      const pixels = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
      // Trackpad pinch arrives as ctrl+wheel with small deltas.
      const sensitivity = e.ctrlKey ? 0.01 : 0.0015;
      camera.zoomAt(p.x, p.y, Math.exp(-pixels * sensitivity));
    },
    { passive: false },
  );

  canvas.addEventListener('dblclick', () => handlers.onFit());
}
