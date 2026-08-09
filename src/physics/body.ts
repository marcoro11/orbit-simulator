import { Trail } from './trail';

/**
 * How a body is drawn and lit. Physics treats every body identically — this is
 * purely a rendering distinction.
 *
 *   star       glows, casts light, wears a halo
 *   compact    white dwarfs and neutron stars: glowing but tiny and dim
 *   blackhole  no light at all, drawn as a void inside an accretion ring
 *   planet     lit by whatever stars are around
 */
export type BodyClass = 'star' | 'compact' | 'blackhole' | 'planet';

/**
 * A point mass in 3D. Units: mass M☉, position AU, velocity AU/day,
 * acceleration AU/day². The XY plane is the ecliptic; +Z is "north".
 */
export interface Body {
  id: number;
  name: string;
  color: string;
  bodyClass: BodyClass;
  mass: number;
  /** Physical radius in AU. Only used for collision detection, never rendering. */
  radius: number;
  /**
   * Multiplier on the drawn (non-physical) size, so a red giant reads as huge
   * and a neutron star as a speck even though drawn size is otherwise driven by
   * mass alone.
   */
  displayScale: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ax: number;
  ay: number;
  az: number;
  trail: Trail;
}

export interface BodySpec {
  name?: string;
  color?: string;
  bodyClass?: BodyClass;
  mass: number;
  radius?: number;
  displayScale?: number;
  x: number;
  y: number;
  z?: number;
  vx: number;
  vy: number;
  vz?: number;
}

/**
 * Radius estimate for a body of a given mass, assuming roughly rocky/gaseous
 * density. The fallback for bodies created without a catalog entry.
 */
export function estimateRadius(mass: number): number {
  // Anchored on Earth (3.0e-6 M☉ → 4.26e-5 AU) with a gentle exponent, so a
  // Jupiter comes out ~10x Earth and a star ~100x, which is about right.
  return 4.2635e-5 * Math.pow(mass / 3.00349e-6, 0.28);
}

/** Bodies from before the catalog existed are classified by mass alone. */
export function defaultClass(mass: number): BodyClass {
  return mass >= 0.02 ? 'star' : 'planet';
}
