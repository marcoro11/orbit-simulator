import * as THREE from 'three';
import { World } from '../physics/world';

const DEG = Math.PI / 180;
/** Kept just off the pole: at exactly 90° the up vector is degenerate. */
const MAX_ELEVATION = 89.5 * DEG;

/**
 * A turntable camera orbiting a target point.
 *
 * The scene is Z-up (the XY plane is the ecliptic) rather than three.js's
 * default Y-up, so that physics coordinates map straight through and the
 * top-down view matches the plane the presets are built in.
 */
export class OrbitCamera {
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.001, 1000);
  readonly target = new THREE.Vector3();

  /** Distance from target, in AU. */
  distance = 10;
  azimuth = -90 * DEG;
  elevation = 25 * DEG;

  /** If set, the camera re-centers on this body every frame. */
  followId: number | null = null;

  width = 1;
  height = 1;

  private readonly ray = new THREE.Raycaster();
  private readonly plane = new THREE.Plane();
  private readonly scratch = new THREE.Vector3();

  constructor() {
    this.camera.up.set(0, 0, 1);
  }

  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** How many AU one screen pixel spans, at a given distance from the eye. */
  worldPerPixel(distanceFromEye: number): number {
    const fov = this.camera.fov * DEG;
    return (2 * Math.tan(fov / 2) * distanceFromEye) / this.height;
  }

  rotate(dxPx: number, dyPx: number): void {
    this.azimuth -= dxPx * 0.005;
    this.elevation = THREE.MathUtils.clamp(
      this.elevation - dyPx * 0.005,
      -MAX_ELEVATION,
      MAX_ELEVATION,
    );
  }

  /** Slide the target sideways in the camera's own plane. */
  panByPixels(dxPx: number, dyPx: number): void {
    const scale = this.worldPerPixel(this.distance);
    const right = this.scratch.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.target.addScaledVector(right, -dxPx * scale);
    const up = this.scratch.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.target.addScaledVector(up, dyPx * scale);
    this.followId = null;
  }

  /** Dolly in or out, drifting the target toward whatever is under the cursor. */
  dolly(factor: number, px: number, py: number): void {
    const focus = this.screenToViewPlane(px, py);
    this.distance = THREE.MathUtils.clamp(this.distance * factor, 1e-5, 1e5);
    // While following a body, zoom must stay centred on it — drifting the target
    // toward the cursor would silently break the follow the user asked for.
    if (focus && factor < 1 && this.followId === null) {
      this.target.lerp(focus, 1 - factor);
    }
  }

  setAngles(azimuthDeg: number, elevationDeg: number): void {
    this.azimuth = azimuthDeg * DEG;
    this.elevation = THREE.MathUtils.clamp(elevationDeg * DEG, -MAX_ELEVATION, MAX_ELEVATION);
  }

  update(world: World): void {
    if (this.followId !== null) {
      const body = world.get(this.followId);
      if (body) this.target.set(body.x, body.y, body.z);
      else this.followId = null;
    }

    const ce = Math.cos(this.elevation);
    this.camera.position.set(
      this.target.x + this.distance * ce * Math.cos(this.azimuth),
      this.target.y + this.distance * ce * Math.sin(this.azimuth),
      this.target.z + this.distance * Math.sin(this.elevation),
    );
    this.camera.lookAt(this.target);

    // The scene spans many decades of scale, so the depth range has to track
    // the current zoom rather than being fixed.
    this.camera.near = Math.max(this.distance * 1e-4, 1e-7);
    this.camera.far = this.distance * 2000 + 1000;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private setRay(px: number, py: number): void {
    this.ray.setFromCamera(
      new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1),
      this.camera,
    );
  }

  /**
   * Where the cursor ray meets the horizontal plane at height z.
   * Returns null when the view is too close to edge-on for the answer to mean
   * anything — callers fall back to the view plane.
   */
  screenToEcliptic(px: number, py: number, z: number): THREE.Vector3 | null {
    this.setRay(px, py);
    if (Math.abs(this.ray.ray.direction.z) < 0.05) return null;
    this.plane.set(new THREE.Vector3(0, 0, 1), -z);
    const hit = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, hit);
  }

  /** Where the cursor ray meets the plane through the target facing the camera. */
  screenToViewPlane(px: number, py: number): THREE.Vector3 | null {
    this.setRay(px, py);
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    this.plane.setFromNormalAndCoplanarPoint(normal, this.target);
    const hit = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, hit);
  }

  /** Project a world point to CSS pixels. `visible` is false when behind the eye. */
  worldToScreen(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = this.scratch.set(x, y, z).project(this.camera);
    return {
      x: ((v.x + 1) / 2) * this.width,
      y: ((1 - v.y) / 2) * this.height,
      visible: v.z > -1 && v.z < 1,
    };
  }
}
