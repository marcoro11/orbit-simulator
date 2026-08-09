# Orbit Simulator

An interactive 3D N-body gravity sandbox. Add and remove stars, planets and
moons, launch them by dragging, and watch what actually happens.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # physics regression suite
npm run build    # typecheck + production build
```

One runtime dependency (three.js). Everything else — physics, camera, UI — is
hand-written TypeScript.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The workflow runs
the physics suite first, so a deploy can't go out on a broken integrator.

It publishes by force-pushing the built `dist/` to a `gh-pages` branch, which
needs nothing beyond `contents: write` and sets Pages up on its own the first
time that branch appears. The newer `actions/deploy-pages` route is tidier on
paper but additionally requires the Pages site to already exist, and
`GITHUB_TOKEN` has no permission to create one — so it can never succeed on a
fresh repo without someone configuring it by hand first.

Vite's `base` is `'./'` rather than the usual hardcoded `'/<repo>/'`. A project
page is served from `https://<user>.github.io/<repo>/`, and with the default base
of `'/'` the built page asks for `/assets/index.js`, which resolves to the domain
root, 404s, and renders blank with no obvious cause. Relative URLs work at the
domain root, under any repo name, and straight off the filesystem — and there's
no client-side routing here to complicate them.

No repo configuration is needed. If Pages was previously pointed at "GitHub
Actions" as its source, switch **Settings → Pages → Source** back to **Deploy
from a branch**, `gh-pages` / `/ (root)`.

## About the three-body problem

The famous result is that there's no *closed-form analytic solution* — no formula
you plug `t` into. That doesn't stop you simulating it. Numerically, N-body
gravity is just

```
a_i = Σ_j  G·m_j·(r_j − r_i) / |r_j − r_i|³
```

integrated forward in time. Chaos means long-term outcomes aren't *predictable*,
not that they're uncomputable. It's also what makes the sandbox fun: nudge one
mass and the whole story changes.

## Design notes

**Units.** Length in AU, mass in solar masses, time in days, so
`G = 2.959122e-4`. Earth's orbit has radius 1 and period 365.25; the Sun has
mass 1. SI would work too, but `1e30` kg and `1e11` m make every intermediate
value unreadable and every bug harder to spot.

**Integrator.** Kick–drift–kick leapfrog ([`world.ts`](src/physics/world.ts)),
which is *symplectic*: its energy error oscillates around the true value instead
of accumulating, so bound orbits stay bound indefinitely. Explicit Euler at the
same step size drifts about **10⁹×** worse over a century — that's a measured
number, from the test suite. This one choice is most of what separates "works"
from "planets visibly spiral away in ten seconds".

**Z-up, not Y-up.** The scene uses three.js with `camera.up = +Z`, so the XY
plane is the ecliptic and physics coordinates map straight through without a
swizzle. The top-down view then lines up exactly with the plane the presets are
defined in.

**Softening.** Close encounters send `1/r²` toward infinity and fling bodies out
of the system. A Plummer softening length ε replaces `r²` with `r² + ε²`, capping
the peak force. The default is 10⁻⁵ AU (~1500 km) — negligible for real orbits,
enough to stop a numerical explosion. Adjustable, including off.

**Collisions.** Bodies whose physical radii overlap merge, conserving mass and
momentum, with volumes adding. Physical radii are stored per body and used *only*
here.

**Drawn size is not physical size.** At true scale every planet is far below one
pixel. Screen radius goes as the sixth root of mass, compressing the ~10⁶ range
between a moon and a star into a readable 3–27 px. Meshes are re-scaled in world
units every frame so that pixel size holds at any depth — which means distant
planets stay clickable, and hit-testing can share the same function, so clicks
always match what you see. Depth is carried by shading, the perspective grid and
the drop lines instead of by size.

**Lighting is deliberately not inverse-square.** Stars are real point lights, but
with `decay = 0`. With physical falloff, Neptune would be ~900× dimmer than Earth
and simply invisible. Keeping the directional shading (which reads as 3D) while
dropping the brightness gradient (which would hide the outer system) is the right
trade for a viewer.

**Drag-to-launch is scale-free.** A 150 px drag always means "local circular
orbit speed", measured against whichever body dominates at that point. Direction
comes from the drag projected onto the placement plane, but *magnitude* comes
from the drag in pixels — mixing them that way keeps the control predictable at
grazing camera angles, where a small screen movement sweeps an enormous distance
across the plane. New bodies land on a horizontal plane whose height is a slider,
so you can launch something out of the ecliptic.

