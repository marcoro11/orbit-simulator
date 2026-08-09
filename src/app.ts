import * as THREE from 'three';
import { BodyType, shortLabel, typeById } from './catalog';
import { Body, BodySpec } from './physics/body';
import { G } from './physics/constants';
import { orbitalPeriod, speedAt, stateFromElements } from './physics/kepler';
import { World } from './physics/world';
import { OrbitCamera } from './render/camera';
import { Labels } from './render/labels';
import { DragPreview, RenderOptions, SceneRenderer, screenRadiusFor } from './render/scene';
import { loadPreset, Preset, presetById } from './presets';

export type Tool = 'add' | 'camera';

/** Orbital elements the builder panel collects, relative to a parent body. */
export interface BuildElements {
  parentId: number | null;
  distance: number;
  eccentricity: number;
  inclinationDeg: number;
  angleDeg: number;
}

export interface BuildInfo {
  /** Orbital period in days. */
  period: number;
  /** Speed at the starting point, AU/day. */
  speed: number;
  periapsis: number;
  apoapsis: number;
  /** Largest integration step that will render this orbit faithfully, in days. */
  suggestedDt: number;
}

interface DragState {
  /** Where the body will be placed, in world coordinates. */
  origin: THREE.Vector3;
  pressX: number;
  pressY: number;
  cursorX: number;
  cursorY: number;
  tip: THREE.Vector3 | null;
  preview: DragPreview | null;
}

/**
 * Screen distance, in pixels, at which a launch drag corresponds to exactly the
 * local circular-orbit speed. Makes the control zoom-independent and keeps the
 * useful range of drags on screen at any scale.
 */
const DRAG_PIXELS_PER_VCIRC = 150;

export class App {
  readonly world = new World();
  readonly camera = new OrbitCamera();
  readonly scene: SceneRenderer;
  readonly labels: Labels;

  running = true;
  dt = 0.5;
  stepsPerFrame = 8;
  tool: Tool = 'add';
  /** The catalog entry that both drag-placement and the builder create. */
  newType: BodyType = typeById('terrestrial');
  newBodyMass = typeById('terrestrial').mass;
  /**
   * Height of the placement plane, as a fraction of the current view distance.
   * Storing it relative to the zoom means the slider stays useful whether
   * you're looking at the Earth–Moon system or all of Neptune's orbit.
   */
  placementFraction = 0;
  selectedId: number | null = null;
  preset: Preset = presetById('solar');

  options: RenderOptions = {
    showTrails: true,
    showGrid: true,
    showLabels: true,
    showDropLines: true,
    bodyScale: 1,
    selectedId: null,
  };

  /** Called after anything that should refresh the panel. */
  onChange: (() => void) | null = null;
  onToast: ((msg: string) => void) | null = null;

  private drag: DragState | null = null;
  /** Per-type counters, so added bodies get names like "Red dwarf 2". */
  private typeCounts = new Map<string, number>();
  private lastFrame = performance.now();
  private fps = 60;
  private energyDrift = 0;
  private energyTick = 0;

  constructor(canvas: HTMLCanvasElement, labelLayer: HTMLElement) {
    this.scene = new SceneRenderer(canvas);
    this.labels = new Labels(labelLayer);
  }

  // ---------- lifecycle ----------

  loadPreset(preset: Preset): void {
    this.preset = preset;
    loadPreset(this.world, preset);
    this.dt = preset.dt;
    this.stepsPerFrame = preset.stepsPerFrame;
    this.camera.target.set(0, 0, 0);
    this.camera.distance = preset.view;
    this.camera.setAngles(-90, preset.elevation ?? 25);
    this.camera.followId = null;
    this.selectedId = null;
    this.typeCounts.clear();
    this.energyDrift = 0;
    this.placementFraction = 0;
    this.onChange?.();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    // A hidden or collapsed viewport reports 0, which would make the camera
    // aspect NaN and poison the projection matrix for good.
    if (w === 0 || h === 0) return;
    this.scene.resize(w, h, dpr);
    this.camera.setViewport(w, h);
  }

