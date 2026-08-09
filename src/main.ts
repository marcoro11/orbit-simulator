import { App } from './app';
import { bindInteraction } from './interaction';
import { presetById } from './presets';
import { bindUI } from './ui';
import './style.css';

const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
const labelLayer = document.getElementById('labels');
if (!canvas || !labelLayer) throw new Error('Missing #canvas or #labels');

const app = new App(canvas, labelLayer);
const ui = bindUI(app);
bindInteraction(canvas, app);

app.resize();
window.addEventListener('resize', () => app.resize());

// "Empty" is first in the list so it's easy to find, but it would be a poor
// thing to land on — open with the Solar System.
app.loadPreset(presetById('solar'));

function loop(now: number): void {
  app.frame(now);
  ui.tick();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
