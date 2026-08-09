import * as THREE from 'three';
import { Body, BodyClass } from '../physics/body';
import { World } from '../physics/world';
import { OrbitCamera } from './camera';

export interface RenderOptions {
  showTrails: boolean;
  showGrid: boolean;
  showLabels: boolean;
  showDropLines: boolean;
  /** Multiplier on the (non-physical) drawn body size. */
  bodyScale: number;
  selectedId: number | null;
}

export interface DragPreview {
  origin: THREE.Vector3;
  /** Flat [x, y, z, …] path from the trajectory integrator. */
  path: number[];
  /** Tip of the launch arrow, in world space. */
  tip: THREE.Vector3 | null;
}

const MAX_STAR_LIGHTS = 4;
const ACCENT = 0x7ee787;

/**
 * Screen radius for a body, in CSS pixels. Deliberately unrelated to physical
 * radius: at true scale every planet is far below one pixel. The sixth root
 * compresses the ~10⁶ mass range between a moon and a star into roughly
 * 3–27 px — enough to read the hierarchy, small enough that the Sun doesn't
 * cover the whole inner system. The body's own `displayScale` then separates
 * size classes that mass alone can't: a red giant and a white dwarf are within
 * a factor of two in mass but wildly different objects.
 *
 * Bodies are sized in world units each frame so that this pixel size holds at
 * any depth, which keeps distant planets clickable. Hit-testing shares this
 * function, so clicks always line up with what's drawn.
 */
export function screenRadiusFor(
  body: { mass: number; displayScale: number },
  bodyScale: number,
): number {
  const rel = Math.max(body.mass, 1e-14) / 3.00349e-6; // relative to Earth
  const base = Math.min(34, 2.2 + 3.0 * Math.pow(rel, 1 / 6));
  return Math.max(1.5, base * body.displayScale) * bodyScale;
}

interface BodyVisual {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  /** Soft glow around stars and compact objects. */
  halo: THREE.Sprite | null;
  /** Accretion ring — the only thing that makes a black hole visible. */
  ring: THREE.Sprite | null;
  bodyClass: BodyClass;
  trail: THREE.Line;
  trailPos: THREE.BufferAttribute;
  trailColor: THREE.BufferAttribute;
  trailCapacity: number;
}

function radialTexture(stops: Array<[number, string]>): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Glowing annulus for a black hole. A black sphere on a black background is
 * invisible, so the ring is what actually reads as "black hole" — a bright rim
 * with a hard dark hole punched through the middle.
 */
function accretionTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(0,0,0,0)');
  g.addColorStop(0.42, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, 'rgba(255,196,120,0.95)');
  g.addColorStop(0.56, 'rgba(255,255,240,1)');
  g.addColorStop(0.63, 'rgba(255,150,70,0.7)');
  g.addColorStop(0.8, 'rgba(180,70,30,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function ringTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 5, 0, Math.PI * 2);
  ctx.stroke();
  return new THREE.CanvasTexture(canvas);
}

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();

  private readonly sphere = new THREE.SphereGeometry(1, 24, 16);
  private readonly haloTexture = radialTexture([
    [0, 'rgba(255,255,255,0.85)'],
    [0.25, 'rgba(255,255,255,0.28)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  private readonly accretionTexture = accretionTexture();
  private readonly visuals = new Map<number, BodyVisual>();
  private readonly lights: THREE.PointLight[] = [];
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0.1);

  private readonly grid: THREE.LineSegments;
  private gridStep = 0;
  private gridCx = NaN;
  private gridCy = NaN;
  private readonly dropLines: THREE.LineSegments;
  private readonly starfield: THREE.Points;
  private readonly selectionRing: THREE.Sprite;

  private readonly previewLine: THREE.Line;
  private readonly arrowLine: THREE.Line;
  private readonly arrowHead: THREE.Mesh;
  private readonly originMarker: THREE.Mesh;

  private readonly tmp = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(0x05070d, 1);
    this.scene.background = new THREE.Color(0x05070d);

    this.scene.add(this.ambient);
    for (let i = 0; i < MAX_STAR_LIGHTS; i++) {
      // decay = 0 is a deliberate departure from inverse-square: with real
      // falloff, Neptune would be ~900x dimmer than Earth and simply invisible.
      // We keep the directional shading (which reads as 3D) and drop the
      // brightness gradient (which would just hide the outer system).
      const light = new THREE.PointLight(0xffffff, 0, 0, 0);
      light.visible = false;
      this.lights.push(light);
      this.scene.add(light);
    }

    this.grid = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x7896d2, transparent: true, opacity: 0.14 }),
    );
    this.grid.renderOrder = -1;
    this.scene.add(this.grid);

    this.dropLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x8fa3cc, transparent: true, opacity: 0.3 }),
    );
    this.scene.add(this.dropLines);

    this.starfield = this.buildStarfield();
    this.scene.add(this.starfield);

    this.selectionRing = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: ringTexture(),
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.selectionRing.visible = false;
    this.selectionRing.renderOrder = 10;
    this.scene.add(this.selectionRing);

    this.previewLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.85 }),
    );
    this.previewLine.visible = false;
    this.previewLine.frustumCulled = false;
    this.scene.add(this.previewLine);

    this.arrowLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false }),
    );
    this.arrowLine.visible = false;
    this.arrowLine.renderOrder = 11;
    this.scene.add(this.arrowLine);

    this.arrowHead = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 1, 12),
      new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false }),
    );
    this.arrowHead.visible = false;
    this.arrowHead.renderOrder = 11;
    this.scene.add(this.arrowHead);

    this.originMarker = new THREE.Mesh(
      this.sphere,
      new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false }),
    );
    this.originMarker.visible = false;
    this.originMarker.renderOrder = 11;
    this.scene.add(this.originMarker);
  }

  private buildStarfield(): THREE.Points {
    const count = 2200;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Uniform on the unit sphere; scaled to sit just inside the far plane.
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = s * Math.cos(phi);
      pos[i * 3 + 1] = s * Math.sin(phi);
      pos[i * 3 + 2] = u;
      const b = 0.25 + Math.random() * 0.6;
      col[i * 3] = b * 0.58;
      col[i * 3 + 1] = b * 0.64;
      col[i * 3 + 2] = b * 0.8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true }),
    );
    points.frustumCulled = false;
    points.renderOrder = -2;
    return points;
  }

  resize(width: number, height: number, dpr: number): void {
    this.renderer.setPixelRatio(dpr);
    // updateStyle must stay on: a <canvas> is a replaced element, so with only
    // `inset: 0` it lays out at its intrinsic buffer size rather than filling
    // the viewport, and the DOM labels would no longer line up with the meshes.
    this.renderer.setSize(width, height, true);
  }

  // ---------- per-body visuals ----------

  private createVisual(body: Body): BodyVisual {
    const color = new THREE.Color(body.color);
    const cls = body.bodyClass;
    const glows = cls === 'star' || cls === 'compact';

    const mesh = new THREE.Mesh(
      this.sphere,
      new THREE.MeshStandardMaterial({
        color: cls === 'blackhole' ? new THREE.Color(0x000000) : color,
        roughness: 0.85,
        metalness: 0,
        // Stars light the scene rather than being lit by it; a black hole is
        // pure void, and must not pick up light from anything else either.
        emissive: glows ? color : new THREE.Color(0x000000),
        emissiveIntensity: glows ? 1 : 0,
      }),
    );
    this.scene.add(mesh);

    let halo: THREE.Sprite | null = null;
    if (glows) {
      halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.haloTexture,
          color,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          // Compact objects are physically tiny, so their glow stays tight.
          opacity: cls === 'compact' ? 0.5 : 0.4,
        }),
      );
      this.scene.add(halo);
    }

    let ring: THREE.Sprite | null = null;
    if (cls === 'blackhole') {
      ring = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.accretionTexture,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      this.scene.add(ring);
    }

    const cap = body.trail.capacity;
    const geo = new THREE.BufferGeometry();
    const trailPos = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
    const trailColor = new THREE.BufferAttribute(new Float32Array(cap * 4), 4);
    trailPos.setUsage(THREE.DynamicDrawUsage);
    trailColor.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', trailPos);
    geo.setAttribute('color', trailColor);
    const trail = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
      }),
    );
    trail.frustumCulled = false;
    this.scene.add(trail);

    return { mesh, halo, ring, bodyClass: cls, trail, trailPos, trailColor, trailCapacity: cap };
  }

  private disposeVisual(v: BodyVisual): void {
    this.scene.remove(v.mesh, v.trail);
    v.mesh.material.dispose();
    v.trail.geometry.dispose();
    (v.trail.material as THREE.Material).dispose();
    if (v.halo) {
      this.scene.remove(v.halo);
      v.halo.material.dispose();
    }
    if (v.ring) {
      this.scene.remove(v.ring);
      v.ring.material.dispose();
    }
  }

  private syncVisuals(world: World): void {
    const live = new Set<number>();
    for (const body of world.bodies) {
      live.add(body.id);
      let v = this.visuals.get(body.id);
      if (!v) {
        v = this.createVisual(body);
        this.visuals.set(body.id, v);
      }
      // A merge can promote a planet to a star, and the trail buffer has to be
      // rebuilt if the user changed the trail length.
      if (v.bodyClass !== body.bodyClass || v.trailCapacity !== body.trail.capacity) {
        this.disposeVisual(v);
        v = this.createVisual(body);
        this.visuals.set(body.id, v);
      }
    }
    for (const [id, v] of this.visuals) {
      if (!live.has(id)) {
        this.disposeVisual(v);
        this.visuals.delete(id);
      }
    }
  }

  // ---------- frame ----------

  render(world: World, cam: OrbitCamera, opts: RenderOptions, drag: DragPreview | null): void {
    this.syncVisuals(world);

    const eye = cam.camera.position;
    this.starfield.position.copy(eye);
    this.starfield.scale.setScalar(cam.camera.far * 0.4);

    this.updateGrid(cam, opts.showGrid);
    this.updateLights(world);

    const dropSegments: number[] = [];

    for (const body of world.bodies) {
      const v = this.visuals.get(body.id)!;
      this.tmp.set(body.x, body.y, body.z);
      const depth = eye.distanceTo(this.tmp);
      const radius = screenRadiusFor(body, opts.bodyScale) * cam.worldPerPixel(depth);

      v.mesh.position.copy(this.tmp);
      v.mesh.scale.setScalar(radius);

      if (v.halo) {
        v.halo.position.copy(this.tmp);
        v.halo.scale.setScalar(radius * (body.bodyClass === 'compact' ? 8 : 5.5));
      }

      if (v.ring) {
        v.ring.position.copy(this.tmp);
        // The texture's dark centre is sized to just cover the sphere.
        v.ring.scale.setScalar(radius * 4.6);
      }

      v.trail.visible = opts.showTrails && body.trail.length > 1;
      if (v.trail.visible) this.updateTrail(body, v);

      if (opts.showDropLines && Math.abs(body.z) > 1e-9) {
        dropSegments.push(body.x, body.y, body.z, body.x, body.y, 0);
      }
    }

    this.dropLines.visible = dropSegments.length > 0;
    if (this.dropLines.visible) {
      this.dropLines.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(dropSegments), 3),
      );
    }

    const selected = world.get(opts.selectedId);
    this.selectionRing.visible = !!selected;
    if (selected) {
      this.tmp.set(selected.x, selected.y, selected.z);
      const depth = eye.distanceTo(this.tmp);
      const radius = screenRadiusFor(selected, opts.bodyScale) * cam.worldPerPixel(depth);
      this.selectionRing.position.copy(this.tmp);
      this.selectionRing.scale.setScalar(Math.max(radius * 3.4, cam.worldPerPixel(depth) * 22));
    }

    this.updateDrag(drag, cam);

    this.renderer.render(this.scene, cam.camera);
  }

  private updateTrail(body: Body, v: BodyVisual): void {
    const pos = v.trailPos.array as Float32Array;
    const col = v.trailColor.array as Float32Array;
    const base = new THREE.Color(body.color);
    let i = 0;
    body.trail.forEach((x, y, z, age) => {
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      col[i * 4] = base.r;
      col[i * 4 + 1] = base.g;
      col[i * 4 + 2] = base.b;
      // Fade the old end out rather than to black, so trails sit cleanly on
      // top of the grid instead of punching a dark line through it.
      col[i * 4 + 3] = 0.04 + age * 0.62;
      i++;
    });
    v.trailPos.needsUpdate = true;
    v.trailColor.needsUpdate = true;
    v.trail.geometry.setDrawRange(0, i);
  }

  /** Point the brightest few stars' lights; everything else is lit by them. */
  private updateLights(world: World): void {
    const stars = world.bodies
      .filter((b) => b.bodyClass === 'star' || b.bodyClass === 'compact')
      .sort((a, b) => b.mass - a.mass)
      .slice(0, MAX_STAR_LIGHTS);

    this.lights.forEach((light, i) => {
      const star = stars[i];
      light.visible = !!star;
      if (star) {
        light.position.set(star.x, star.y, star.z);
        light.color.set(star.color);
        const dim = star.bodyClass === 'compact' ? 0.45 : 1;
        light.intensity = (2.6 * dim) / Math.max(1, stars.length * 0.6);
      }
    });

    // A system with nothing but black holes and planets has no light source at
    // all, and every body would render pure black. Fall back to flat ambient.
    this.ambient.intensity = stars.length > 0 ? 0.1 : 0.75;
  }

  /**
   * Ecliptic-plane grid with a round AU spacing, rebuilt only when the spacing
   * changes rather than every frame.
   */
  private updateGrid(cam: OrbitCamera, visible: boolean): void {
    this.grid.visible = visible;
    if (!visible) return;

    const raw = cam.distance / 8;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;

    // Follow the camera in whole steps so the grid reads as infinite.
    const cx = Math.round(cam.target.x / step) * step;
    const cy = Math.round(cam.target.y / step) * step;

    if (step === this.gridStep && cx === this.gridCx && cy === this.gridCy) return;
    this.gridStep = step;
    this.gridCx = cx;
    this.gridCy = cy;

    const half = 16;
    const extent = half * step;
    const pts: number[] = [];
    for (let i = -half; i <= half; i++) {
      const o = i * step;
      pts.push(cx + o, cy - extent, 0, cx + o, cy + extent, 0);
      pts.push(cx - extent, cy + o, 0, cx + extent, cy + o, 0);
    }
    this.grid.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    this.grid.geometry = geo;
  }

  /** Current grid spacing in AU, for the on-screen scale readout. */
  get gridSpacing(): number {
    return this.gridStep;
  }

  private updateDrag(drag: DragPreview | null, cam: OrbitCamera): void {
    if (!drag) {
      this.previewLine.visible = false;
      this.arrowLine.visible = false;
      this.arrowHead.visible = false;
      this.originMarker.visible = false;
      return;
    }

    if (drag.path.length >= 6) {
      const geo = this.previewLine.geometry;
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(drag.path), 3));
      geo.setDrawRange(0, drag.path.length / 3);
      this.previewLine.visible = true;
    } else {
      this.previewLine.visible = false;
    }

    const markerScale = cam.worldPerPixel(cam.camera.position.distanceTo(drag.origin));
    this.originMarker.visible = true;
    this.originMarker.position.copy(drag.origin);
    this.originMarker.scale.setScalar(markerScale * 4);

    if (drag.tip && drag.tip.distanceTo(drag.origin) > markerScale * 6) {
      const dir = this.tmp.copy(drag.tip).sub(drag.origin);
      const len = dir.length();
      dir.normalize();

      const shaft = this.arrowLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      const headBase = drag.origin.clone().addScaledVector(dir, Math.max(0, len - markerScale * 12));
      shaft.setXYZ(0, drag.origin.x, drag.origin.y, drag.origin.z);
      shaft.setXYZ(1, headBase.x, headBase.y, headBase.z);
      shaft.needsUpdate = true;
      this.arrowLine.visible = true;

      this.arrowHead.visible = true;
      this.arrowHead.position.copy(drag.tip);
      this.arrowHead.scale.setScalar(markerScale * 13);
      // The cone points +Y in its own space; aim it along the launch direction.
      this.arrowHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    } else {
      this.arrowLine.visible = false;
      this.arrowHead.visible = false;
    }
  }

  dispose(): void {
    for (const v of this.visuals.values()) this.disposeVisual(v);
    this.visuals.clear();
    this.sphere.dispose();
    this.renderer.dispose();
  }
}
