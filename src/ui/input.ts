import type { Vec2 } from '../core/vec2';
import type { Camera } from '../render/camera';

export interface CameraInputHandlers {
  /** World position under the pointer (null when it leaves), plus its screen position. */
  onCursor(world: Vec2 | null, sx: number, sy: number): void;
  onFit(): void;
  /** Return true if the press grabbed a particle; the drag then moves it instead of the camera. */
  onGrabStart(sx: number, sy: number): boolean;
  onGrabMove(world: Vec2): void;
  onGrabEnd(): void;
}

/**
 * Drag a particle to move it, drag empty space to pan, wheel or pinch to
 * zoom, double-click to frame the scene.
 */
export function attachCameraInput(canvas: HTMLCanvasElement, camera: Camera, handlers: CameraInputHandlers): void {
  const pointers = new Map<number, { x: number; y: number }>();
  let grabbing: number | null = null;
  const local = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const endGrab = () => {
    if (grabbing === null) return;
    grabbing = null;
    canvas.classList.remove('grabbing');
    handlers.onGrabEnd();
  };

  canvas.addEventListener('pointerdown', (e) => {
    const p = local(e);
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 0 && handlers.onGrabStart(p.x, p.y)) {
      grabbing = e.pointerId;
      canvas.classList.add('grabbing');
    } else {
      // A second finger turns a grab into a pinch.
      endGrab();
      canvas.classList.add('dragging');
    }
    pointers.set(e.pointerId, p);
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    const world = camera.toWorld(p.x, p.y);
    handlers.onCursor(world, p.x, p.y);
    if (e.pointerId === grabbing) {
      handlers.onGrabMove(world);
      return;
    }
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
    if (e.pointerId === grabbing) endGrab();
    if (pointers.size === 0) canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => {
    if (pointers.size === 0) handlers.onCursor(null, 0, 0);
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