  frame(now: number): void {
    const elapsed = now - this.lastFrame;
    this.lastFrame = now;
    if (elapsed > 0) this.fps += (1000 / elapsed - this.fps) * 0.1;

    if (this.running) {
      // Trails are normally sampled once per frame. At high step rates that
      // makes a fast inner orbit look like a polygon, so take a few intermediate
      // samples — but only then, to keep the default trail duration unchanged.
      const every =
        this.stepsPerFrame > 8 ? Math.ceil(this.stepsPerFrame / 4) : this.stepsPerFrame;
      for (let i = 1; i <= this.stepsPerFrame; i++) {
        this.world.step(this.dt);
        if (i % every === 0) this.world.recordTrails();
      }

      const merges = this.world.takeMergeEvents();
      for (const ev of merges) {
        this.onToast?.(`${ev.survivorName} absorbed ${ev.absorbedName}`);
        if (this.selectedId !== null && !this.world.get(this.selectedId)) {
          this.selectedId = ev.survivorId;
        }
      }
      if (merges.length > 0) this.rebaselineEnergy();

      // Energy is O(N²); no need to recompute it every single frame.
      if (++this.energyTick % 12 === 0) {
        const e = this.world.energy().total;
        const ref = this.world.referenceEnergy;
        this.energyDrift = ref !== 0 ? (e - ref) / Math.abs(ref) : 0;
      }
    }

    this.camera.update(this.world);
    this.options.selectedId = this.selectedId;

    this.scene.render(this.world, this.camera, this.options, this.drag?.preview ?? null);
    this.labels.update(this.world, this.camera, this.options.bodyScale, this.options.showLabels);
  }

  // ---------- actions ----------

  toggleRun(): void {
    this.running = !this.running;
    this.onChange?.();
  }

  stepOnce(): void {
    this.world.step(this.dt);
    this.world.recordTrails();
    this.world.takeMergeEvents();
    this.onChange?.();
  }

  reload(): void {
    this.loadPreset(this.preset);
    this.onToast?.(`Reloaded ${this.preset.name}`);
  }

  select(id: number | null): void {
    this.selectedId = id;
    this.onChange?.();
  }

  deleteSelected(): void {
    if (this.selectedId === null) return;
    const body = this.world.get(this.selectedId);
    if (!body) return;
    this.world.remove(this.selectedId);
    if (this.camera.followId === this.selectedId) this.camera.followId = null;
    this.selectedId = null;
    this.rebaselineEnergy();
    this.onToast?.(`Removed ${body.name}`);
    this.onChange?.();
  }

  followSelected(): void {
    if (this.selectedId === null) return;
    this.camera.followId = this.camera.followId === this.selectedId ? null : this.selectedId;
    this.onChange?.();
  }

  setView(azimuthDeg: number, elevationDeg: number): void {
    this.camera.setAngles(azimuthDeg, elevationDeg);
    this.onChange?.();
  }

  setTrailLength(n: number): void {
    this.world.setTrailCapacity(n);
  }

  /** Call after any change to which bodies exist, so drift stays meaningful. */
  private rebaselineEnergy(): void {
    this.world.resetEnergyBaseline();
    this.energyDrift = 0;
  }

  get fpsValue(): number {
    return this.fps;
  }

  get energyDriftValue(): number {
    return this.energyDrift;
  }

  get gridSpacing(): number {
    return this.scene.gridSpacing;
  }

  /** Height of the placement plane in AU, resolved against the current zoom. */
  get placementHeight(): number {
    return this.placementFraction * this.camera.distance * 0.4;
  }

  // ---------- precise builder ----------

  /** Sensible default parent: whatever dominates the system. */
  defaultParentId(): number | null {
    let best: Body | null = null;
    for (const b of this.world.bodies) if (!best || b.mass > best.mass) best = b;
    return best?.id ?? null;
  }

