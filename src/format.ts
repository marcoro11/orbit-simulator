import { AU_PER_DAY_IN_KM_S, DAYS_PER_YEAR, M_EARTH, M_JUPITER } from './physics/constants';

function trim(v: number): string {
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2).replace(/\.?0+$/, '');
}

/** Distances read better in AU far out and km up close. */
export function formatAu(au: number): string {
  if (au >= 1) return `${trim(au)} AU`;
  const km = au * 1.495978707e8;
  if (km >= 1e6) return `${trim(km / 1e6)}M km`;
  if (km >= 1000) return `${trim(km / 1000)}k km`;
  return `${trim(km)} km`;
}

/** Pick whichever of solar / Jupiter / Earth masses keeps the number near 1. */
export function formatMass(m: number): string {
  if (m >= 0.02) return `${m.toFixed(m >= 10 ? 1 : 3)} M☉`;
  if (m / M_JUPITER >= 0.1) return `${(m / M_JUPITER).toFixed(2)} M♃`;
  if (m / M_EARTH >= 1e-3) return `${(m / M_EARTH).toFixed(m / M_EARTH >= 10 ? 1 : 3)} M⊕`;
  return `${m.toExponential(2)} M☉`;
}

export function formatSpeed(auPerDay: number): string {
  const kms = auPerDay * AU_PER_DAY_IN_KM_S;
  if (kms >= 1) return `${kms.toFixed(2)} km/s`;
  return `${(kms * 1000).toFixed(1)} m/s`;
}

export function formatDuration(days: number): string {
  if (days < 400) return `${days.toFixed(1)} d`;
  const years = days / DAYS_PER_YEAR;
  if (years >= 10000) return `${(years / 1000).toFixed(1)}k yr`;
  return `${years.toFixed(2)} yr`;
}

export function formatDays(days: number): string {
  if (days >= 1) return `${days.toFixed(2)} d`;
  const hours = days * 24;
  if (hours >= 1) return `${hours.toFixed(2)} h`;
  return `${(hours * 60).toFixed(1)} min`;
}
