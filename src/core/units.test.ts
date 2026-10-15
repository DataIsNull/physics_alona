import { describe, expect, it } from 'vitest';
import { formatPercent, formatSI } from './units';

describe('formatSI', () => {
  it.each([
    [0, 'м', '0 м'],
    [1530, 'м', '1.53 км'],
    [0.016, 'с', '16 мс'],
    [999.96, 'м', '1 км'],
    [-2.5e-6, 'м', '-2.5 мкм'],
    [42, 'Дж', '42 Дж'],
    [1.5e20, 'м', '1.50e+20 м'],
    [Infinity, 'Дж', '∞ Дж'],
    [NaN, 'м', '— м'],
  ])('formatSI(%d, %s) = %s', (value, unit, expected) => {
    expect(formatSI(value, unit)).toBe(expected);
  });
});

describe('formatPercent', () => {
  it.each([
    [0, '0 %'],
    [0.0123, '+1.23 %'],
    [-0.5, '−50 %'],
    [1.2e-9, '+1.2e-7 %'],
    [NaN, '—'],
  ])('formatPercent(%d) = %s', (value, expected) => {
    expect(formatPercent(value)).toBe(expected);
  });
});