  /**
   * What the given elements would produce, without creating anything. Drives the
   * builder's live readout so you can see the period and speed before adding.
   */
  buildInfo(el: BuildElements): BuildInfo | null {
    const parent = this.world.get(el.parentId);
    if (!parent || !(el.distance > 0)) return null;
    const mu = G * (parent.mass + this.newBodyMass);
    const e = Math.min(Math.max(el.eccentricity, 0), 0.95);
    const period = orbitalPeriod(mu, el.distance);
    return {
      period,
      speed: speedAt(mu, el.distance, e, 0),
      periapsis: el.distance * (1 - e),
      apoapsis: el.distance * (1 + e),
      // An eccentric orbit spends most of its time crawling near apoapsis and
      // then whips through periapsis in a fraction of the period. A fixed step
      // has to resolve that fast passage, so the usable step shrinks sharply
      // with eccentricity: t_peri ≈ (T/2π)·(1−e)^1.5/√(1+e), and we want a few
      // dozen steps across it.
      suggestedDt: (period * Math.pow(1 - e, 1.5)) / (2 * Math.PI * 40 * Math.sqrt(1 + e)),
    };
  }

  /**
   * Add a body on a precisely specified orbit around an existing one. With no
   * parent (an empty system) it goes at the origin, at rest — the seed everything
   * else is then built around.
   */
  buildBody(el: BuildElements): Body | null {
    const parent = this.world.get(el.parentId);
    if (parent && !(el.distance > 0)) return null;

    let state = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    if (parent) {
      // Two-body μ uses the combined mass, so the stated period is the one you
      // actually get even when the new body is a significant fraction of its parent.
      const mu = G * (parent.mass + this.newBodyMass);
      const rel = stateFromElements(
        mu,
        el.distance,
        el.eccentricity,
        el.inclinationDeg,
        el.angleDeg,
        0,
      );
      state = {
        x: parent.x + rel.x,
        y: parent.y + rel.y,
        z: parent.z + rel.z,
        vx: parent.vx + rel.vx,
        vy: parent.vy + rel.vy,
        vz: parent.vz + rel.vz,
      };
    }

    const body = this.world.add({ ...state, ...this.newBodyAttributes() });
    this.selectedId = body.id;
    this.rebaselineEnergy();
    this.onChange?.();
    return body;
  }

