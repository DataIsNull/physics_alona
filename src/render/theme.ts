/**
 * Dark theme shared by the simulation canvas and graphs. Keep in sync with
 * the CSS custom properties in style.css.
 */
export const theme = {
  surface: '#141413',
  ink: '#ffffff',
  inkSecondary: '#c3c2b7',
  inkMuted: '#898781',
  grid: '#262624',
  axis: '#45453f',
  /** Solid side of a wall. */
  wall: 'rgba(69, 69, 63, 0.35)',
  spring: '#898781',
  anchor: '#c3c2b7',
  ghost: 'rgba(255, 255, 255, 0.55)',
  velocity: '#c3c2b7',
  /**
   * Categorical slots in validated order (CVD-checked against the surface).
   * Assign in order, never cycle: a 9th identity needs a different encoding.
   */
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  font: '11px system-ui, -apple-system, "Segoe UI", sans-serif',
} as const;
