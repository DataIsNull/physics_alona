// Physics runs in SI units throughout; only rendering rescales.

/** Gravitational constant, m³·kg⁻¹·s⁻² (CODATA 2018). */
export const G = 6.674_30e-11;

/** Standard gravity at Earth's surface, m/s². */
export const STANDARD_GRAVITY = 9.806_65;

/** Density of air at sea level and 15 °C, kg/m³. */
export const AIR_DENSITY = 1.225;

/** Degrees → radians. */
export const DEG = Math.PI / 180;

/** Speed of light in vacuum, m/s (exact). */
export const SPEED_OF_LIGHT = 299_792_458;

/** Astronomical unit, m (exact, IAU 2012). */
export const AU = 1.495_978_707e11;

/** Mean solar day, s. */
export const DAY = 86_400;

/** Julian year, s. */
export const YEAR = 365.25 * DAY;

/** Kiloparsec, m. */
export const KPC = 3.085_677_581e19;

/** Solar mass, kg (IAU nominal GM☉ / G). */
export const SOLAR_MASS = 1.988_47e30;

/** A display unit for lengths; physics stays in metres. */
export interface LengthUnit {
  symbol: string;
  metres: number;
}

export const METRES: LengthUnit = { symbol: 'м', metres: 1 };
export const ASTRONOMICAL_UNITS: LengthUnit = { symbol: 'а.о.', metres: AU };
export const KILOPARSECS: LengthUnit = { symbol: 'кпк', metres: KPC };

/** Formats a length in `unit`; metres get SI prefixes, other units plain numbers. */
export function formatLength(metres: number, unit: LengthUnit = METRES, digits = 3): string {
  if (unit.metres === 1) return formatSI(metres, unit.symbol, digits);
  const v = metres / unit.metres;
  if (!Number.isFinite(v)) return `— ${unit.symbol}`;
  const abs = Math.abs(v);
  const rounded = Number(v.toPrecision(digits));
  const body = abs === 0 || (abs >= 1e-3 && abs < 1e6) ? String(rounded) : rounded.toExponential(); // "3.98e-4", "1e-6"
  return `${body} ${unit.symbol}`;
}

/** Calendar-ish units for long durations, largest first. */
export const TIME_UNITS: ReadonlyArray<readonly [seconds: number, symbol: string]> = [
  [1e9 * YEAR, 'млрд р.'],
  [1e6 * YEAR, 'млн р.'],
  [1e3 * YEAR, 'тис. р.'],
  [YEAR, 'р.'],
  [DAY, 'доб.'],
  [3600, 'год'],
  [60, 'хв'],
];

/** Formats a duration: SI seconds below a minute, then minutes, hours, days, years. */
export function formatDuration(seconds: number, digits = 3): string {
  const abs = Math.abs(seconds);
  if (!Number.isFinite(seconds) || abs < 60) return formatSI(seconds, 'с', digits);
  const [factor, symbol] = TIME_UNITS.find(([f]) => abs >= f)!;
  return `${Number((seconds / factor).toPrecision(digits))} ${symbol}`;
}

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