  /** Name, colour and render class for the next body of the selected type. */
  private newBodyAttributes(): Omit<BodySpec, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz'> {
    const type = this.newType;
    const n = (this.typeCounts.get(type.id) ?? 0) + 1;
    this.typeCounts.set(type.id, n);
    return {
      name: `${shortLabel(type)} ${n}`,
      color: type.color,
      bodyClass: type.bodyClass,
      mass: this.newBodyMass,
      radius: type.radius(this.newBodyMass),
      displayScale: type.displayScale,
    };
  }

  // ---------- placement ----------

  /**
   * Nearest body whose drawn disc contains the given screen point. Bodies are
   * drawn at a constant pixel size, so a 2D screen-space test is both simpler
   * and more forgiving than raycasting against the meshes.
   */
  pick(px: number, py: number): number | null {
    let best: number | null = null;
    let bestDist = Infinity;
    for (const b of this.world.bodies) {
      const p = this.camera.worldToScreen(b.x, b.y, b.z);
      if (!p.visible) continue;
      const hit = Math.max(screenRadiusFor(b, this.options.bodyScale) + 4, 10);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d <= hit && d < bestDist) {
        bestDist = d;
        best = b.id;
      }
    }
    return best;
  }

  /**
   * Cursor position on the placement plane. Falls back to the plane through the
   * camera target when the view is too close to edge-on for the horizontal
   * plane to give a meaningful answer.
   */
  private planePoint(px: number, py: number): THREE.Vector3 | null {
    return (
      this.camera.screenToEcliptic(px, py, this.placementHeight) ??
      this.camera.screenToViewPlane(px, py)
    );
  }

  beginDrag(px: number, py: number): boolean {
    const origin = this.planePoint(px, py);
    if (!origin) return false;
    this.drag = {
      origin,
      pressX: px,
      pressY: py,
      cursorX: px,
      cursorY: py,
      tip: null,
      preview: null,
    };
    this.updateDrag(px, py);
    return true;
  }

  updateDrag(px: number, py: number): void {
    const d = this.drag;
    if (!d) return;
    d.cursorX = px;
    d.cursorY = py;
    d.tip = this.planePoint(px, py);

    const spec = this.dragToSpec(d);

    // Integrating the preview costs O(steps · N²); back off as N grows.
    const n = this.world.bodies.length;
    const maxSteps = n > 40 ? 600 : n > 15 ? 1400 : 2400;

    // Show roughly one orbit's worth of path, whatever the scale. A fixed step
    // count would trace a full loop close to a star and a barely-visible stub
    // out at Neptune, where the period is thousands of times longer. The step
    // is capped relative to the sim's own so the other bodies stay adequately
    // resolved inside the preview.
    let previewDt = this.dt;
    let steps = maxSteps;
    const dominant = this.dominantAt(d.origin);
    if (dominant) {
      const span = dominant.period * 1.25;
      previewDt = THREE.MathUtils.clamp(span / maxSteps, this.dt, this.dt * 25);
      steps = THREE.MathUtils.clamp(Math.ceil(span / previewDt), 60, maxSteps);
    }

    d.preview = {
      origin: d.origin,
      tip: d.tip,
      path: this.world.previewTrajectory(spec, previewDt, steps, Math.max(1, Math.floor(steps / 500))),
    };
  }

  endDrag(commit: boolean): void {
    const d = this.drag;
    this.drag = null;
    if (!d || !commit) return;
    // Naming happens only here — dragToSpec runs every preview frame, so
    // anything stateful in it would churn while you're still dragging.
    const body = this.world.add({ ...this.dragToSpec(d), ...this.newBodyAttributes() });
    this.selectedId = body.id;
    this.rebaselineEnergy();
    this.onChange?.();
  }

  cancelDrag(): void {
    this.drag = null;
  }

  get dragInfo(): { speed: number; vCircRatio: number } | null {
    if (!this.drag) return null;
    const spec = this.dragToSpec(this.drag);
    const speed = Math.hypot(spec.vx, spec.vy, spec.vz ?? 0);
    const vc = this.dominantAt(this.drag.origin)?.vCirc ?? 0;
    return { speed, vCircRatio: vc > 0 ? speed / vc : 0 };
  }

  /**
   * The body that dominates gravitationally at a point, with the circular-orbit
   * speed and period it implies there. Used to give the drag control a
   * scale-free sensitivity and to size the trajectory preview — never fed back
   * into the physics.
   */
  private dominantAt(p: THREE.Vector3): { vCirc: number; period: number } | null {
    let strongestPull = 0;
    let vCirc = 0;
    let radius = 0;
    for (const b of this.world.bodies) {
      const r = Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z);
      if (r < 1e-9) continue;
      const pull = (G * b.mass) / (r * r);
      if (pull > strongestPull) {
        strongestPull = pull;
        radius = r;
        vCirc = Math.sqrt((G * b.mass) / r);
      }
    }
    if (vCirc <= 0) return null;
    return { vCirc, period: (2 * Math.PI * radius) / vCirc };
  }

  private dragToSpec(d: DragState): BodySpec {
    // Direction comes from the drag *in the placement plane*, but magnitude
    // comes from the drag in *pixels*. Mixing them this way keeps the control
    // predictable at grazing camera angles, where a small screen movement can
    // sweep an enormous distance across the plane.
    let dirX = 0;
    let dirY = 0;
    let dirZ = 0;
    if (d.tip) {
      dirX = d.tip.x - d.origin.x;
      dirY = d.tip.y - d.origin.y;
      dirZ = d.tip.z - d.origin.z;
      const len = Math.hypot(dirX, dirY, dirZ);
      if (len > 0) {
        dirX /= len;
        dirY /= len;
        dirZ /= len;
      }
    }

    const pixels = Math.hypot(d.cursorX - d.pressX, d.cursorY - d.pressY);
    const vCirc = this.dominantAt(d.origin)?.vCirc ?? 0;
    // With no bodies around there's no natural velocity scale, so fall back to
    // something that produces visible motion at the current zoom.
    const speed =
      (pixels / DRAG_PIXELS_PER_VCIRC) * (vCirc > 0 ? vCirc : this.camera.distance * 2e-4);

    return {
      mass: this.newBodyMass,
      radius: this.newType.radius(this.newBodyMass),
      x: d.origin.x,
      y: d.origin.y,
      z: d.origin.z,
      vx: dirX * speed,
      vy: dirY * speed,
      vz: dirZ * speed,
    };
  }
}
