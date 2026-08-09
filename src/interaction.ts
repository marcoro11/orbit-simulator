import { App } from './app';

type Mode = 'none' | 'rotate' | 'translate' | 'place';

const isRotateModifier = (e: MouseEvent | KeyboardEvent): boolean => e.ctrlKey || e.metaKey;

/**
 * Canvas pointer + keyboard handling.
 *
 * Camera control is always reachable without changing tools:
 *   Ctrl/⌘ + drag, or right-drag  → orbit the camera
 *   Shift + drag, or middle-drag  → slide the camera target
 * A plain left-drag does whatever the current tool says, which by default is
 * placing a new body.
 */
export function bindInteraction(canvas: HTMLCanvasElement, app: App): void {
  let mode: Mode = 'none';
  let lastX = 0;
  let lastY = 0;
  let pressX = 0;
  let pressY = 0;
  let movedFar = false;

  const refreshCursor = (e?: MouseEvent | KeyboardEvent): void => {
    const rotate = e ? isRotateModifier(e) : false;
    const translate = e ? e.shiftKey : false;
    canvas.classList.toggle('grab', rotate || translate || (app.tool === 'camera' && !rotate));
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    // Throws if the pointer id isn't currently active; never let that abort the
    // rest of the handler, or the press would register with no mode set.
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture is an optimisation, not a requirement */
    }
    lastX = e.clientX;
    lastY = e.clientY;
    pressX = e.clientX;
    pressY = e.clientY;
    movedFar = false;

    if (e.button === 2) {
      mode = 'rotate';
      return;
    }
    if (e.button === 1) {
      mode = 'translate';
      return;
    }
    if (e.button !== 0) return;

    if (isRotateModifier(e)) {
      mode = 'rotate';
      return;
    }
    if (e.shiftKey) {
      mode = 'translate';
      return;
    }

    const hit = app.pick(e.clientX, e.clientY);
    if (hit !== null) {
      app.select(hit);
      mode = 'rotate'; // keep dragging to orbit around what you just picked
      return;
    }

    if (app.tool === 'add' && app.beginDrag(e.clientX, e.clientY)) {
      mode = 'place';
    } else {
      mode = 'rotate';
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (mode === 'none') {
      refreshCursor(e);
      return;
    }
    if (Math.abs(e.clientX - pressX) + Math.abs(e.clientY - pressY) > 3) movedFar = true;

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (mode === 'rotate') app.camera.rotate(dx, dy);
    else if (mode === 'translate') app.camera.panByPixels(dx, dy);
    else if (mode === 'place') app.updateDrag(e.clientX, e.clientY);

    lastX = e.clientX;
    lastY = e.clientY;
  });

  const finish = (e: PointerEvent): void => {
    if (mode === 'place') {
      // A click with no drag would spawn a zero-velocity body, which just falls
      // straight in — almost never what someone means. Require an actual drag.
      app.endDrag(movedFar);
    } else if (mode === 'rotate' && !movedFar && e.button === 0 && !isRotateModifier(e)) {
      if (app.pick(e.clientX, e.clientY) === null) app.select(null);
    }
    mode = 'none';
  };

  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', () => {
    app.cancelDrag();
    mode = 'none';
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      app.camera.dolly(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY);
    },
    { passive: false },
  );

  window.addEventListener('keyup', refreshCursor);

  window.addEventListener('keydown', (e) => {
    refreshCursor(e);
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        app.toggleRun();
        break;
      case 'Escape':
        app.cancelDrag();
        mode = 'none';
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        app.deleteSelected();
        break;
      case 'f':
      case 'F':
        app.followSelected();
        break;
      case 'r':
      case 'R':
        app.reload();
        break;
      case 't':
      case 'T':
        app.setView(-90, 89.5); // straight down onto the ecliptic
        break;
      case 'e':
      case 'E':
        app.setView(-90, 0); // edge-on
        break;
    }
  });
}
