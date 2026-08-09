import { BodyClass, estimateRadius } from './physics/body';
import * as C from './physics/constants';

export type MassUnit = 'earth' | 'jupiter' | 'solar';

export const MASS_UNITS: Record<MassUnit, { label: string; inSolar: number }> = {
  earth: { label: 'M⊕', inSolar: C.M_EARTH },
  jupiter: { label: 'M♃', inSolar: C.M_JUPITER },
  solar: { label: 'M☉', inSolar: 1 },
};

export interface BodyType {
  id: string;
  label: string;
  group: string;
  color: string;
  bodyClass: BodyClass;
  /** Default mass in solar masses. */
  mass: number;
  /** Unit the mass box should show for this type. */
  unit: MassUnit;
  /** Multiplier on drawn size, so size classes stay distinguishable. */
  displayScale: number;
  /** Physical radius in AU, as a function of mass — used for collisions. */
  radius: (mass: number) => number;
  note: string;
}

const R_SUN = C.R_SUN;

/**
 * Main-sequence mass–radius relation, roughly R ∝ M^0.8 below a solar mass and
 * R ∝ M^0.57 above it. Not precise stellar structure, but it puts red dwarfs
 * and blue giants in the right ballpark.
 */
const mainSequenceRadius = (m: number): number =>
  R_SUN * (m <= 1 ? Math.pow(m, 0.8) : Math.pow(m, 0.57));

