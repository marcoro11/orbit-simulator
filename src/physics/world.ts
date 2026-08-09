import { Body, BodySpec, defaultClass, estimateRadius } from './body';
import { G } from './constants';
import { Trail } from './trail';

export interface Energy {
  kinetic: number;
  potential: number;
  total: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MergeEvent {
  survivorId: number;
  absorbedName: string;
  survivorName: string;
}

let idCounter = 1;

/**
 * An N-body gravitational system in 3D, integrated with kick–drift–kick leapfrog.
 *
 * Why leapfrog and not Euler: leapfrog is *symplectic*. It doesn't conserve
 * energy exactly, but its error oscillates around the true value instead of
 * accumulating, so a bound orbit stays bound essentially forever. Plain Euler
 * pumps energy in every step and visibly spirals bodies outward within seconds.
 */
export class World {
  bodies: Body[] = [];
  /** Elapsed simulation time, in days. */
  time = 0;
  /**
   * Plummer softening length in AU. Replaces r² with r² + ε² in the force law,
   * which caps the acceleration during close encounters instead of letting it
   * diverge and fling bodies to infinity. Set to 0 for pure Newtonian gravity.
   */
  softening = 1e-5;
  mergeOnCollision = true;
  trailCapacity = 900;

  /** Energy at the moment the system was loaded; the drift readout baseline. */
  referenceEnergy = 0;

  private accelDirty = true;
  private mergeEvents: MergeEvent[] = [];

  add(spec: BodySpec): Body {
    const body: Body = {
      id: idCounter++,
      name: spec.name ?? `Body ${this.bodies.length + 1}`,
      color: spec.color ?? '#cbd5f5',
      bodyClass: spec.bodyClass ?? defaultClass(spec.mass),
      mass: spec.mass,
      radius: spec.radius ?? estimateRadius(spec.mass),
      displayScale: spec.displayScale ?? 1,
      x: spec.x,
      y: spec.y,
      z: spec.z ?? 0,
      vx: spec.vx,
      vy: spec.vy,
      vz: spec.vz ?? 0,
      ax: 0,
      ay: 0,
      az: 0,
      trail: new Trail(this.trailCapacity),
    };
    this.bodies.push(body);
    this.accelDirty = true;
    return body;
  }

  remove(id: number): void {
    const i = this.bodies.findIndex((b) => b.id === id);
    if (i >= 0) {
      this.bodies.splice(i, 1);
      this.accelDirty = true;
    }
  }

  get(id: number | null): Body | undefined {
    if (id === null) return undefined;
    return this.bodies.find((b) => b.id === id);
  }

  clear(): void {
    this.bodies.length = 0;
    this.time = 0;
    this.accelDirty = true;
  }

  clearTrails(): void {
    for (const b of this.bodies) b.trail.clear();
  }

  setTrailCapacity(cap: number): void {
    this.trailCapacity = cap;
    for (const b of this.bodies) b.trail.setCapacity(cap);
  }

  recordTrails(): void {
    for (const b of this.bodies) b.trail.push(b.x, b.y, b.z);
  }

  /** Pairwise O(N²) gravity. Fine to ~2000 bodies; beyond that you'd want Barnes–Hut. */
  computeAccelerations(): void {
    const bodies = this.bodies;
    const n = bodies.length;
    const eps2 = this.softening * this.softening;

    for (let i = 0; i < n; i++) {
      bodies[i].ax = 0;
      bodies[i].ay = 0;
      bodies[i].az = 0;
    }

    for (let i = 0; i < n; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const r2 = dx * dx + dy * dy + dz * dz + eps2;
        const invR = 1 / Math.sqrt(r2);
        // G / r³, factored so each body just multiplies by the other's mass.
        const invR3 = G * invR * invR * invR;
        a.ax += invR3 * b.mass * dx;
        a.ay += invR3 * b.mass * dy;
        a.az += invR3 * b.mass * dz;
        b.ax -= invR3 * a.mass * dx;
        b.ay -= invR3 * a.mass * dy;
        b.az -= invR3 * a.mass * dz;
      }
    }
    this.accelDirty = false;
  }

  /** Advance by `dt` days. */
  step(dt: number): void {
    if (this.accelDirty) this.computeAccelerations();
    const bodies = this.bodies;
    const half = dt * 0.5;

    // Kick (half)
    for (const b of bodies) {
      b.vx += b.ax * half;
      b.vy += b.ay * half;
      b.vz += b.az * half;
    }
    // Drift (full)
    for (const b of bodies) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
    }
    // Re-evaluate forces at the new positions
    this.computeAccelerations();
    // Kick (half)
    for (const b of bodies) {
      b.vx += b.ax * half;
      b.vy += b.ay * half;
      b.vz += b.az * half;
    }

    this.time += dt;

