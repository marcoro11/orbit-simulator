import { BodySpec } from './physics/body';
import * as C from './physics/constants';
import { stateFromElements } from './physics/kepler';
import { World } from './physics/world';

export interface Preset {
  id: string;
  name: string;
  description: string;
  /** Suggested integration step, in days. */
  dt: number;
  stepsPerFrame: number;
  /** Suggested initial camera distance from the barycenter, in AU. */
  view: number;
  /** Suggested initial camera elevation above the ecliptic, in degrees. */
  elevation?: number;
  softening?: number;
  build(): BodySpec[];
}

/**
 * A circular orbit about a stationary central mass at the origin, specified the
 * way orbits actually are: semi-major axis, position along the orbit,
 * inclination to the ecliptic, and longitude of the ascending node.
 */
function orbit(
  centralMass: number,
  a: number,
  thetaDeg: number,
  inclDeg: number,
  nodeDeg: number,
  spec: Omit<BodySpec, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz'>,
): BodySpec {
  // Circular (e = 0), so the true anomaly is just the position along the orbit.
  return { ...spec, ...stateFromElements(C.G * centralMass, a, 0, inclDeg, nodeDeg, thetaDeg) };
}

const SUN: BodySpec = {
  name: 'Sun',
  color: '#ffd166',
  mass: C.M_SUN,
  radius: C.R_SUN,
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
};

// a (AU), position along orbit (°), inclination (°), ascending node (°) — the
// inclinations and nodes are the real ones, which is what makes the 3D view
// worth having: the planets genuinely do not share a plane.
const PLANETS: BodySpec[] = [
  orbit(C.M_SUN, 0.38710, 24, 7.005, 48.3, { name: 'Mercury', color: '#b9a48c', mass: C.M_MERCURY, radius: C.R_MERCURY }),
  orbit(C.M_SUN, 0.72333, 138, 3.395, 76.7, { name: 'Venus', color: '#e8c37a', mass: C.M_VENUS, radius: C.R_VENUS }),
  orbit(C.M_SUN, 1.00000, 261, 0.000, 0.0, { name: 'Earth', color: '#6fb7ff', mass: C.M_EARTH, radius: C.R_EARTH }),
  orbit(C.M_SUN, 1.52371, 74, 1.850, 49.6, { name: 'Mars', color: '#e2725b', mass: C.M_MARS, radius: C.R_MARS }),
  orbit(C.M_SUN, 5.20336, 310, 1.303, 100.5, { name: 'Jupiter', color: '#d9a066', mass: C.M_JUPITER, radius: C.R_JUPITER }),
  orbit(C.M_SUN, 9.53707, 190, 2.485, 113.7, { name: 'Saturn', color: '#e6d3a3', mass: C.M_SATURN, radius: C.R_SATURN }),
  orbit(C.M_SUN, 19.1913, 45, 0.773, 74.0, { name: 'Uranus', color: '#8fd6dd', mass: C.M_URANUS, radius: C.R_URANUS }),
  orbit(C.M_SUN, 30.0690, 225, 1.770, 131.8, { name: 'Neptune', color: '#5a7fe0', mass: C.M_NEPTUNE, radius: C.R_NEPTUNE }),
];

/**
 * Convert from the "natural" units used in the literature (G = 1, masses = 1)
 * into AU / M☉ / day, given a chosen mass and length scale.
 */
function fromNaturalUnits(specs: BodySpec[], massScale: number, lengthScale: number): BodySpec[] {
  const vScale = Math.sqrt((C.G * massScale) / lengthScale);
  return specs.map((s) => ({
    ...s,
    mass: s.mass * massScale,
    x: s.x * lengthScale,
    y: s.y * lengthScale,
    z: (s.z ?? 0) * lengthScale,
    vx: s.vx * vScale,
    vy: s.vy * vScale,
    vz: (s.vz ?? 0) * vScale,
  }));
}

