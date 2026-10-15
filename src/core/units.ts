// Physics runs in SI units throughout; only rendering rescales.

/** Gravitational constant, m³·kg⁻¹·s⁻² (CODATA 2018). */
export const G = 6.674_30e-11;

/** Standard gravity at Earth's surface, m/s². */
export const STANDARD_GRAVITY = 9.806_65;

/** Degrees → radians. */
export const DEG = Math.PI / 180;

// Ukrainian SI prefix symbols, largest first.
const PREFIXES: ReadonlyArray<readonly [factor: number, symbol: string]> = [
  [1e12, 'Т'],
  [1e9, 'Г'],
  [1e6, 'М'],
  [1e3, 'к'],
  [1, ''],
  [1e-3, 'м'],
  [1e-6, 'мк'],
  [1e-9, 'н'],
  [1e-12, 'п'],
];

/**
 * Formats a value with an SI prefix and `digits` significant digits:
 * formatSI(1530, 'м') → "1.53 км", formatSI(0.016, 'с') → "16 мс".
 */
export function formatSI(value: number, unit: string, digits = 3): string {
  if (Number.isNaN(value)) return `— ${unit}`;
  if (!Number.isFinite(value)) return `${value > 0 ? '' : '−'}∞ ${unit}`;
  if (value === 0) return `0 ${unit}`;

  // Pick the prefix from the rounded magnitude so 999.96 becomes "1 к…", not "1000 …".
  const rounded = Number(Math.abs(value).toPrecision(digits));
  if (rounded >= 1e15 || rounded < 1e-12) return `${value.toExponential(digits - 1)} ${unit}`;

  const [factor, symbol] = PREFIXES.find(([f]) => rounded >= f)!;
  const scaled = Number((value / factor).toPrecision(digits));
  return `${scaled} ${symbol}${unit}`;
}

/** Signed percentage of a fraction: formatPercent(0.0123) → "+1.23 %". */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—';
  const p = fraction * 100;
  if (p === 0) return '0 %';
  const abs = Math.abs(p);
  const body = abs >= 0.01 && abs < 1e4 ? String(Number(abs.toPrecision(3))) : abs.toExponential(1);
  return `${p > 0 ? '+' : '−'}${body} %`;
}