    if (this.mergeOnCollision) this.resolveCollisions();
  }

  /** Merge overlapping bodies, conserving mass and momentum. */
  private resolveCollisions(): void {
    const bodies = this.bodies;
    let merged = false;

    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const touch = a.radius + b.radius;
        if (dx * dx + dy * dy + dz * dz > touch * touch) continue;

        // The heavier body survives and keeps its identity.
        const [big, small] = a.mass >= b.mass ? [a, b] : [b, a];
        const m = big.mass + small.mass;
        big.x = (big.mass * big.x + small.mass * small.x) / m;
        big.y = (big.mass * big.y + small.mass * small.y) / m;
        big.z = (big.mass * big.z + small.mass * small.z) / m;
        big.vx = (big.mass * big.vx + small.mass * small.vx) / m;
        big.vy = (big.mass * big.vy + small.mass * small.vy) / m;
        big.vz = (big.mass * big.vz + small.mass * small.vz) / m;
        // Volumes add.
        big.radius = Math.cbrt(big.radius ** 3 + small.radius ** 3);
        big.mass = m;
        // A planet that eats its way past the fusion threshold should light up.
        if (big.bodyClass === 'planet' && m >= 0.02) big.bodyClass = 'star';

        this.mergeEvents.push({
          survivorId: big.id,
          survivorName: big.name,
          absorbedName: small.name,
        });

        this.bodies.splice(this.bodies.indexOf(small), 1);
        merged = true;
        j = i; // restart the inner scan; indices shifted
      }
    }

    if (merged) this.computeAccelerations();
  }

  /** Drain merge notifications recorded since the last call. */
  takeMergeEvents(): MergeEvent[] {
    if (this.mergeEvents.length === 0) return [];
    const out = this.mergeEvents;
    this.mergeEvents = [];
    return out;
  }

  /**
   * Re-baseline the energy-drift readout.
   *
   * Drift is meant to measure *integration* error, so it only means anything
   * relative to a fixed set of bodies. Adding one, deleting one, or merging two
   * changes the total energy discontinuously and for entirely legitimate
   * reasons — a merge is inelastic and genuinely loses kinetic energy. Without
   * a re-baseline those show up as enormous "drift" and the readout stops being
   * an honest check on the integrator.
   */
  resetEnergyBaseline(): void {
    this.referenceEnergy = this.energy().total;
  }

  energy(): Energy {
    let kinetic = 0;
    let potential = 0;
    const eps2 = this.softening * this.softening;
    const bodies = this.bodies;

    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      kinetic += 0.5 * a.mass * (a.vx * a.vx + a.vy * a.vy + a.vz * a.vz);
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        potential -= (G * a.mass * b.mass) / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
      }
    }
    return { kinetic, potential, total: kinetic + potential };
  }

  totalMass(): number {
    let m = 0;
    for (const b of this.bodies) m += b.mass;
    return m;
  }

  centerOfMass(): Vec3 {
    const m = this.totalMass();
    if (m === 0) return { x: 0, y: 0, z: 0 };
    let x = 0;
    let y = 0;
    let z = 0;
    for (const b of this.bodies) {
      x += b.mass * b.x;
      y += b.mass * b.y;
      z += b.mass * b.z;
    }
    return { x: x / m, y: y / m, z: z / m };
  }

  /**
   * Remove net momentum and recenter on the barycenter, so the whole system
   * doesn't slowly translate off screen. Standard practice when setting up
   * initial conditions.
   */
  zeroMomentum(): void {
    const m = this.totalMass();
    if (m === 0) return;
    let px = 0;
    let py = 0;
    let pz = 0;
    for (const b of this.bodies) {
      px += b.mass * b.vx;
      py += b.mass * b.vy;
      pz += b.mass * b.vz;
    }
    const com = this.centerOfMass();
    for (const b of this.bodies) {
      b.vx -= px / m;
      b.vy -= py / m;
      b.vz -= pz / m;
      b.x -= com.x;
      b.y -= com.y;
      b.z -= com.z;
    }
    this.accelDirty = true;
  }

  /**
   * Integrate a hypothetical extra body forward and return its path as a flat
   * [x, y, z, …] array, without touching the live simulation. This is what
   * powers the drag-to-place preview.
   */
  previewTrajectory(spec: BodySpec, dt: number, steps: number, sampleEvery: number): number[] {
    const ghost = new World();
    ghost.softening = this.softening;
    ghost.mergeOnCollision = false; // a merged ghost would just vanish mid-preview
    ghost.trailCapacity = 1;
    for (const b of this.bodies) {
      ghost.add({
        mass: b.mass,
        radius: b.radius,
        x: b.x, y: b.y, z: b.z,
        vx: b.vx, vy: b.vy, vz: b.vz,
      });
    }
    const g = ghost.add(spec);

    const path: number[] = [];
    for (let i = 0; i < steps; i++) {
      ghost.step(dt);
      if (i % sampleEvery === 0) path.push(g.x, g.y, g.z);
    }
    return path;
  }
}
