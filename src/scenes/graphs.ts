import type { Simulation } from '../core/simulation';
import { formatPercent, formatSI } from '../core/units';
import type { SeriesSpec } from '../render/graph';
import { theme } from '../render/theme';
import type { GraphSpec } from './types';

const joules = (v: number) => formatSI(v, 'Дж');

/**
 * Energy of the first world. With `losses`, also the heat dissipated so far
 * and the balance KE + PE + losses (minus work done by dragging), which stays
 * flat when the books add up.
 */
export function energyGraph(options: { potential?: boolean; losses?: boolean } = {}) {
  const { potential = true, losses = false } = options;
  return (): GraphSpec => {
    const series: SeriesSpec[] = [{ label: 'Кінетична', color: theme.series[0] }];
    if (potential) series.push({ label: 'Потенціальна', color: theme.series[1] });
    if (losses) {
      series.push({ label: 'Втрати', color: theme.series[3] });
      series.push({ label: 'Сума з втратами', color: theme.series[2] });
    } else {
      series.push({ label: 'Повна', color: theme.series[2] });
    }
    return {
      title: 'Енергія',
      series,
      format: joules,
      sample: ([world]) => {
        const kinetic = world.kineticEnergy();
        const pot = world.potentialEnergy();
        const values = [kinetic];
        if (potential) values.push(pot);
        if (losses) values.push(world.dissipated, world.energyBalance());
        else values.push(kinetic + pot);
        return values;
      },
    };
  };
}

/** One series per world, labelled and coloured like the world. */
export function perWorldGraph(title: string, format: (v: number) => string, value: (sim: Simulation) => number) {
  return (worlds: readonly Simulation[]): GraphSpec => ({
    title,
    series: worlds.map((w) => ({ label: w.label, color: w.color })),
    format,
    sample: (ws) => ws.map((w) => (w.diverged ? NaN : value(w))),
  });
}

/** Relative energy error of every world, for side-by-side comparisons. */
export const driftGraph = perWorldGraph('Зміна повної енергії ΔE/E₀', formatPercent, (w) => w.energyDrift());