**The preview is the real integrator.** The dashed path is the actual simulation
running on a copy of the world, so what it draws is what you get. Its time span
scales with the local orbital period rather than being a fixed step count —
otherwise it traces a full loop next to a star and a barely-visible stub out at
Neptune, where the period is thousands of times longer.

**Performance.** Forces are O(N²), which is comfortable to ~2000 bodies at 60 fps.
Barnes–Hut (O(N log N)) would be the next step if you ever want galaxy scale.

## Building a system precisely

Dragging is good for playing; it's no good for "put a gas giant at exactly
5.2 AU on a 3° incline". The **Build precisely** panel takes classical orbital
elements instead:

| Field | Meaning |
| --- | --- |
| Orbits around | any existing body — so moons orbit planets, not the star |
| Distance | semi-major axis from that parent, in AU |
| Eccentricity | 0 = circle, 0.9 = a comet-like ellipse |
| Inclination | tilt of the orbital plane, in degrees |
| Start angle | where round the orbit it begins |

A live readout shows the resulting **period, speed, periapsis and apoapsis before
you commit**, so you can dial in a number rather than guess. The start angle
advances by the golden angle after each add, so a run of adds spreads out instead
of piling up along one radius.

Two details worth knowing:

- The two-body μ uses G(M_parent + m_new), not G·M_parent, so the period shown is
  the one you actually get even when the new body is a serious fraction of its
  parent's mass.
- If the current step size is too coarse for the orbit you're describing, the
  readout says so and suggests a smaller one. That matters most at high
  eccentricity — see below.

**Why eccentric orbits need smaller steps.** A fixed-step integrator has to
resolve periapsis passage, which gets dramatically faster as e grows: the
characteristic time there is roughly `(T/2π)·(1−e)^1.5/√(1+e)`. At e = 0.9 that's
~45× shorter than at e = 0. Ignore it and the orbit visibly precesses — which
looks like a bug but is just under-resolution. The test suite pins this down:
quartering the step cuts the error by 16.0×, exactly the dt² convergence leapfrog
should show.

## The catalog

Every body is created from a catalog entry, which sets its mass, physical radius,
colour and render class. Drag-placement and the precise builder both use it.

| Group | Types |
| --- | --- |
| Stars | red dwarf (M), orange dwarf (K), yellow dwarf (G), white (A), blue giant (B/O), red giant |
| Compact objects | white dwarf, neutron star, stellar black hole, supermassive black hole |
| Planets & smaller | brown dwarf, gas giant, ice giant, super-Earth, terrestrial, moon, asteroid |

Mass is editable per body and can be entered in Earth, Jupiter or solar masses.
Physical radii come from the type — main-sequence stars follow a rough
`R ∝ M^0.8` (below 1 M☉) / `R ∝ M^0.57` (above) relation, a red giant is 50 R☉, a
neutron star is 11 km.

Drawn size can't be mass alone once the catalog exists: a red giant and a white
dwarf are within a factor of two in mass but utterly different objects. Each type
carries a `displayScale` that multiplies the mass-derived screen radius, so the
size classes stay distinguishable.

**Black holes.** The horizon is the real Schwarzschild radius, `2GM/c²` — 29.5 km
for 10 M☉, or `1.97e-7 AU`. That's deliberate, because the interesting fact is the
contrast: **gravitationally a 10 M☉ black hole is just a 10 M☉ point mass.** An
orbit at 1 AU around one is identical to an orbit around a 10 M☉ star, to the last
decimal — the test suite asserts exactly that. The difference only appears within
~30 km of the centre. Rendering-wise a black sphere on a black background is
invisible, so what you actually see is the accretion ring; the sphere punches the
void through its middle, and black holes emit no light into the scene.

A system containing no light source at all (say, one black hole and some planets)
would render pure black, so the renderer falls back to flat ambient lighting when
there's nothing shining.

## It's checkable

Gravity has known answers, so `npm test` verifies against them rather than
eyeballing:

