import { formatSI } from '../core/units';

export const CHARGE_NOTE =
  'Заряди: кожен крок — точний поворот швидкості в магнітному полі (півкроку), «удар — політ — удар» для електричних сил і ще пів повороту. Магнітне поле ніколи не змінює швидкості частинки.';
export const RAIL_NOTE = 'Рух стрижня — лінійне рівняння m·dv/dt = F − B²L²v/R; кожен крок бере його точний експоненційний розв’язок.';
export const FDTD_NOTE =
  'FDTD на сітці Йі: E і H зсунуті на пів клітинки й пів кроку і по черзі оновлюються законами Фарадея та Ампера–Максвелла. Крок — 0.9 від межі Куранта.';

export const energyUnit = (v: number) => formatSI(v, 'Дж');
export const lengthUnit = (v: number) => formatSI(v, 'м');
export const speedUnit = (v: number) => formatSI(v, 'м/с');
export const forceUnit = (v: number) => formatSI(v, 'Н');