export const BODY_TYPES: BodyType[] = [
  // ---- Stars ----
  {
    id: 'red-dwarf',
    label: 'Red dwarf (M)',
    group: 'Stars',
    color: '#ff7b54',
    bodyClass: 'star',
    mass: 0.25,
    unit: 'solar',
    displayScale: 0.75,
    radius: mainSequenceRadius,
    note: 'The most common star there is. Dim, cool, and burns for trillions of years.',
  },
  {
    id: 'orange-dwarf',
    label: 'Orange dwarf (K)',
    group: 'Stars',
    color: '#ffab5e',
    bodyClass: 'star',
    mass: 0.75,
    unit: 'solar',
    displayScale: 0.9,
    radius: mainSequenceRadius,
    note: 'A little cooler than the Sun; often cited as the best host for life.',
  },
  {
    id: 'yellow-dwarf',
    label: 'Yellow dwarf (G) — Sun-like',
    group: 'Stars',
    color: '#ffd166',
    bodyClass: 'star',
    mass: 1,
    unit: 'solar',
    displayScale: 1,
    radius: mainSequenceRadius,
    note: 'The Sun. 1 M☉ at 1 AU gives a 365-day year, by construction.',
  },
  {
    id: 'white-star',
    label: 'White star (A)',
    group: 'Stars',
    color: '#dbe6ff',
    bodyClass: 'star',
    mass: 2,
    unit: 'solar',
    displayScale: 1.15,
    radius: mainSequenceRadius,
    note: 'Hot and bright — think Sirius A or Vega.',
  },
  {
    id: 'blue-giant',
    label: 'Blue giant (B/O)',
    group: 'Stars',
    color: '#8fb8ff',
    bodyClass: 'star',
    mass: 15,
    unit: 'solar',
    displayScale: 1.5,
    radius: mainSequenceRadius,
    note: 'Enormously massive and short-lived. Dominates anything it is put near.',
  },
  {
    id: 'red-giant',
    label: 'Red giant',
    group: 'Stars',
    color: '#ff6b5b',
    bodyClass: 'star',
    mass: 1.2,
    unit: 'solar',
    displayScale: 2.6,
    radius: () => R_SUN * 50,
    note: 'Only slightly more massive than the Sun, but ~50× wider — its surface would reach past Mercury.',
  },
  // ---- Compact objects ----
  {
    id: 'white-dwarf',
    label: 'White dwarf',
    group: 'Compact objects',
    color: '#eaf2ff',
    bodyClass: 'compact',
    mass: 0.6,
    unit: 'solar',
    displayScale: 0.34,
    radius: () => R_SUN * 0.013,
    note: 'A dead stellar core: about the mass of the Sun packed into the size of Earth.',
  },
  {
    id: 'neutron-star',
    label: 'Neutron star',
    group: 'Compact objects',
    color: '#cfe8ff',
    bodyClass: 'compact',
    mass: 1.4,
    unit: 'solar',
    displayScale: 0.24,
    radius: () => 11 / C.KM_PER_AU, // ~11 km
    note: '1.4 M☉ inside a 22 km ball. A teaspoon of it would weigh a billion tonnes.',
  },
  {
    id: 'black-hole',
    label: 'Black hole (stellar)',
    group: 'Compact objects',
    color: '#0b0b12',
    bodyClass: 'blackhole',
    mass: 10,
    unit: 'solar',
    displayScale: 0.5,
    radius: (m) => C.SCHWARZSCHILD_AU_PER_MSUN * m,
    note: 'Gravitationally it is just a 10 M☉ point mass — an orbit at 1 AU is identical to one around a 10 M☉ star. The difference only appears within ~30 km.',
  },
  {
    id: 'supermassive',
    label: 'Black hole (supermassive)',
    group: 'Compact objects',
    color: '#0b0b12',
    bodyClass: 'blackhole',
    mass: 4.3e6,
    unit: 'solar',
    displayScale: 0.6,
    radius: (m) => C.SCHWARZSCHILD_AU_PER_MSUN * m,
    note: 'Sagittarius A*, at the centre of our galaxy. Its horizon is 0.08 AU across — put a star in a tight orbit and watch it whip round.',
  },
  // ---- Planets & smaller ----
  {
    id: 'brown-dwarf',
    label: 'Brown dwarf',
    group: 'Planets & smaller',
    color: '#8c5a4a',
    bodyClass: 'planet',
    mass: 0.05,
    unit: 'jupiter',
    displayScale: 0.9,
    radius: () => C.R_JUPITER,
    note: 'Too heavy to be a planet, too light to fuse hydrogen. Barely glows.',
  },
  {
    id: 'gas-giant',
    label: 'Gas giant',
    group: 'Planets & smaller',
    color: '#d9a066',
    bodyClass: 'planet',
    mass: C.M_JUPITER,
    unit: 'jupiter',
    displayScale: 1,
    radius: () => C.R_JUPITER,
    note: 'Jupiter-class. Massive enough to shape everything else in the system.',
  },
  {
    id: 'ice-giant',
    label: 'Ice giant',
    group: 'Planets & smaller',
    color: '#5a7fe0',
    bodyClass: 'planet',
    mass: C.M_NEPTUNE,
    unit: 'earth',
    displayScale: 1,
    radius: () => C.R_NEPTUNE,
    note: 'Neptune-class — about 17 Earth masses.',
  },
  {
    id: 'super-earth',
    label: 'Super-Earth',
    group: 'Planets & smaller',
    color: '#7ee787',
    bodyClass: 'planet',
    mass: 5 * C.M_EARTH,
    unit: 'earth',
    displayScale: 1,
    radius: (m) => estimateRadius(m),
    note: 'A rocky world several times Earth’s mass. The most common kind found so far.',
  },
  {
    id: 'terrestrial',
    label: 'Terrestrial planet',
    group: 'Planets & smaller',
    color: '#6fb7ff',
    bodyClass: 'planet',
    mass: C.M_EARTH,
    unit: 'earth',
    displayScale: 1,
    radius: () => C.R_EARTH,
    note: 'Earth-class.',
  },
  {
    id: 'moon',
    label: 'Moon',
    group: 'Planets & smaller',
    color: '#d5d9e0',
    bodyClass: 'planet',
    mass: C.M_MOON,
    unit: 'earth',
    displayScale: 1,
    radius: () => C.R_MOON,
    note: 'Put one in orbit around a planet rather than the star.',
  },
  {
    id: 'asteroid',
    label: 'Asteroid',
    group: 'Planets & smaller',
    color: '#b9a48c',
    bodyClass: 'planet',
    mass: 1e-10,
    unit: 'earth',
    displayScale: 1,
    radius: (m) => estimateRadius(m),
    note: 'Light enough to be a test particle — it feels the system without disturbing it.',
  },
];

export function typeById(id: string): BodyType {
  return BODY_TYPES.find((t) => t.id === id) ?? BODY_TYPES[2];
}

/** "Yellow dwarf (G) — Sun-like" → "Yellow dwarf", for naming created bodies. */
export function shortLabel(type: BodyType): string {
  return type.label.split(/\s*[(—]/)[0].trim();
}