| Check | Result |
| --- | --- |
| Circular orbit, 100 yr | radius stable to 3×10⁻⁵ AU |
| Energy drift, 100 yr | \|ΔE/E\| ≈ 2×10⁻¹⁴ |
| Kepler III at 0.4 / 1 / 5.2 / 19.2 AU | periods match theory to <3×10⁻³ % |
| Figure-eight, 20 laps | returns to start within 7×10⁻⁵ AU |
| Jupiter Trojans, 300 yr | librate ±9.3° around L4/L5 |
| Total angular momentum (3D) | conserved to 4×10⁻¹⁵ |
| Orbital inclinations | 0° / 35° / 70° / 110° reproduced to 0.001° |
| Elements at e = 0 / 0.3 / 0.6 / 0.9 | periapsis and apoapsis match a(1∓e) to <10⁻⁴ |
| Integrator convergence | 4× finer step ⇒ 16.0× less error (2nd order) |
| Black hole horizon | 29.5 km for 10 M☉, and it pulls identically to a 10 M☉ star |
| Building from an empty world | orbit matches its stated elements; drift 6×10⁻¹⁴ |
| Merges | mass and momentum exactly conserved |

The figure-eight is the sharpest test: it's an exact three-body solution that
falls apart quickly under a sloppy integrator. Angular momentum is the one that
matters in 3D specifically — if the out-of-plane force components were wrong,
`Lx` and `Ly` would drift even while `Lz` still looked fine.

**A note on the Inclined Orbits preset.** Its four planets' inclinations drift by
~12° per 400 years. That is real mutual perturbation, not integration error: the
drift scales linearly with planet mass (0.04° at Earth mass, 0.68° at Neptune
mass, 11.8° at Jupiter mass) and is *identical* at `dt = 0.5` and `dt = 0.05`.
Integration error would shrink with the step; this doesn't move. So the test
asserts what's actually invariant — total angular momentum, exactly — plus a
bound on the precession.

## Presets

- **Empty — start from scratch** — nothing at all. The first body you add has no
  parent to orbit, so it goes to the origin at rest; everything after that hangs
  off it. Listed first so it's easy to find, though the app opens on the Solar
  System rather than an empty void.
- **Solar System** / **Inner Solar System** — all eight planets with their real
  inclinations and ascending nodes. They genuinely do not share a plane.
- **Sun · Earth · Moon** — hierarchical, with the Moon's real 5.1° tilt.
- **Inclined Orbits** — four planets at 0°, 35°, 70°, 110°; the last is retrograde.
- **Black Hole Binary** — a 10 M☉ black hole and a white star, with a white dwarf
  and a neutron star further out.
- **Figure-Eight** — the Chenciner–Montgomery three-body solution.
- **Binary Star + Planet** — a circumbinary planet plus an inclined outer companion.
- **Jupiter Trojans** — test particles at L4/L5 doing tadpole libration.
- **Chaotic Cluster** — fourteen random stars in a spherical cloud, different every run.

## Controls

| | |
| --- | --- |
| **Ctrl** (or **⌘**) **+ drag** | orbit the camera — works in any tool |
| **Shift + drag** | slide the view |
| Right-drag / middle-drag | orbit / slide |
| Wheel | zoom toward the cursor |
| Drag on empty space (Add mode) | place a body; direction and length set launch velocity |
| Click | select a body |
| <kbd>Space</kbd> | play / pause |
| <kbd>T</kbd> / <kbd>E</kbd> | top-down / edge-on view |
| <kbd>F</kbd> | follow selection |
| <kbd>Delete</kbd> | remove selection |
| <kbd>R</kbd> | reload preset |

The HUD's energy-drift readout is the honesty check: green means the integrator
is conserving energy, red means the step size is too large for what's happening
on screen.

It re-baselines whenever the set of bodies changes — an add, a delete, or a merge.
Those change the system's total energy discontinuously and for entirely legitimate
reasons (a merge is inelastic and really does lose kinetic energy), so without a
reset they'd swamp the reading and it would stop being a measure of *integration*
error. This matters most when building from the empty preset, where the baseline
would otherwise be the empty system's zero energy forever.

## Layout

```
src/
  physics/    world.ts (integrator, forces, collisions), kepler.ts (orbital
              elements), body.ts, trail.ts, constants.ts
  render/     camera.ts (turntable camera + projection), scene.ts (three.js), labels.ts
  catalog.ts  body types: stars, compact objects, black holes, planets
  app.ts      simulation state, frame loop, placement and the precise builder
  ui.ts       control-panel bindings
  interaction.ts  pointer + keyboard
  presets.ts  initial conditions
test/
  physics.test.ts
```

## Deliberately out of scope

General relativity (Mercury's perihelion precession), tidal forces and non-point
masses, and ephemeris-grade accuracy for real Solar System prediction. Each of
those is a much larger project than this one.
