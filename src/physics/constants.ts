/**
 * Simulation unit system:
 *   length = AU (astronomical unit)
 *   mass   = M☉ (solar mass)
 *   time   = day
 *
 * Chosen so that everything interesting sits near 1: Earth's orbit has radius 1
 * and period 365.25, and the Sun has mass 1. Keeps floats well away from the
 * 1e30 / 1e11 range you'd get from SI, which makes eyeballing values possible.
 */

/** Gravitational constant in AU³ / (M☉ · day²). */
export const G = 2.959122082855911e-4;

export const DAYS_PER_YEAR = 365.25;

// Masses, in solar masses.
export const M_SUN = 1;
export const M_MERCURY = 1.66013e-7;
export const M_VENUS = 2.44783e-6;
export const M_EARTH = 3.00349e-6;
export const M_MOON = 3.69432e-8;
export const M_MARS = 3.22716e-7;
export const M_JUPITER = 9.54579e-4;
export const M_SATURN = 2.85886e-4;
export const M_URANUS = 4.36624e-5;
export const M_NEPTUNE = 5.15139e-5;

// Physical (not rendered) radii, in AU. Used only for collision detection.
export const R_SUN = 4.65047e-3;
export const R_MERCURY = 1.6310e-5;
export const R_VENUS = 4.0453e-5;
export const R_EARTH = 4.2635e-5;
export const R_MOON = 1.1614e-5;
export const R_MARS = 2.2708e-5;
export const R_JUPITER = 4.6733e-4;
export const R_SATURN = 3.8926e-4;
export const R_URANUS = 1.6953e-4;
export const R_NEPTUNE = 1.6459e-4;

/** 1 AU/day expressed in km/s — for human-readable speed readouts. */
export const AU_PER_DAY_IN_KM_S = 1731.4568;

export const KM_PER_AU = 1.495978707e8;

/**
 * Schwarzschild radius per solar mass, in AU: 2GM/c² works out to 2.953 km for
 * the Sun. A black hole's horizon is absurdly small next to its gravitational
 * reach — that contrast is the interesting part, so we use the real value.
 */
export const SCHWARZSCHILD_AU_PER_MSUN = 1.974e-8;