export const PRESETS: Preset[] = [
  {
    id: 'empty',
    name: 'Empty — start from scratch',
    description:
      'Nothing here yet. Pick a body type below and press “Add to system” — with no parent to orbit, the first one is placed at the origin at rest. Everything after that can orbit it, or orbit each other.',
    dt: 0.5,
    stepsPerFrame: 8,
    view: 12,
    elevation: 25,
    build: () => [],
  },
  {
    id: 'solar',
    name: 'Solar System',
    description:
      'All eight planets with their real inclinations and nodes. Tilt the camera to the ecliptic and you can see they do not share a plane.',
    dt: 0.5,
    stepsPerFrame: 8,
    view: 78,
    elevation: 28,
    build: () => [SUN, ...PLANETS],
  },
  {
    id: 'inner',
    name: 'Inner Solar System',
    description: 'Mercury through Mars. Mercury’s 7° tilt is obvious from a low camera angle.',
    dt: 0.25,
    stepsPerFrame: 6,
    view: 5.5,
    elevation: 22,
    build: () => [SUN, ...PLANETS.slice(0, 4)],
  },
  {
    id: 'earth-moon',
    name: 'Sun · Earth · Moon',
    description: 'A hierarchical system: the Moon stays bound to Earth while Earth orbits the Sun.',
    dt: 0.02,
    stepsPerFrame: 24,
    view: 4.2,
    elevation: 25,
    build: () => {
      const earth = orbit(C.M_SUN, 1, 0, 0, 0, {
        name: 'Earth',
        color: '#6fb7ff',
        mass: C.M_EARTH,
        radius: C.R_EARTH,
      });
      const a = 2.5696e-3; // Moon's semi-major axis, AU
      const vMoon = Math.sqrt((C.G * C.M_EARTH) / a);
      const incl = (5.145 * Math.PI) / 180; // the Moon's orbit is tilted to the ecliptic
      return [
        SUN,
        earth,
        {
          name: 'Moon',
          color: '#d5d9e0',
          mass: C.M_MOON,
          radius: C.R_MOON,
          x: earth.x + a,
          y: earth.y,
          z: 0,
          vx: earth.vx,
          vy: earth.vy! + vMoon * Math.cos(incl),
          vz: vMoon * Math.sin(incl),
        },
      ];
    },
  },
  {
    id: 'inclined',
    name: 'Inclined Orbits',
    description:
      'One star, four planets at 0°, 35°, 70° and 110° to the reference plane — the last one is retrograde. All four are Jupiter-mass and packed close, so they visibly torque each other’s orbital planes over a few centuries.',
    dt: 0.5,
    stepsPerFrame: 8,
    view: 11,
    elevation: 20,
    build: () => [
      { ...SUN, name: 'Star' },
      orbit(C.M_SUN, 1.0, 0, 0, 0, { name: 'Ecliptic', color: '#6fb7ff', mass: C.M_JUPITER, radius: C.R_JUPITER }),
      orbit(C.M_SUN, 1.7, 90, 35, 20, { name: 'Tilted', color: '#7ee787', mass: C.M_JUPITER, radius: C.R_JUPITER }),
      orbit(C.M_SUN, 2.6, 180, 70, 120, { name: 'Polar', color: '#ffe66d', mass: C.M_JUPITER, radius: C.R_JUPITER }),
      orbit(C.M_SUN, 3.6, 270, 110, 220, { name: 'Retrograde', color: '#ff6b6b', mass: C.M_JUPITER, radius: C.R_JUPITER }),
    ],
  },
  {
    id: 'compact',
    name: 'Black Hole Binary',
    description:
      'A 10 M☉ black hole and a white star orbiting each other, with a white dwarf and a neutron star further out. Gravitationally the black hole is just a point mass — the star orbits it exactly as it would any 10 M☉ object.',
    dt: 0.05,
    stepsPerFrame: 10,
    view: 24,
    elevation: 22,
    build: () => {
      const mBh = 10;
      const mStar = 2;
      const total = mBh + mStar;
      const d = 1.6;
      const vRel = Math.sqrt((C.G * total) / d);
      return [
        {
          name: 'Black hole',
          color: '#0b0b12',
          bodyClass: 'blackhole',
          mass: mBh,
          radius: C.SCHWARZSCHILD_AU_PER_MSUN * mBh,
          displayScale: 0.5,
          x: (-d * mStar) / total, y: 0, z: 0,
          vx: 0, vy: (-vRel * mStar) / total, vz: 0,
        },
        {
          name: 'Companion',
          color: '#dbe6ff',
          bodyClass: 'star',
          mass: mStar,
          radius: C.R_SUN * 1.6,
          displayScale: 1.15,
          x: (d * mBh) / total, y: 0, z: 0,
          vx: 0, vy: (vRel * mBh) / total, vz: 0,
        },
        orbit(total, 7, 40, 12, 0, {
          name: 'White dwarf',
          color: '#eaf2ff',
          bodyClass: 'compact',
          mass: 0.6,
          radius: C.R_SUN * 0.013,
          displayScale: 0.34,
        }),
        orbit(total, 13, 200, 30, 70, {
          name: 'Neutron star',
          color: '#cfe8ff',
          bodyClass: 'compact',
          mass: 1.4,
          radius: 11 / C.KM_PER_AU,
          displayScale: 0.24,
        }),
      ];
    },
  },
  {
    id: 'figure8',
    name: 'Figure-Eight (3-body)',
    description:
      'The Chenciner–Montgomery solution: three equal masses chasing each other around a figure eight. Extremely sensitive to integration error — if it holds steady for many laps, the integrator is sound.',
    dt: 0.05,
    stepsPerFrame: 12,
    view: 4.5,
    elevation: 35,
    softening: 0,
    build: () => {
      // Canonical initial conditions in G = m = 1 units. Planar by construction.
      const x = 0.97000436;
      const y = -0.24308753;
      const vx3 = -0.93240737;
      const vy3 = -0.86473146;
      const natural: BodySpec[] = [
        { name: 'Alpha', color: '#ff6b6b', mass: 1, x: x, y: y, vx: -vx3 / 2, vy: -vy3 / 2 },
        { name: 'Beta', color: '#4ecdc4', mass: 1, x: -x, y: -y, vx: -vx3 / 2, vy: -vy3 / 2 },
        { name: 'Gamma', color: '#ffe66d', mass: 1, x: 0, y: 0, vx: vx3, vy: vy3 },
      ];
      // One solar mass each, one AU across → period works out near a year.
      return fromNaturalUnits(natural, 1, 1).map((s) => ({ ...s, radius: C.R_SUN }));
    },
  },
  {
    id: 'binary',
    name: 'Binary Star + Planet',
    description: 'Two stars 1 AU apart with a circumbinary planet at 4 AU, plus a distant inclined companion.',
    dt: 0.2,
    stepsPerFrame: 8,
    view: 34,
    elevation: 24,
    build: () => {
      const m1 = 1.1;
      const m2 = 0.85;
      const total = m1 + m2;
      const d = 1.0;
      const vRel = Math.sqrt((C.G * total) / d);
      // Each star orbits the barycenter; split separation and speed by mass ratio.
      return [
        {
          name: 'Star A',
          color: '#ffd166',
          mass: m1,
          radius: C.R_SUN * 1.1,
          x: (-d * m2) / total, y: 0, z: 0,
          vx: 0, vy: (-vRel * m2) / total, vz: 0,
        },
        {
          name: 'Star B',
          color: '#ff9f68',
          mass: m2,
          radius: C.R_SUN * 0.9,
          x: (d * m1) / total, y: 0, z: 0,
          vx: 0, vy: (vRel * m1) / total, vz: 0,
        },
        orbit(total, 4.0, 90, 0, 0, {
          name: 'Kepler-b',
          color: '#6fb7ff',
          mass: C.M_JUPITER,
          radius: C.R_JUPITER,
        }),
        orbit(total, 12.0, 200, 28, 60, {
          name: 'Outer world',
          color: '#a78bfa',
          mass: C.M_NEPTUNE,
          radius: C.R_NEPTUNE,
        }),
      ];
    },
  },
  {
    id: 'trojans',
    name: 'Jupiter Trojans (L4 / L5)',
    description:
      'Test bodies parked 60° ahead of and behind Jupiter. They should librate around the Lagrange points rather than drift away.',
    dt: 1,
    stepsPerFrame: 10,
    view: 26,
    elevation: 55,
    build: () => {
      const a = 5.20336;
      const jupiter = orbit(C.M_SUN, a, 0, 0, 0, {
        name: 'Jupiter',
        color: '#d9a066',
        mass: C.M_JUPITER,
        radius: C.R_JUPITER,
      });
      const trojan = (offsetDeg: number, name: string, color: string) =>
        orbit(C.M_SUN, a, offsetDeg, 0, 0, {
          name,
          color,
          mass: 1e-12, // effectively massless test particles
          radius: 1e-6,
        });
      const swarm: BodySpec[] = [];
      for (let i = 0; i < 5; i++) {
        swarm.push(trojan(60 + (i - 2) * 4, `Greek ${i + 1}`, '#7ee787'));
        swarm.push(trojan(-60 + (i - 2) * 4, `Trojan ${i + 1}`, '#f78166'));
      }
      return [SUN, jupiter, ...swarm];
    },
  },
  {
    id: 'chaos',
    name: 'Chaotic Cluster',
    description:
      'Fourteen random stars in a genuinely three-dimensional cloud. Ejections and mergers are the norm — rerun it and you get a different story every time.',
    dt: 0.4,
    stepsPerFrame: 6,
    view: 52,
    elevation: 18,
    softening: 2e-3,
    build: () => {
      const palette = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a78bfa', '#7ee787', '#f78166', '#6fb7ff', '#e8c37a'];
      const out: BodySpec[] = [];
      for (let i = 0; i < 14; i++) {
        // Uniform direction on the sphere, so the cloud has no preferred plane.
        const u = Math.random() * 2 - 1;
        const phi = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const r = 2 + Math.random() * 8;
        const px = r * s * Math.cos(phi);
        const py = r * s * Math.sin(phi);
        const pz = r * u;

        const mass = 0.2 + Math.random() * 1.4;
        // Give each star some angular momentum about a random axis, at roughly
        // the local circular speed, so the cloud swirls instead of collapsing.
        const ax = Math.random() * 2 - 1;
        const ay = Math.random() * 2 - 1;
        const az = Math.random() * 2 - 1;
        let cx = ay * pz - az * py;
        let cy = az * px - ax * pz;
        let cz = ax * py - ay * px;
        const cl = Math.hypot(cx, cy, cz) || 1;
        const speed = Math.sqrt((C.G * 8) / r) * (0.45 + Math.random() * 0.45);
        cx = (cx / cl) * speed;
        cy = (cy / cl) * speed;
        cz = (cz / cl) * speed;

        out.push({
          name: `Star ${i + 1}`,
          color: palette[i % palette.length],
          mass,
          radius: C.R_SUN * Math.cbrt(mass),
          x: px, y: py, z: pz,
          vx: cx, vy: cy, vz: cz,
        });
      }
      return out;
    },
  },
];

export function presetById(id: string): Preset {
  const found = PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown preset "${id}"`);
  return found;
}

export function loadPreset(world: World, preset: Preset): void {
  world.clear();
  world.softening = preset.softening ?? 1e-5;
  for (const spec of preset.build()) world.add(spec);
  world.zeroMomentum();
  world.computeAccelerations();
  world.referenceEnergy = world.energy().total;
}
