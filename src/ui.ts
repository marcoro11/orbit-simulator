import { App, BuildElements, Tool } from './app';
import { BODY_TYPES, MASS_UNITS, MassUnit, typeById } from './catalog';
import { formatAu, formatDays, formatDuration, formatMass, formatSpeed } from './format';
import { DAYS_PER_YEAR } from './physics/constants';
import { PRESETS } from './presets';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

/** Sliders are logarithmic so a single control spans several decades. */
const log = {
  toValue: (slider: number) => Math.pow(10, slider),
  toSlider: (value: number) => Math.log10(value),
};

export function bindUI(app: App): { tick: () => void } {
  const presetSel = el<HTMLSelectElement>('preset');
  const presetDesc = el('preset-desc');
  const playPause = el<HTMLButtonElement>('playpause');
  const dtSlider = el<HTMLInputElement>('dt');
  const dtVal = el('dt-val');
  const spfSlider = el<HTMLInputElement>('spf');
  const spfVal = el('spf-val');
  const rateHint = el('rate-hint');
  const typeSel = el<HTMLSelectElement>('body-type');
  const massInput = el<HTMLInputElement>('body-mass');
  const massUnitSel = el<HTMLSelectElement>('body-massunit');
  const typeNote = el('type-note');
  const buildParent = el<HTMLSelectElement>('build-parent');
  const buildDist = el<HTMLInputElement>('build-dist');
  const buildEcc = el<HTMLInputElement>('build-ecc');
  const buildIncl = el<HTMLInputElement>('build-incl');
  const buildAngle = el<HTMLInputElement>('build-angle');
  const buildReadout = el('build-readout');
  const heightSlider = el<HTMLInputElement>('height');
  const heightVal = el('height-val');
  const softSlider = el<HTMLInputElement>('softening');
  const softVal = el('soft-val');
  const trailSlider = el<HTMLInputElement>('traillen');
  const trailVal = el('trail-val');
  const sizeSlider = el<HTMLInputElement>('bodysize');
  const sizeVal = el('bodysize-val');
  const toast = el('toast');

  const selEmpty = el('sel-empty');
  const selBody = el('sel-body');
  const selDot = el('sel-dot');
  const selTitle = el('sel-title');
  const selMass = el('sel-mass');
  const selSpeed = el('sel-speed');
  const selDist = el('sel-dist');
  const selZ = el('sel-z');
  const selFollow = el<HTMLButtonElement>('sel-follow');

  // ---------- presets ----------

  for (const p of PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    presetSel.append(opt);
  }

  presetSel.addEventListener('change', () => {
    const preset = PRESETS.find((p) => p.id === presetSel.value);
    if (preset) app.loadPreset(preset);
  });

  el('reset').addEventListener('click', () => app.reload());

  // ---------- camera ----------

  el('view-top').addEventListener('click', () => app.setView(-90, 89.5));
  el('view-tilt').addEventListener('click', () => app.setView(-90, 25));
  el('view-edge').addEventListener('click', () => app.setView(-90, 0));

  // ---------- time ----------

  playPause.addEventListener('click', () => app.toggleRun());
  el('stepone').addEventListener('click', () => {
    app.running = false;
    app.stepOnce();
  });

  dtSlider.addEventListener('input', () => {
    app.dt = log.toValue(Number(dtSlider.value));
    syncTimeLabels();
  });
  spfSlider.addEventListener('input', () => {
    app.stepsPerFrame = Number(spfSlider.value);
    syncTimeLabels();
  });

  function syncTimeLabels(): void {
    dtVal.textContent = formatDays(app.dt);
    spfVal.textContent = String(app.stepsPerFrame);
    const perFrame = app.dt * app.stepsPerFrame;
    const perSecond = (perFrame * 60) / DAYS_PER_YEAR;
    rateHint.textContent =
      `${formatDays(perFrame)} per frame · about ${perSecond.toFixed(perSecond < 1 ? 2 : 1)} sim-years per real second at 60 fps.`;
  }

  // ---------- tool + new body ----------

  const toolButtons = Array.from(el('tool').querySelectorAll('button'));
  for (const btn of toolButtons) {
    btn.addEventListener('click', () => {
      app.tool = btn.dataset.tool as Tool;
      for (const b of toolButtons) b.classList.toggle('on', b === btn);
    });
  }

  // Catalog dropdown, grouped by kind.
  {
    let group: HTMLOptGroupElement | null = null;
    for (const type of BODY_TYPES) {
      if (!group || group.label !== type.group) {
        group = document.createElement('optgroup');
        group.label = type.group;
        typeSel.append(group);
      }
      const opt = document.createElement('option');
      opt.value = type.id;
      opt.textContent = type.label;
      group.append(opt);
    }
  }

  typeSel.addEventListener('change', () => {
    app.newType = typeById(typeSel.value);
    app.newBodyMass = app.newType.mass;
    massUnitSel.value = app.newType.unit;
    syncMassBox();
  });

  massUnitSel.addEventListener('change', syncMassBox);

  massInput.addEventListener('input', () => {
    const v = Number(massInput.value);
    if (Number.isFinite(v) && v > 0) {
      app.newBodyMass = v * MASS_UNITS[massUnitSel.value as MassUnit].inSolar;
      refreshBuildReadout();
    }
  });

  /** Show the stored solar-mass value in whichever unit is selected. */
  function syncMassBox(): void {
    const unit = MASS_UNITS[massUnitSel.value as MassUnit];
    const shown = app.newBodyMass / unit.inSolar;
    // An asteroid in Earth masses is 3.3e-5; spelled out in full it's unreadable.
    // Number inputs accept exponential notation, so use it at the extremes.
    massInput.value =
      shown !== 0 && (Math.abs(shown) < 1e-3 || Math.abs(shown) >= 1e6)
        ? shown.toExponential(4)
        : String(Number(shown.toPrecision(6)));
    typeNote.textContent = app.newType.note;
    refreshBuildReadout();
  }

  heightSlider.addEventListener('input', () => {
    app.placementFraction = Number(heightSlider.value);
  });

  // ---------- precise builder ----------

  const readElements = (): BuildElements => ({
    parentId: buildParent.value === '' ? null : Number(buildParent.value),
    distance: Number(buildDist.value),
    eccentricity: Number(buildEcc.value),
    inclinationDeg: Number(buildIncl.value),
    angleDeg: Number(buildAngle.value),
  });

  /** Rebuild the parent list, keeping the current pick if it still exists. */
  function syncParents(): void {
    const wanted = buildParent.value === '' ? null : Number(buildParent.value);
    buildParent.replaceChildren();

    if (app.world.bodies.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'nothing yet — placed at the origin';
      buildParent.append(opt);
      return;
    }
    for (const b of app.world.bodies) {
      const opt = document.createElement('option');
      opt.value = String(b.id);
      opt.textContent = `${b.name} · ${formatMass(b.mass)}`;
      buildParent.append(opt);
    }
    const stillThere = wanted !== null && app.world.get(wanted);
    buildParent.value = String(stillThere ? wanted : app.defaultParentId());
  }

  function refreshBuildReadout(): void {
    const info = app.buildInfo(readElements());
    if (!info) {
      const empty = app.world.bodies.length === 0;
      buildReadout.className = 'readout bad';
      buildReadout.textContent = empty
        ? 'Empty system — this body will be placed at the origin, at rest.'
        : 'Enter a distance greater than zero.';
      return;
    }
    let text =
      `period ${formatDuration(info.period)} · speed ${formatSpeed(info.speed)}\n` +
      `periapsis ${formatAu(info.periapsis)} · apoapsis ${formatAu(info.apoapsis)}`;

    // A fixed-step integrator loses accuracy on eccentric orbits, so say so
    // rather than letting the orbit quietly precess and look like a bug.
    const coarse = app.dt > info.suggestedDt * 1.5;
    if (coarse) {
      text += `\n⚠ step ${formatDays(app.dt)} is coarse here — use ${formatDays(info.suggestedDt)} or less`;
    }
    buildReadout.className = coarse ? 'readout warn' : 'readout';
    buildReadout.textContent = text;
  }

  for (const input of [buildParent, buildDist, buildEcc, buildIncl, buildAngle]) {
    input.addEventListener('input', refreshBuildReadout);
    input.addEventListener('change', refreshBuildReadout);
  }

  el('build-add').addEventListener('click', () => {
    const el0 = readElements();
    const body = app.buildBody(el0);
    if (!body) {
      app.onToast?.('Set a distance greater than zero first');
      return;
    }
    // Advance the start angle by the golden angle so a run of adds spreads out
    // around the orbit instead of piling up along one radius.
    buildAngle.value = String(Math.round((el0.angleDeg + 137.5) % 360));
    app.onToast?.(`Added ${body.name}`);
    refreshBuildReadout();
  });

  // ---------- selection ----------

  selFollow.addEventListener('click', () => app.followSelected());
  el('sel-delete').addEventListener('click', () => app.deleteSelected());

  // ---------- display ----------

  const bindCheck = (id: string, apply: (on: boolean) => void): void => {
    const input = el<HTMLInputElement>(id);
    apply(input.checked);
    input.addEventListener('change', () => apply(input.checked));
  };

  bindCheck('opt-trails', (on) => (app.options.showTrails = on));
  bindCheck('opt-grid', (on) => (app.options.showGrid = on));
  bindCheck('opt-drops', (on) => (app.options.showDropLines = on));
  bindCheck('opt-labels', (on) => (app.options.showLabels = on));
  bindCheck('opt-merge', (on) => (app.world.mergeOnCollision = on));

  trailSlider.addEventListener('input', () => {
    const n = Number(trailSlider.value);
    app.setTrailLength(n);
    trailVal.textContent = `${n} pts`;
  });

  sizeSlider.addEventListener('input', () => {
    app.options.bodyScale = Number(sizeSlider.value);
    sizeVal.textContent = `${app.options.bodyScale.toFixed(2)}×`;
  });

  el('clear-trails').addEventListener('click', () => app.world.clearTrails());

  softSlider.addEventListener('input', () => {
    const v = Number(softSlider.value);
    app.world.softening = v <= -6.99 ? 0 : log.toValue(v);
    syncSoftLabel();
  });

  function syncSoftLabel(): void {
    softVal.textContent = app.world.softening === 0 ? 'off' : formatAu(app.world.softening);
  }

  // ---------- sync ----------

  function syncPanel(): void {
    presetSel.value = app.preset.id;
    presetDesc.textContent = app.preset.description;
    playPause.textContent = app.running ? 'Pause' : 'Play';

    dtSlider.value = String(log.toSlider(app.dt));
    spfSlider.value = String(app.stepsPerFrame);
    syncTimeLabels();

    typeSel.value = app.newType.id;
    massUnitSel.value = app.newType.unit;
    syncMassBox();
    syncParents();
    refreshBuildReadout();
    heightSlider.value = String(app.placementFraction);

    softSlider.value = String(app.world.softening === 0 ? -7 : log.toSlider(app.world.softening));
    syncSoftLabel();

    trailVal.textContent = `${trailSlider.value} pts`;
    sizeVal.textContent = `${app.options.bodyScale.toFixed(2)}×`;
  }

  let toastTimer = 0;
  app.onToast = (msg) => {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1900);
  };
  app.onChange = syncPanel;

  // ---------- per-frame readouts ----------

  const hudTime = el('hud-time');
  const hudCount = el('hud-count');
  const hudGrid = el('hud-grid');
  const hudEnergy = el('hud-energy');
  const hudFps = el('hud-fps');
  let wasDragging = false;

  function tick(): void {
    hudTime.textContent = formatDuration(app.world.time);
    hudCount.textContent = String(app.world.bodies.length);
    hudGrid.textContent = app.gridSpacing > 0 ? formatAu(app.gridSpacing) : '—';
    hudFps.textContent = app.fpsValue.toFixed(0);

    // A good run sits around 1e-12 %, so fixed-point would just read "0.00%".
    const drift = app.energyDriftValue;
    const pct = drift * 100;
    hudEnergy.textContent =
      Math.abs(pct) < 0.01 ? `${pct.toExponential(1)}%` : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    hudEnergy.style.color =
      Math.abs(drift) < 1e-3 ? '#7ee787' : Math.abs(drift) < 0.05 ? '#ffe66d' : '#f78166';

    const h = app.placementHeight;
    heightVal.textContent = h === 0 ? 'on plane' : `${h > 0 ? '+' : '−'}${formatAu(Math.abs(h))}`;

    const body = app.world.get(app.selectedId);
    if (!body) {
      selEmpty.hidden = false;
      selBody.hidden = true;
    } else {
      selEmpty.hidden = true;
      selBody.hidden = false;
      selDot.style.background = body.color;
      selTitle.textContent = body.name;
      selMass.textContent = formatMass(body.mass);
      selSpeed.textContent = formatSpeed(Math.hypot(body.vx, body.vy, body.vz));
      const com = app.world.centerOfMass();
      selDist.textContent = formatAu(
        Math.hypot(body.x - com.x, body.y - com.y, body.z - com.z),
      );
      selZ.textContent = `${body.z >= 0 ? '+' : '−'}${formatAu(Math.abs(body.z))}`;
      selFollow.textContent = app.camera.followId === body.id ? 'Unfollow' : 'Follow';
    }

    // While dragging, the rate hint doubles as a launch-velocity readout.
    const drag = app.dragInfo;
    if (drag) {
      rateHint.textContent = `Launch: ${formatSpeed(drag.speed)} — ${drag.vCircRatio.toFixed(2)}× local circular orbit speed (1.00 ≈ circular, 1.41 ≈ escape).`;
      wasDragging = true;
    } else if (wasDragging) {
      wasDragging = false;
      syncTimeLabels();
    }
  }

  syncPanel();
  return { tick };
}
