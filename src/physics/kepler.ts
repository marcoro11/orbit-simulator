const DEG = Math.PI / 180;

export interface OrbitState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** Eccentricity is clamped below 1 — a parabolic orbit has no semi-major axis. */
export const MAX_ECCENTRICITY = 0.95;

/**
 * Position and velocity for a two-body orbit, from classical orbital elements.
 *
 * `mu` is the standard gravitational parameter G(M + m). Periapsis sits at the
 * ascending node (argument of periapsis = 0), which keeps the element set small
 * enough to drive from a handful of inputs; `nuDeg` is the true anomaly, i.e.
 * how far round the orbit the body starts.
 *
 * The result is relative to the parent — callers add the parent's own state.
 */
export function stateFromElements(
  mu: number,
  a: number,
  e: number,
  inclDeg: number,
  nodeDeg: number,
  nuDeg: number,
): OrbitState {
  const ecc = Math.min(Math.max(e, 0), MAX_ECCENTRICITY);
  const nu = nuDeg * DEG;

  // Perifocal frame: periapsis along +x, motion counter-clockwise.
  const p = a * (1 - ecc * ecc);
  const r = p / (1 + ecc * Math.cos(nu));
  const vs = Math.sqrt(mu / p);

  let px = r * Math.cos(nu);
  let py = r * Math.sin(nu);
  let pz = 0;
  let vx = -vs * Math.sin(nu);
  let vy = vs * (ecc + Math.cos(nu));
  let vz = 0;

  // Tilt about the node line (the x axis) …
  const ci = Math.cos(inclDeg * DEG);
  const si = Math.sin(inclDeg * DEG);
  [py, pz] = [py * ci, py * si];
  [vy, vz] = [vy * ci, vy * si];

  // … then swing the node line round to its longitude.
  const cn = Math.cos(nodeDeg * DEG);
  const sn = Math.sin(nodeDeg * DEG);
  [px, py] = [px * cn - py * sn, px * sn + py * cn];
  [vx, vy] = [vx * cn - vy * sn, vx * sn + vy * cn];

  return { x: px, y: py, z: pz, vx, vy, vz };
}

/** Orbital period in days, from Kepler's third law. */
export function orbitalPeriod(mu: number, a: number): number {
  return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
}

/** Speed at true anomaly `nuDeg`, via vis-viva. */
export function speedAt(mu: number, a: number, e: number, nuDeg: number): number {
  const ecc = Math.min(Math.max(e, 0), MAX_ECCENTRICITY);
  const p = a * (1 - ecc * ecc);
  const r = p / (1 + ecc * Math.cos(nuDeg * DEG));
  return Math.sqrt(mu * (2 / r - 1 / a));
}
