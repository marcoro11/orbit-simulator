/**
 * Physics regression tests.
 *
 * The point of these is that an orbit simulator is checkable: gravity has known
 * closed-form answers (Kepler), known exact solutions (the figure eight), and
 * hard conservation laws (energy, momentum). If the integrator is wrong, these
 * fail loudly instead of the sim just "looking a bit off".
 *
 *   npm test
 */
import { World } from '../src/physics/world';
import * as C from '../src/physics/constants';
import { orbitalPeriod, stateFromElements } from '../src/physics/kepler';
import { BODY_TYPES, typeById } from '../src/catalog';
import { PRESETS, loadPreset } from '../src/presets';

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label.padEnd(48)} ${detail}`);
  if (!ok) failures++;
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const load = (id: string): World => {
  const w = new World();
  loadPreset(w, PRESETS.find((p) => p.id === id)!);
  return w;
};
const run = (w: World, years: number, dt: number): void => {
  const steps = Math.round((years * C.DAYS_PER_YEAR) / dt);
  for (let i = 0; i < steps; i++) w.step(dt);
};

// ---------------------------------------------------------------------------
section('Integrator');

{
  const w = new World();
  w.softening = 0;
  w.mergeOnCollision = false;
  w.add({ mass: C.M_SUN, x: 0, y: 0, vx: 0, vy: 0 });
  w.add({ mass: C.M_EARTH, x: 1, y: 0, vx: 0, vy: Math.sqrt(C.G * C.M_SUN) });
  w.zeroMomentum();
  w.computeAccelerations();
  const e0 = w.energy().total;

  let rMin = Infinity;
  let rMax = 0;
  const dt = 0.5;
  for (let i = 0; i < Math.round((100 * C.DAYS_PER_YEAR) / dt); i++) {
    w.step(dt);
    const [s, e] = w.bodies;
    const r = Math.hypot(e.x - s.x, e.y - s.y);
    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
  }
  const drift = Math.abs((w.energy().total - e0) / e0);
  check('circular orbit holds radius for 100 yr', rMax - rMin < 1e-4, `r ∈ [${rMin.toFixed(6)}, ${rMax.toFixed(6)}] AU`);
  check('energy drift over 100 yr', drift < 1e-6, `|ΔE/E| = ${drift.toExponential(2)}`);

  // For contrast: the same orbit under explicit Euler, which is not symplectic.
  let x = 1, y = 0, vx = 0, vy = Math.sqrt(C.G * C.M_SUN);
  const E0 = 0.5 * (vx * vx + vy * vy) - C.G * C.M_SUN;
  for (let i = 0; i < Math.round((100 * C.DAYS_PER_YEAR) / dt); i++) {
    const r = Math.hypot(x, y);
    const a = -(C.G * C.M_SUN) / (r * r * r);
    x += vx * dt; y += vy * dt;
    vx += a * x * dt; vy += a * y * dt;
  }
  const eulerE = 0.5 * (vx * vx + vy * vy) - (C.G * C.M_SUN) / Math.hypot(x, y);
  const eulerDrift = Math.abs((eulerE - E0) / E0);
  check('leapfrog beats explicit Euler by >1000x', drift * 1000 < eulerDrift, `Euler |ΔE/E| = ${eulerDrift.toExponential(2)}`);
}

// ---------------------------------------------------------------------------
section("Kepler's third law (T² ∝ a³)");

for (const a of [0.4, 1.0, 5.2, 19.2]) {
  const w = new World();
  w.softening = 0;
  w.mergeOnCollision = false;
  w.add({ mass: C.M_SUN, x: 0, y: 0, vx: 0, vy: 0 });
  w.add({ mass: 1e-12, x: a, y: 0, vx: 0, vy: Math.sqrt((C.G * C.M_SUN) / a) });
  w.computeAccelerations();

  const dt = a < 1 ? 0.05 : 0.5;
  let t = 0;
  let period = 0;
  for (let i = 0; i < 4_000_000; i++) {
    const before = w.bodies[1].y;
    w.step(dt);
    t += dt;
    const after = w.bodies[1].y;
    if (i > 10 && before < 0 && after >= 0) {
      period = t - dt * (after / (after - before)); // interpolate the crossing
      break;
    }
  }
  const expected = 2 * Math.PI * Math.sqrt(a ** 3 / (C.G * C.M_SUN));
  const err = Math.abs(period - expected) / expected;
  check(`a = ${a} AU`, err < 1e-4, `T = ${period.toFixed(2)} d vs ${expected.toFixed(2)} d (${(err * 100).toExponential(1)} %)`);
}

// ---------------------------------------------------------------------------
section('Known exact solutions');

{
  const w = load('figure8');
  w.mergeOnCollision = false;
  const start = w.bodies.map((b) => ({ x: b.x, y: b.y }));
  const e0 = w.energy().total;

  const period = 6.32591398 * Math.sqrt(1 / C.G); // natural-unit period, rescaled
  const laps = 20;
  const dt = 0.02;
  for (let i = 0; i < Math.round((period * laps) / dt); i++) w.step(dt);

  const offset = Math.max(...w.bodies.map((b, i) => Math.hypot(b.x - start[i].x, b.y - start[i].y)));
  const drift = Math.abs((w.energy().total - e0) / e0);
  check(`figure-8 returns to start after ${laps} laps`, offset < 0.02, `max offset ${offset.toExponential(2)} AU`);
  check('figure-8 energy drift', drift < 1e-6, `|ΔE/E| = ${drift.toExponential(2)}`);
}

{
  // Trojans should execute tadpole libration around L4/L5, not drift off.
  const w = load('trojans');
  const jup = w.bodies.find((b) => b.name === 'Jupiter')!;
  const tests = w.bodies.filter((b) => /^(Greek|Trojan)/.test(b.name));
  let worstAngle = 0;
  let worstRadius = 0;
  for (let i = 0; i < Math.round(300 * C.DAYS_PER_YEAR); i++) {
    w.step(1);
    if (i % 200) continue;
    const ja = Math.atan2(jup.y, jup.x);
    for (const t of tests) {
      const target = t.name.startsWith('Greek') ? 60 : -60;
      let rel = ((Math.atan2(t.y, t.x) - ja) * 180) / Math.PI;
      rel = ((rel + 540) % 360) - 180;
      worstAngle = Math.max(worstAngle, Math.abs(rel - target));
      worstRadius = Math.max(worstRadius, Math.abs(Math.hypot(t.x, t.y) - 5.20336));
    }
  }
  check('trojans librate near L4/L5 for 300 yr', worstAngle < 40, `max excursion ${worstAngle.toFixed(1)}° from ±60°`);
  check('trojans hold Jupiter’s orbital radius', worstRadius < 0.6, `max Δr ${worstRadius.toFixed(3)} AU`);
}

// ---------------------------------------------------------------------------
section('Orbital elements (the builder’s maths)');

{
  // An eccentric orbit must actually reach the periapsis and apoapsis the
  // builder promises, and come back with the stated period.
  for (const e of [0, 0.3, 0.6, 0.9]) {
    const w = new World();
    w.softening = 0;
    w.mergeOnCollision = false;
    w.add({ mass: C.M_SUN, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    const a = 2;
    const mu = C.G * C.M_SUN;
    w.add({ mass: 1e-12, ...stateFromElements(mu, a, e, 0, 0, 0) });
    w.computeAccelerations();

    const period = orbitalPeriod(mu, a);
    // Periapsis passage gets faster as e grows, so a fair test of the *elements*
    // has to resolve it — otherwise this measures step size, not the maths.
    const steps = Math.round(20000 * Math.pow((1 + e) / (1 - e), 1.2));
    const dt = period / steps;
    let rMin = Infinity;
    let rMax = 0;
    for (let i = 0; i < steps; i++) {
      w.step(dt);
      const b = w.bodies[1];
      const r = Math.hypot(b.x, b.y, b.z);
      rMin = Math.min(rMin, r);
      rMax = Math.max(rMax, r);
    }
    const periErr = Math.abs(rMin - a * (1 - e)) / a;
    const apoErr = Math.abs(rMax - a * (1 + e)) / a;
    check(`e = ${e}: peri/apo match a(1∓e)`, periErr < 1e-4 && apoErr < 1e-4, `peri ${rMin.toFixed(5)} vs ${(a * (1 - e)).toFixed(5)}, apo ${rMax.toFixed(5)} vs ${(a * (1 + e)).toFixed(5)}`);

    // After exactly one period it should be back where it started.
    const b = w.bodies[1];
    const back = Math.hypot(b.x - a * (1 - e), b.y, b.z);
    check(`e = ${e}: returns after one period`, back < 2e-3, `offset ${back.toExponential(2)} AU`);
  }
}

{
  // Leapfrog is second order, so quartering the step should cut the error ~16×.
  // Confirming that is what lets us say a large error on an eccentric orbit is
  // step size and not a broken force law — and it's why the builder warns when
  // the current step is too coarse for the orbit being added.
  const e = 0.9;
  const a = 2;
  const mu = C.G * C.M_SUN;
  const period = orbitalPeriod(mu, a);

  const apoError = (steps: number): number => {
    const w = new World();
    w.softening = 0;
    w.mergeOnCollision = false;
    w.add({ mass: C.M_SUN, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    w.add({ mass: 1e-12, ...stateFromElements(mu, a, e, 0, 0, 0) });
    w.computeAccelerations();
    let rMax = 0;
    for (let i = 0; i < steps; i++) {
      w.step(period / steps);
      const b = w.bodies[1];
      rMax = Math.max(rMax, Math.hypot(b.x, b.y, b.z));
    }
    return Math.abs(rMax - a * (1 + e));
  };

  const coarse = apoError(20000);
  const fine = apoError(80000);
  const ratio = coarse / fine;
  check('error falls as dt² (4× finer step ⇒ ~16× less error)', ratio > 12 && ratio < 20, `${coarse.toExponential(2)} → ${fine.toExponential(2)} AU (${ratio.toFixed(1)}×)`);
}

{
  // Inclination and node must survive the element → state → element round trip.
  const mu = C.G;
  const s = stateFromElements(mu, 3, 0.4, 47, 130, 0);
  const lx = s.y * s.vz - s.z * s.vy;
  const ly = s.z * s.vx - s.x * s.vz;
  const lz = s.x * s.vy - s.y * s.vx;
  const incl = (Math.acos(lz / Math.hypot(lx, ly, lz)) * 180) / Math.PI;
  // Ascending node direction is L × ẑ rotated; recover it from the node vector.
  const node = (Math.atan2(lx, -ly) * 180) / Math.PI;
  check('inclination round-trips', Math.abs(incl - 47) < 1e-9, `i = ${incl.toFixed(9)}°`);
  check('ascending node round-trips', Math.abs(((node - 130 + 540) % 360) - 180) < 1e-9, `Ω = ${node.toFixed(6)}°`);
}

// ---------------------------------------------------------------------------
section('Body catalog');

{
  // A black hole's horizon should be the real Schwarzschild radius: tiny next to
  // its gravitational reach. That contrast is the point of including it.
  const bh = typeById('black-hole');
  const rs = bh.radius(bh.mass);
  const km = rs * C.KM_PER_AU;
  check('10 M☉ black hole horizon ≈ 30 km', Math.abs(km - 29.5) < 0.5, `${km.toFixed(1)} km (${rs.toExponential(2)} AU)`);

  // Same mass, same orbit — the horizon is irrelevant at any sane distance.
  const star = 10;
  const vBh = Math.sqrt((C.G * bh.mass) / 1);
  const vStar = Math.sqrt((C.G * star) / 1);
  check('black hole pulls exactly like an equal-mass star', Math.abs(vBh - vStar) < 1e-15, `v = ${vBh.toFixed(6)} AU/day either way`);

  const ns = typeById('neutron-star');
  check('neutron star radius ≈ 11 km', Math.abs(ns.radius(ns.mass) * C.KM_PER_AU - 11) < 0.1, `${(ns.radius(ns.mass) * C.KM_PER_AU).toFixed(1)} km`);

  const giant = typeById('red-giant');
  check('red giant is ~50 R☉ wide', Math.abs(giant.radius(giant.mass) / C.R_SUN - 50) < 0.1, `${(giant.radius(giant.mass) / C.R_SUN).toFixed(1)} R☉`);

  // Every catalog entry must produce a positive, finite radius at its own mass.
  const bad = BODY_TYPES.filter((t) => !(t.radius(t.mass) > 0) || !Number.isFinite(t.radius(t.mass)));
  check('all catalog radii are positive and finite', bad.length === 0, `${BODY_TYPES.length} types checked`);
}

// ---------------------------------------------------------------------------
section('Conservation laws');

{
  const w = load('solar');
  const com0 = w.centerOfMass();
  run(w, 54, 0.5);
  const com1 = w.centerOfMass();
  const p = w.bodies.reduce(
    (acc, b) => ({
      x: acc.x + b.mass * b.vx,
      y: acc.y + b.mass * b.vy,
      z: acc.z + b.mass * b.vz,
    }),
    { x: 0, y: 0, z: 0 },
  );
  const comDrift = Math.hypot(com1.x - com0.x, com1.y - com0.y, com1.z - com0.z);
  const momentum = Math.hypot(p.x, p.y, p.z);
  check('solar system net momentum stays zero', momentum < 1e-16, `|p| = ${momentum.toExponential(2)}`);
  check('solar system barycenter stays put', comDrift < 1e-9, `drift ${comDrift.toExponential(2)} AU`);
}

{
  // Angular momentum is the 3D conservation law; if the out-of-plane force
  // components were wrong, Lx and Ly would drift even while Lz looked fine.
  const w = load('solar');
  const L = (): [number, number, number] =>
    w.bodies.reduce<[number, number, number]>(
      (acc, b) => [
        acc[0] + b.mass * (b.y * b.vz - b.z * b.vy),
        acc[1] + b.mass * (b.z * b.vx - b.x * b.vz),
        acc[2] + b.mass * (b.x * b.vy - b.y * b.vx),
      ],
      [0, 0, 0],
    );
  const l0 = L();
  run(w, 200, 0.5);
  const l1 = L();
  const rel = Math.hypot(l1[0] - l0[0], l1[1] - l0[1], l1[2] - l0[2]) / Math.hypot(...l0);
  check('total angular momentum conserved (3D)', rel < 1e-12, `|ΔL/L| = ${rel.toExponential(2)}`);
}

{
  const w = new World();
  w.softening = 0;
  w.add({ mass: 1e-5, radius: 0.05, x: -1, y: 0, vx: 0.01, vy: 0 });
  w.add({ mass: 3e-5, radius: 0.05, x: 1, y: 0, vx: -0.004, vy: 0 });
  const m0 = w.totalMass();
  const p0 = 1e-5 * 0.01 + 3e-5 * -0.004;
  for (let i = 0; i < 4000; i++) w.step(0.5);
  const p = w.bodies.reduce((s, b) => s + b.mass * b.vx, 0);
  check('collision merges the pair', w.bodies.length === 1, `${w.bodies.length} body remaining`);
  check('merge conserves mass', Math.abs(w.totalMass() - m0) < 1e-18, `Δm = ${(w.totalMass() - m0).toExponential(2)}`);
  check('merge conserves momentum', Math.abs(p - p0) < 1e-18, `Δp = ${Math.abs(p - p0).toExponential(2)}`);
}

// ---------------------------------------------------------------------------
section('Inclined orbits');

{
  // Each planet's orbital plane should hold its tilt: for a two-body-dominated
  // orbit the angular momentum vector is fixed, so the inclination is too.
  const w = load('inclined');
  const star = w.bodies.find((b) => b.name === 'Star')!;
  const expected: Record<string, number> = { Ecliptic: 0, Tilted: 35, Polar: 70, Retrograde: 110 };
  const inclination = (name: string): number => {
    const b = w.bodies.find((x) => x.name === name)!;
    const rx = b.x - star.x, ry = b.y - star.y, rz = b.z - star.z;
    const vx = b.vx - star.vx, vy = b.vy - star.vy, vz = b.vz - star.vz;
    const lx = ry * vz - rz * vy;
    const ly = rz * vx - rx * vz;
    const lz = rx * vy - ry * vx;
    return (Math.acos(lz / Math.hypot(lx, ly, lz)) * 180) / Math.PI;
  };

  for (const name of Object.keys(expected)) {
    check(`${name} starts at ${expected[name]}°`, Math.abs(inclination(name) - expected[name]) < 0.01, `i = ${inclination(name).toFixed(3)}°`);
  }

  // These are four Jupiter-mass planets between 1 and 3.6 AU, so they torque
  // each other's orbital planes for real: individual inclinations precess by
  // ~12° per 400 yr. That drift scales linearly with planet mass and does not
  // change at all when dt is cut 10x, which is how we know it's dynamics and
  // not integration error. What must hold exactly is the *total* angular
  // momentum, and that the precession stays bounded rather than running away.
  const L = (): [number, number, number] =>
    w.bodies.reduce<[number, number, number]>(
      (acc, b) => [
        acc[0] + b.mass * (b.y * b.vz - b.z * b.vy),
        acc[1] + b.mass * (b.z * b.vx - b.x * b.vz),
        acc[2] + b.mass * (b.x * b.vy - b.y * b.vx),
      ],
      [0, 0, 0],
    );
  const l0 = L();
  run(w, 400, 0.5);
  const l1 = L();
  const rel = Math.hypot(l1[0] - l0[0], l1[1] - l0[1], l1[2] - l0[2]) / Math.hypot(...l0);
  check('total angular momentum exactly conserved', rel < 1e-12, `|ΔL/L| = ${rel.toExponential(2)}`);

  let worst = 0;
  for (const name of Object.keys(expected)) {
    worst = Math.max(worst, Math.abs(inclination(name) - expected[name]));
  }
  check('mutual precession stays bounded (<25°)', worst < 25, `max excursion ${worst.toFixed(2)}° after 400 yr`);

  // "Retrograde" must actually orbit backwards: i > 90° means Lz < 0.
  const retro = w.bodies.find((b) => b.name === 'Retrograde')!;
  const lz = (retro.x - star.x) * (retro.vy - star.vy) - (retro.y - star.y) * (retro.vx - star.vx);
  check('retrograde planet has negative Lz', lz < 0, `Lz = ${lz.toExponential(2)}`);
}

// ---------------------------------------------------------------------------
section('Preset stability');

{
  const w = load('earth-moon');
  const earth = w.bodies.find((b) => b.name === 'Earth')!;
  const moon = w.bodies.find((b) => b.name === 'Moon')!;
  let rMin = Infinity;
  let rMax = 0;
  for (let i = 0; i < Math.round((60 * C.DAYS_PER_YEAR) / 0.02); i++) {
    w.step(0.02);
    const r = Math.hypot(moon.x - earth.x, moon.y - earth.y);
    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
  }
  check('Moon stays bound to Earth for 60 yr', rMin > 1.5e-3 && rMax < 4.5e-3, `r ∈ [${rMin.toExponential(3)}, ${rMax.toExponential(3)}] AU`);
}

{
  const w = load('binary');
  const planet = w.bodies.find((b) => b.name === 'Kepler-b')!;
  let rMin = Infinity;
  let rMax = 0;
  for (let i = 0; i < Math.round((300 * C.DAYS_PER_YEAR) / 0.2); i++) {
    w.step(0.2);
    const r = Math.hypot(planet.x, planet.y);
    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
  }
  check('circumbinary planet survives 300 yr', rMin > 2 && rMax < 8, `r ∈ [${rMin.toFixed(2)}, ${rMax.toFixed(2)}] AU`);
}

for (const p of PRESETS) {
  const w = load(p.id);
  const n0 = w.bodies.length;
  run(w, 500, p.dt);
  const finite = w.bodies.every(
    (b) => Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z),
  );
  // The empty preset legitimately has nothing in it; everything else must keep
  // at least one body rather than quietly losing them all.
  const ok = finite && (n0 === 0 ? w.bodies.length === 0 : w.bodies.length > 0);
  check(`${p.name} stays finite for 500 yr`, ok, `${n0} → ${w.bodies.length} bodies`);
}

// ---------------------------------------------------------------------------
section('Starting from scratch');

{
  const w = load('empty');
  check('empty preset loads with no bodies', w.bodies.length === 0, `${w.bodies.length} bodies`);

  const e = w.energy();
  const com = w.centerOfMass();
  check('empty world energy is 0, not NaN', e.total === 0 && Number.isFinite(e.total), `E = ${e.total}`);
  check('empty world barycenter is finite', [com.x, com.y, com.z].every(Number.isFinite), `(${com.x}, ${com.y}, ${com.z})`);

  w.zeroMomentum(); // must not divide by a zero total mass
  for (let i = 0; i < 1000; i++) w.step(0.5);
  check('stepping an empty world is a safe no-op', w.bodies.length === 0 && w.time === 500, `t = ${w.time} d`);
}

{
  // Mirror what the builder actually does: seed a star at the origin at rest,
  // then hang a planet off it by orbital elements — no zeroMomentum, because
  // re-centring would disturb a system the user is part-way through building.
  const w = load('empty');
  const star = w.add({ name: 'Star', mass: 1, radius: C.R_SUN, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
  check('first body lands at the origin, at rest', star.x === 0 && star.y === 0 && star.z === 0 && star.vx === 0 && star.vy === 0 && star.vz === 0, 'origin, zero velocity');

  w.resetEnergyBaseline();
  check('one body at rest has zero energy — a useless baseline', w.referenceEnergy === 0, `E = ${w.referenceEnergy}`);

  const a = 1.5;
  const ecc = 0.2;
  const mu = C.G * (star.mass + C.M_EARTH);
  const rel = stateFromElements(mu, a, ecc, 15, 40, 0);
  const planet = w.add({
    name: 'World',
    mass: C.M_EARTH,
    radius: C.R_EARTH,
    x: star.x + rel.x, y: star.y + rel.y, z: star.z + rel.z,
    vx: star.vx + rel.vx, vy: star.vy + rel.vy, vz: star.vz + rel.vz,
  });

  // This is the re-baseline the app performs after every add. Without it the
  // drift readout would divide by the empty system's zero energy forever.
  w.resetEnergyBaseline();
  check('baseline after the add is a real bound energy', w.referenceEnergy < 0, `E = ${w.referenceEnergy.toExponential(3)}`);

  const period = orbitalPeriod(mu, a);
  const steps = 50000;
  let rMin = Infinity;
  let rMax = 0;
  for (let i = 0; i < steps; i++) {
    w.step(period / steps);
    const r = Math.hypot(planet.x - star.x, planet.y - star.y, planet.z - star.z);
    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
  }
  const periOk = Math.abs(rMin - a * (1 - ecc)) < 1e-5;
  const apoOk = Math.abs(rMax - a * (1 + ecc)) < 1e-5;
  check('built-from-scratch orbit matches its stated elements', periOk && apoOk, `peri ${rMin.toFixed(6)} / apo ${rMax.toFixed(6)} vs ${(a * (1 - ecc)).toFixed(2)} / ${(a * (1 + ecc)).toFixed(2)}`);

  const drift = Math.abs((w.energy().total - w.referenceEnergy) / w.referenceEnergy);
  check('drift stays meaningful after the re-baseline', drift < 1e-9, `|ΔE/E| = ${drift.toExponential(2)}`);
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
