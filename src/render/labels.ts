import { World } from '../physics/world';
import { OrbitCamera } from './camera';
import { screenRadiusFor } from './scene';

/**
 * Body labels as absolutely-positioned DOM nodes rather than canvas text or
 * sprites: text stays crisp at any pixel ratio, and it costs nothing to style.
 * Nodes are pooled, so a running sim never touches the DOM tree structure.
 */
export class Labels {
  private pool: HTMLDivElement[] = [];

  constructor(private container: HTMLElement) {}

  update(world: World, cam: OrbitCamera, bodyScale: number, visible: boolean): void {
    if (!visible) {
      for (const node of this.pool) node.style.display = 'none';
      return;
    }

    let i = 0;
    for (const body of world.bodies) {
      const p = cam.worldToScreen(body.x, body.y, body.z);
      if (!p.visible || p.x < -120 || p.y < -40 || p.x > cam.width + 120 || p.y > cam.height + 40) {
        continue;
      }

      let node = this.pool[i];
      if (!node) {
        node = document.createElement('div');
        node.className = 'body-label';
        this.container.append(node);
        this.pool.push(node);
      }
      const offset = screenRadiusFor(body, bodyScale) + 7;
      node.textContent = body.name;
      node.style.display = 'block';
      node.style.transform = `translate(${Math.round(p.x + offset)}px, ${Math.round(p.y)}px)`;
      i++;
    }

    for (let j = i; j < this.pool.length; j++) this.pool[j].style.display = 'none';
  }
}
