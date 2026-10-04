// The journey: a camera flying forward (+z) forever through procedurally generated
// sectors. A director picks the next event (planet flyby, star, black hole, nebula,
// asteroid field, comet, pulsar, warp jump, wormhole) from a seeded RNG, so the
// sequence of encounters is reproducible from the seed.

import { Rng, sectorName, bodyName } from './rng.js';
import {
  smooth, hsl, rgba, PLANET_KINDS, STAR_CLASSES,
  planetJob, ringSprite, starSurfaceJob, diskJob, nebulaPuff, galaxySprite, rockSprite, skyJob,
} from './textures.js';

const STAR_FAR = 3000;
const BODY_FAR = 14000;
const CRUISE = 520;            // world units per second at 1×
const WARP = 30000;
const WARP_GENTLE = 9000;      // reduced-motion warp speed
const JOB_BUDGET_MS = 5;
const TAU = Math.PI * 2;

const STAR_TINTS = [[255, 255, 255], [200, 215, 255], [255, 240, 220], [255, 215, 170], [180, 200, 255], [255, 190, 150]];
const STAR_TINT_CSS = STAR_TINTS.map((c) => rgba(c));

const EVENT_WEIGHTS = {
  planet: 26, star: 11, blackhole: 7, nebula: 9, asteroids: 9, comet: 8, pulsar: 5, warp: 11, wormhole: 7,
};

const ease = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/** A field of points that stream towards the camera and respawn at the far plane. */
class Field {
  constructor(rng, count, far, spread, size, maxPx) {
    this.rng = rng;
    this.far = far;
    this.spread = spread;
    this.size = size;
    this.maxPx = maxPx;
    this.resize(count);
  }

  resize(count) {
    this.n = count;
    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.z = new Float32Array(count);
    this.tint = new Uint8Array(count);
    this.mag = new Float32Array(count);
    for (let i = 0; i < count; i++) this.spawn(i, this.rng.float(1, this.far));
  }

  spawn(i, z) {
    const r = this.rng;
    this.x[i] = r.float(-1, 1) * this.spread;
    this.y[i] = r.float(-1, 1) * this.spread;
    this.z[i] = z;
    this.tint[i] = r.int(0, STAR_TINTS.length - 1);
    this.mag[i] = 0.4 + Math.pow(r.next(), 2) * 1.2;
  }
}

export class Journey {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dprCap = 1.5;
    this.speedScale = 1;
    this.reducedMotion = false;
    this.onCaption = () => {};
    this.frameTimes = [];
    this.resize();
  }

  // --- setup ----------------------------------------------------------------------

  start(seed) {
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.fx = new Rng(this.seed ^ 0x9e3779b9); // cosmetic stream (stars, dust)
    this.time = 0;
    this.speed = CRUISE;
    this.phase = 'cruise';
    this.bodies = [];
    this.jobs = [];
    this.flash = 0;
    this.flashColor = [255, 255, 255];
    this.warp = null;
    this.tunnel = null;
    this.lastEvent = null;
    this.eventCount = 0;
    this.nextEventAt = 3;
    this.sectorCount = 0;
    this.stars = new Field(this.fx, this.starCount(), STAR_FAR, 3200, 2.2, 3.2);
    this.dust = new Field(this.fx, 70, 260, 200, 0.35, 2);
    this.sector = this.makeSector(true);
    this.prevSector = null;
    this.skyFade = 1;
    this.prepareNextSector();
    this.announce({ kicker: 'Now entering', title: this.sector.name, sub: `seed ${this.seed.toString(16).padStart(8, '0')}` });
  }

  starCount() {
    const area = (this.W * this.H) / (this.dpr * this.dpr);
    return Math.round(Math.max(500, Math.min(1800, area / 900)));
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    this.dpr = dpr;
    this.canvas.width = this.W = w;
    this.canvas.height = this.H = h;
    this.f = Math.max(w, h) * 0.62;
    this.halfDiag = Math.hypot(w, h) / 2;
    if (this.stars) this.stars.resize(this.starCount());
  }

  announce(caption) { this.onCaption(caption); }

  // --- background jobs --------------------------------------------------------------

  /** Queue a generator; `done` gets its return value. Returns the job handle. */
  addJob(gen, done) {
    const job = { gen, done, finished: false };
    this.jobs.push(job);
    return job;
  }

  finishJob(job) {
    if (job.finished) return;
    let r;
    do r = job.gen.next(); while (!r.done);
    job.finished = true;
    this.jobs.splice(this.jobs.indexOf(job), 1);
    job.done(r.value);
  }

  runJobs() {
    const end = performance.now() + JOB_BUDGET_MS;
    while (this.jobs.length && performance.now() < end) {
      const job = this.jobs[0];
      const r = job.gen.next();
      if (r.done) {
        job.finished = true;
        this.jobs.shift();
        job.done(r.value);
      }
    }
  }

  // --- sectors ----------------------------------------------------------------------

  makeSector(sync = false) {
    const rng = this.rng.fork();
    const hueA = rng.float(0, 360);
    const hueB = hueA + rng.sign() * rng.float(40, 150);
    const la = rng.float(0, TAU);
    const light = [Math.cos(la) * 0.85, Math.sin(la) * 0.55, rng.float(0.15, 0.6)];
    const ll = Math.hypot(...light);
    const sector = {
      name: sectorName(rng),
      rng,
      hueA, hueB,
      colorA: hsl(hueA, rng.float(0.5, 0.9), rng.float(0.45, 0.6)),
      colorB: hsl(hueB, rng.float(0.5, 0.9), rng.float(0.4, 0.6)),
      light: light.map((v) => v / ll),
      sky: null,
      ready: false,
      galaxies: [],
      puffs: [],
      rocks: [],
    };
    const palette = {
      a: sector.colorA,
      b: sector.colorB,
      base: hsl(hueA + 20, 0.5, rng.float(0.012, 0.03)),
      intensity: rng.float(0.35, 0.95),
    };
    for (let i = 0; i < rng.int(0, 3); i++) {
      sector.galaxies.push({
        sprite: galaxySprite(rng), x: rng.float(-0.4, 0.4), y: rng.float(-0.4, 0.4),
        scale: rng.float(0.02, 0.07), rot: rng.float(0, TAU), squash: rng.float(0.25, 1), alpha: rng.float(0.35, 0.8),
      });
    }
    for (let i = 0; i < 6; i++) {
      sector.puffs.push(nebulaPuff(rng, hsl(hueA + rng.float(-20, 20), 0.6, 0.45), hsl(hueB + rng.float(-20, 20), 0.55, 0.4)));
    }
    for (let i = 0; i < 8; i++) sector.rocks.push(rockSprite(rng, sector.light));
    sector.job = this.addJob(skyJob({ rng, palette }), (sky) => {
      sector.sky = sky;
      sector.ready = true;
    });
    if (sync) this.finishJob(sector.job);
    return sector;
  }

  prepareNextSector() {
    this.nextSector = this.makeSector(false);
  }

  switchSector() {
    if (!this.nextSector.ready) this.finishJob(this.nextSector.job);
    this.prevSector = this.sector;
    this.sector = this.nextSector;
    this.skyFade = 0;
    this.sectorCount++;
    this.prepareNextSector();
    this.announce({ kicker: 'Now entering', title: this.sector.name });
  }

  // --- director ---------------------------------------------------------------------

  /** Picks and starts the next event. `force` names one directly. */
  nextEvent(force) {
    const rng = this.rng;
    let kind = force;
    if (!kind) {
      const weights = { ...EVENT_WEIGHTS };
      if (this.lastEvent) weights[this.lastEvent] *= 0.15;
      if (this.eventCount === 0) weights.warp = weights.wormhole = 0; // open with a view
      kind = rng.weighted(weights);
    }
    // Jumps need a clear road ahead.
    if ((kind === 'warp' || kind === 'wormhole') && this.bodies.some((b) => b.big && b.z > 0 && b.z < BODY_FAR * 0.5)) {
      if (force) return false;
      kind = 'planet';
    }
    this.lastEvent = kind;
    this.eventCount++;
    switch (kind) {
      case 'planet': this.spawnPlanetSystem(); break;
      case 'star': this.spawnStar(); break;
      case 'blackhole': this.spawnBlackHole(); break;
      case 'nebula': this.spawnNebula(); break;
      case 'asteroids': this.spawnAsteroids(); break;
      case 'comet': this.spawnComet(); break;
      case 'pulsar': this.spawnPulsar(); break;
      case 'warp': this.startWarp(); break;
      case 'wormhole': this.spawnWormhole(); break;
    }
    this.nextEventAt = this.time + (kind === 'warp' ? 12 : kind === 'wormhole' ? 30 : rng.float(9, 17)) / this.speedScale;
    return true;
  }

  /** Lateral offset (world units) so a body of radius R passes at `clearance` × R. */
  passOffset(R, min, max) {
    const a = this.rng.float(0, TAU);
    const d = R * this.rng.float(min, max) + 250;
    return [Math.cos(a) * d, Math.sin(a) * d * 0.75];
  }

  addBody(body) {
    body.born = this.time;
    this.bodies.push(body);
    return body;
  }

  spawnPlanetSystem() {
    const rng = this.rng.fork();
    const kinds = Object.fromEntries(Object.entries(PLANET_KINDS).map(([k, v]) => [k, v.weight]));
    const kind = rng.weighted(kinds);
    const giant = kind === 'gas' || kind === 'toxic';
    const R = giant ? rng.float(700, 1500) : rng.float(260, 650);
    const [x, y] = this.passOffset(R, 1.3, 2.6);
    const z = BODY_FAR;
    const name = bodyName(rng, 'planet');
    const ringed = giant ? rng.chance(0.55) : rng.chance(0.12);
    const moons = rng.int(0, giant ? 4 : 2);
    const planet = this.makePlanet(rng, kind, R, x, y, z, 384, ringed);
    planet.announce = {
      kicker: PLANET_KINDS[kind].label,
      title: name,
      sub: [ringed ? 'ringed' : null, moons ? `${moons} moon${moons > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ') || null,
    };
    for (let i = 0; i < moons; i++) {
      const mr = R * rng.float(0.08, 0.25);
      const a = rng.float(0, TAU);
      const d = R * rng.float(1.8, 4.5);
      const mz = z + rng.float(-1, 1) * d * 0.8;
      const moonKind = rng.weighted({ barren: 4, ice: 2, desert: 1, lava: 1 });
      this.makePlanet(rng, moonKind, mr, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.5, mz, 160, false);
    }
  }

  makePlanet(rng, kind, R, x, y, z, size, ringed) {
    const body = this.addBody({ type: 'planet', x, y, z, R, big: true, occluder: true, sprite: null });
    this.addJob(planetJob({ rng: rng.fork(), kind, size, light: this.sector.light }), (res) => {
      body.sprite = res.canvas;
      body.diskFrac = res.diskFrac;
    });
    if (ringed) {
      body.ring = {
        sprite: ringSprite(rng, 512, rng.float(0.45, 0.6)),
        outer: R * rng.float(1.9, 2.6),
        tilt: rng.float(0.12, 0.42),
        angle: rng.float(-0.5, 0.5),
      };
    }
    return body;
  }

  spawnStar() {
    const rng = this.rng.fork();
    const classes = Object.fromEntries(Object.entries(STAR_CLASSES).map(([k, v]) => [k, v.weight]));
    const cls = rng.weighted(classes);
    const info = STAR_CLASSES[cls];
    const binary = cls !== 'RG' && rng.chance(0.3);
    const R = 420 * rng.float(...info.size);
    const [x, y] = this.passOffset(R, binary ? 4 : 2.2, binary ? 7 : 4.5);
    const name = bodyName(rng, 'star');
    const first = this.makeStar(rng, info.color, R, x, y, BODY_FAR);
    first.announce = { kicker: binary ? 'Binary system' : info.label, title: binary ? `${name} A/B` : name, sub: binary ? info.label : null };
    if (binary) {
      const cls2 = rng.pick(['G', 'K', 'M', 'WD', 'F']);
      const second = this.makeStar(rng, STAR_CLASSES[cls2].color, 420 * rng.float(...STAR_CLASSES[cls2].size), x, y, BODY_FAR);
      // Shared barycentre; the heavier star sits closer to it, on the opposite side.
      const orbit = { cx: x, cz: BODY_FAR, a: R * rng.float(3.5, 5), phase: rng.float(0, TAU), w: rng.float(0.15, 0.3), at: -1 };
      first.orbit = orbit; first.orbitFrac = 0.35; first.orbitSide = 0;
      second.orbit = orbit; second.orbitFrac = 0.65; second.orbitSide = Math.PI;
    }
  }

  makeStar(rng, color, R, x, y, z) {
    const body = this.addBody({ type: 'star', x, y, z, R, color, big: true, occluder: true, sprite: null, rayPhase: rng.float(0, TAU), rays: rng.int(6, 12) });
    this.addJob(starSurfaceJob({ rng: rng.fork(), color, size: 192 }), (c) => (body.sprite = c));
    return body;
  }

  spawnBlackHole() {
    const rng = this.rng.fork();
    const R = rng.float(110, 220);
    const [x, y] = this.passOffset(R, 5, 8);
    const body = this.addBody({
      type: 'blackhole', x, y, z: BODY_FAR, R, big: true, occluder: true, disk: null,
      tilt: rng.float(0.1, 0.32), angle: rng.float(-0.35, 0.35), spin: 0, spinRate: rng.float(0.15, 0.3) * rng.sign(),
    });
    body.announce = { kicker: 'Black hole', title: bodyName(rng, 'remnant'), sub: `${rng.int(4, 90)} solar masses` };
    this.addJob(diskJob({ rng: rng.fork(), size: 512 }), (c) => (body.disk = c));
  }

  spawnNebula() {
    const rng = this.rng.fork();
    const puffs = this.sector.puffs;
    const count = rng.int(30, 50);
    for (let i = 0; i < count; i++) {
      const R = rng.float(500, 1600);
      const a = rng.float(0, TAU), d = rng.float(300, 3200);
      this.addBody({
        type: 'puff', x: Math.cos(a) * d, y: Math.sin(a) * d * 0.8, z: BODY_FAR * rng.float(0.45, 1.25), R,
        sprite: rng.pick(puffs), rot: rng.float(0, TAU), opacity: rng.float(0.2, 0.45),
      });
    }
    this.announce({ kicker: 'Passing through', title: `The ${rng.pick(['Veil', 'Shroud', 'Cradle', 'Plume', 'Mantle', 'Lantern', 'Bloom'])} of ${bodyName(rng, 'star')}`, sub: 'emission nebula' });
  }

  spawnAsteroids() {
    const rng = this.rng.fork();
    const count = rng.int(90, 160);
    const ax = rng.float(-1, 1) * 1200, ay = rng.float(-1, 1) * 900;
    for (let i = 0; i < count; i++) {
      const big = rng.chance(0.08);
      const R = big ? rng.float(60, 160) : rng.float(6, 45);
      let x, y;
      do {
        x = ax + rng.gauss() * 1400;
        y = ay + rng.gauss() * 700;
      } while (Math.hypot(x, y) < 140 + R * 2);
      this.addBody({
        type: 'rock', x, y, z: BODY_FAR * rng.float(0.5, 1.3), R,
        sprite: rng.pick(this.sector.rocks), rot: rng.float(0, TAU), rotRate: rng.float(-0.8, 0.8),
      });
    }
    this.announce({ kicker: 'Asteroid field', title: `${bodyName(rng, 'star')} Belt`, sub: `${count} bodies tracked` });
  }

  spawnComet() {
    const rng = this.rng.fork();
    const [x, y] = this.passOffset(40, 15, 35);
    const L = this.sector.light;
    // Tails point away from the sector's sun (view-space light → world).
    const dir = [-L[0], -L[1], L[2]];
    const body = this.addBody({
      type: 'comet', x, y, z: BODY_FAR, R: 40,
      vx: rng.float(-1, 1) * 220, vy: rng.float(-1, 1) * 120,
      dir, tail: rng.float(2500, 5000), hue: rng.float(170, 210),
    });
    body.announce = { kicker: 'Comet', title: `C/${2000 + rng.int(100, 900)} ${String.fromCharCode(65 + rng.int(0, 25))}${rng.int(1, 9)} (${bodyName(rng, 'star')})` };
  }

  spawnPulsar() {
    const rng = this.rng.fork();
    const [x, y] = this.passOffset(40, 25, 40);
    const body = this.addBody({
      type: 'pulsar', x, y, z: BODY_FAR, R: 30, big: true,
      angle: rng.float(0, TAU), rate: rng.float(0.5, 1.1) * rng.sign(), tiltB: rng.float(0.15, 0.5),
      color: hsl(rng.float(190, 230), 0.8, 0.8),
    });
    body.announce = { kicker: 'Pulsar', title: bodyName(rng, 'remnant'), sub: `period ${rng.float(0.03, 1.4).toFixed(3)} s` };
    for (let i = 0; i < 8; i++) {
      this.addBody({
        type: 'puff', x: x + rng.gauss() * 500, y: y + rng.gauss() * 400, z: BODY_FAR + rng.gauss() * 500,
        R: rng.float(400, 900), sprite: rng.pick(this.sector.puffs), rot: rng.float(0, TAU), opacity: rng.float(0.2, 0.4),
      });
    }
  }

  spawnWormhole() {
    const rng = this.rng.fork();
    const R = 800;
    const body = this.addBody({
      type: 'wormhole', x: rng.float(-1, 1) * 900, y: rng.float(-1, 1) * 500, z: BODY_FAR, R, big: true, occluder: true,
      spin: 0, hue: this.nextSector.hueA,
    });
    body.announce = { kicker: 'Anomaly detected', title: 'Traversable wormhole', sub: `exit: ${this.nextSector.name}` };
  }

  startWarp() {
    this.phase = 'warp';
    this.warp = { t: 0, dur: this.rng.float(6, 9), switched: false };
    this.announce({ kicker: 'Warp drive', title: 'Engaging', sub: `destination: ${this.nextSector.name}` });
  }

  startTunnel(body) {
    this.phase = 'tunnel';
    this.bodies = this.bodies.filter((b) => b !== body);
    this.tunnel = { t: 0, dur: this.rng.float(7, 10), hue: body.hue, travel: 0, switched: false };
  }

  // --- simulation -------------------------------------------------------------------

  update(dt) {
    this.time += dt;
    this.runJobs();
    const rm = this.reducedMotion;

    let target = CRUISE * this.speedScale;
    if (this.phase === 'warp') {
      const w = this.warp;
      w.t += dt;
      const peak = (rm ? WARP_GENTLE : WARP) * Math.max(1, this.speedScale);
      if (w.t < 1.6) target = CRUISE * 2.5 * this.speedScale;
      else if (w.t < w.dur - 2) target = peak;
      else target = CRUISE * this.speedScale;
      // Swap sectors while everything is a blur.
      if (!w.switched && w.t > 1.6 + (w.dur - 3.6) / 2) {
        w.switched = true;
        this.bodies = this.bodies.filter((b) => b.z < 0);
        this.switchSector();
      }
      if (w.t >= w.dur) {
        this.phase = 'cruise';
        this.warp = null;
        this.nextEventAt = this.time + 4;
      }
      this.speed = ease(this.speed, target, w.t < w.dur - 2 ? 1.4 : 2.2, dt);
    } else {
      this.speed = ease(this.speed, target, 1.5, dt);
    }

    if (this.phase === 'tunnel') {
      const tn = this.tunnel;
      tn.t += dt;
      tn.travel += dt * (rm ? 900 : 2200) * Math.min(1, tn.t / 1.2 + 0.4);
      if (!tn.switched && tn.t > tn.dur - 1) {
        tn.switched = true;
        this.switchSector();
        this.skyFade = 1;
        this.flash = 1;
        this.flashColor = rm ? [0, 0, 0] : hsl(tn.hue, 0.6, 0.92);
        for (let i = 0; i < this.stars.n; i++) this.stars.spawn(i, this.fx.float(1, STAR_FAR));
      }
      if (tn.t >= tn.dur) {
        this.phase = 'cruise';
        this.tunnel = null;
        this.nextEventAt = this.time + 5;
      }
    }

    this.flash = Math.max(0, this.flash - dt * 0.8);
    this.skyFade = Math.min(1, this.skyFade + dt * 0.6);
    if (this.skyFade >= 1) this.prevSector = null;

    const dz = this.speed * dt;
    for (const b of this.bodies) {
      b.z -= dz;
      if (b.orbit) {
        const o = b.orbit;
        if (o.at !== this.time) { o.at = this.time; o.cz -= dz; o.phase += o.w * dt; }
        const a = o.phase + b.orbitSide;
        b.x = o.cx + Math.cos(a) * o.a * b.orbitFrac;
        b.z = o.cz + Math.sin(a) * o.a * b.orbitFrac;
      }
      if (b.type === 'rock') b.rot += b.rotRate * dt;
      if (b.type === 'comet') { b.x += b.vx * dt; b.y += b.vy * dt; }
      if (b.type === 'blackhole') b.spin += b.spinRate * dt;
      if (b.type === 'wormhole') {
        b.spin += dt * (rm ? 0.25 : 0.6);
        // Steer into it: centre the mouth as it nears.
        const k = smooth(BODY_FAR * 0.8, BODY_FAR * 0.15, b.z);
        b.x = ease(b.x, 0, 0.6 * k, dt);
        b.y = ease(b.y, 0, 0.6 * k, dt);
        if (b.z > 0 && (b.R * this.f) / b.z > this.halfDiag * 1.25) this.startTunnel(b);
      }
      if (b.announce && b.z < BODY_FAR * 0.6 && !b.announced) {
        b.announced = true;
        this.announce(b.announce);
      }
    }
    this.bodies = this.bodies.filter((b) => b.z > (b.type === 'puff' ? b.R * 0.3 : 30));
    this.bodies.sort((a, b) => b.z - a.z);

    if (this.phase === 'cruise' && this.time >= this.nextEventAt) this.nextEvent();
  }

  // --- drawing ----------------------------------------------------------------------

  frame(dt) {
    const t0 = performance.now();
    this.lastDt = dt; // drawField advances the star fields by this
    this.update(dt);
    this.draw(dt);
    this.adapt(performance.now() - t0, dt);
  }

  /** Drop resolution if frames are consistently slow. */
  adapt(ms, dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 1 / 40 && this.dprCap > 0.75 && (window.devicePixelRatio || 1) * 0.99 > this.dpr * 0.75) {
      this.dprCap = Math.max(0.75, this.dpr - 0.25);
      this.resize();
    }
  }

  draw(dt) {
    const { ctx, W, H } = this;
    const rm = this.reducedMotion;
    const t = this.time;
    const amp = rm ? 0.4 : 1;
    this.roll = amp * (0.16 * Math.sin(t * 0.031) + 0.08 * Math.sin(t * 0.017 + 1));
    this.vpx = amp * W * 0.035 * Math.sin(t * 0.023);
    this.vpy = amp * H * 0.03 * Math.sin(t * 0.029 + 2);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    ctx.setTransform(1, 0, 0, 1, W / 2 + this.vpx, H / 2 + this.vpy);
    ctx.rotate(this.roll);

    if (this.phase === 'tunnel') {
      this.drawTunnel(dt);
    } else {
      if (this.prevSector) this.drawSky(this.prevSector, 1);
      this.drawSky(this.sector, this.prevSector ? smooth(0, 1, this.skyFade) : 1);
      this.drawWorld();
      if (this.phase === 'warp') this.drawWarpGlow();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    if (this.flash > 0) {
      ctx.globalAlpha = smooth(0, 1, this.flash);
      ctx.fillStyle = rgba(this.flashColor);
      ctx.fillRect(0, 0, W, H);
    }
    // Soft vignette.
    ctx.globalAlpha = 1;
    const v = ctx.createRadialGradient(W / 2, H / 2, this.halfDiag * 0.55, W / 2, H / 2, this.halfDiag);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  drawSky(sector, alpha) {
    if (!sector.sky) return;
    const { ctx } = this;
    const D = this.halfDiag * 2.3;
    const rot = this.time * 0.003;
    ctx.save();
    ctx.rotate(rot);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sector.sky.canvas, -D / 2, -D / 2, D, D);
    ctx.globalCompositeOperation = 'lighter';
    for (const g of sector.galaxies) {
      ctx.save();
      ctx.translate(g.x * D, g.y * D);
      ctx.rotate(g.rot);
      ctx.scale(1, g.squash);
      ctx.globalAlpha = alpha * g.alpha;
      const s = g.scale * D;
      ctx.drawImage(g.sprite, -s / 2, -s / 2, s, s);
      ctx.restore();
    }
    const st = sector.sky.stars;
    const px = this.dpr;
    for (let i = 0; i < st.length; i += 4) {
      const b = st[i + 2] * (0.75 + 0.25 * Math.sin(this.time * 1.3 + st[i + 3]));
      ctx.globalAlpha = alpha * (0.2 + 0.8 * b);
      ctx.fillStyle = '#e8eeff';
      const s = px * (0.6 + b * 1.1);
      ctx.fillRect(st[i] * D, st[i + 1] * D, s, s);
    }
    ctx.restore();
  }

  /** Projects every body, works out lenses/occluders, then draws stars and bodies. */
  drawWorld() {
    const { ctx, f } = this;
    const lenses = [];
    const occluders = [];
    for (const b of this.bodies) {
      b.sx = (b.x / b.z) * f;
      b.sy = (b.y / b.z) * f;
      b.sr = (b.R / b.z) * f;
      b.alpha = smooth(BODY_FAR * 1.02, BODY_FAR * 0.78, b.z);
      if (b.type === 'blackhole') lenses.push({ sx: b.sx, sy: b.sy, z: b.z, e2: (b.sr * 2.4) ** 2, reach2: (b.sr * 18) ** 2 });
      if (b.type === 'wormhole') lenses.push({ sx: b.sx, sy: b.sy, z: b.z, e2: (b.sr * 0.9) ** 2, reach2: (b.sr * 5) ** 2 });
      if (b.occluder && b.alpha > 0.5) occluders.push({ sx: b.sx, sy: b.sy, z: b.z, r2: b.sr * b.sr });
    }

    this.drawField(this.stars, lenses, occluders, 1);
    ctx.globalCompositeOperation = 'source-over';

    for (const b of this.bodies) {
      if (b.alpha <= 0 || b.z <= 0) continue;
      const ext = b.type === 'blackhole' ? 7 : b.ring ? b.ring.outer / b.R : b.type === 'star' ? 6 : b.type === 'comet' || b.type === 'pulsar' ? 1e9 : 1.2;
      if (ext < 1e9 && (Math.abs(b.sx) - b.sr * ext > this.halfDiag + 50 || Math.abs(b.sy) - b.sr * ext > this.halfDiag + 50)) continue;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      switch (b.type) {
        case 'planet': this.drawPlanet(b); break;
        case 'star': this.drawStar(b); break;
        case 'blackhole': this.drawBlackHole(b); break;
        case 'puff': this.drawPuff(b); break;
        case 'rock': this.drawRock(b); break;
        case 'comet': this.drawComet(b); break;
        case 'pulsar': this.drawPulsar(b); break;
        case 'wormhole': this.drawWormhole(b); break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    this.drawField(this.dust, [], [], 0.35);
    ctx.globalCompositeOperation = 'source-over';
  }

  drawField(field, lenses, occluders, alphaMul) {
    const { ctx, f, dpr } = this;
    const streakZ = this.speed * 0.04;
    const lim = this.halfDiag * 1.1;
    const { x, y, z, tint, mag, n, far } = field;
    // Positions advance here (not in update) so the step matches what's drawn.
    const step = this.speed * this.lastDt;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      z[i] -= step;
      if (z[i] < 1) { field.spawn(i, far * this.fx.float(0.85, 1)); continue; }
      const zi = z[i];
      let sx = (x[i] / zi) * f, sy = (y[i] / zi) * f;
      if (sx > lim || sx < -lim || sy > lim || sy < -lim) { field.spawn(i, far * this.fx.float(0.85, 1)); continue; }
      let hidden = false;
      for (const o of occluders) {
        if (zi > o.z && (sx - o.sx) ** 2 + (sy - o.sy) ** 2 < o.r2) { hidden = true; break; }
      }
      if (hidden) continue;
      for (const L of lenses) {
        if (zi <= L.z) continue;
        const ddx = sx - L.sx, ddy = sy - L.sy;
        const r2 = ddx * ddx + ddy * ddy;
        if (r2 < L.reach2 && r2 > 0.01) {
          const k = 1 + L.e2 / r2;
          sx = L.sx + ddx * k;
          sy = L.sy + ddy * k;
        }
      }
      const depth = 1 - zi / far;
      const a = Math.min(1, depth * 2.2) * alphaMul;
      const size = Math.min(field.maxPx * dpr, Math.max(0.55 * dpr, (field.size * mag[i] * f) / zi));
      ctx.globalAlpha = Math.min(1, a * (0.45 + mag[i] * 0.5));
      const z2 = zi + streakZ;
      const tx = (x[i] / z2) * f, ty = (y[i] / z2) * f;
      const len2 = (sx - tx) ** 2 + (sy - ty) ** 2;
      if (len2 > (size * 1.5) ** 2 && lenses.length === 0) {
        ctx.strokeStyle = STAR_TINT_CSS[tint[i]];
        ctx.lineWidth = size;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      } else {
        ctx.fillStyle = STAR_TINT_CSS[tint[i]];
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
      }
    }
  }

  drawPlanet(b) {
    const { ctx } = this;
    if (!b.sprite) {
      // Still being painted: a dim dot stands in while it's far away.
      ctx.globalAlpha = b.alpha * 0.5;
      ctx.fillStyle = '#8a94a8';
      ctx.beginPath();
      ctx.arc(b.sx, b.sy, Math.max(0.6, Math.min(b.sr, 4)), 0, TAU);
      ctx.fill();
      return;
    }
    const half = b.sr / b.diskFrac;
    if (b.ring) this.drawRing(b, -1);
    ctx.globalAlpha = b.alpha;
    ctx.drawImage(b.sprite, b.sx - half, b.sy - half, half * 2, half * 2);
    if (b.ring) this.drawRing(b, 1);
  }

  /** side -1 draws the far half of the ring (behind the planet), +1 the near half. */
  drawRing(b, side) {
    const { ctx } = this;
    const r = b.ring;
    const ro = (r.outer / b.z) * this.f;
    ctx.save();
    ctx.translate(b.sx, b.sy);
    ctx.rotate(r.angle);
    ctx.beginPath();
    ctx.rect(-ro * 1.1, side < 0 ? -ro * 1.1 : 0, ro * 2.2, ro * 1.1);
    ctx.clip();
    ctx.scale(1, r.tilt);
    ctx.globalAlpha = b.alpha * 0.9;
    ctx.drawImage(r.sprite, -ro, -ro, ro * 2, ro * 2);
    ctx.restore();
  }

  drawStar(b) {
    const { ctx } = this;
    const c = b.color;
    const sr = Math.max(b.sr, 0.8 * this.dpr);
    ctx.globalCompositeOperation = 'lighter';
    // Wide halo.
    let g = ctx.createRadialGradient(b.sx, b.sy, sr * 0.5, b.sx, b.sy, sr * 9);
    g.addColorStop(0, rgba(c, 0.55 * b.alpha));
    g.addColorStop(0.15, rgba(c, 0.18 * b.alpha));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(b.sx - sr * 9, b.sy - sr * 9, sr * 18, sr * 18);
    // Corona rays.
    ctx.save();
    ctx.translate(b.sx, b.sy);
    ctx.rotate(b.rayPhase + this.time * 0.02);
    for (let i = 0; i < b.rays; i++) {
      const len = sr * (2.5 + 1.8 * Math.sin(i * 7.3 + this.time * 0.3));
      ctx.rotate(TAU / b.rays);
      const rg = ctx.createLinearGradient(0, 0, len, 0);
      rg.addColorStop(0, rgba(c, 0.35 * b.alpha));
      rg.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(0, -sr * 0.35);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, sr * 0.35);
      ctx.fill();
    }
    ctx.restore();
    // Surface.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = b.alpha;
    if (b.sprite && sr > 2) ctx.drawImage(b.sprite, b.sx - sr, b.sy - sr, sr * 2, sr * 2);
    else {
      ctx.fillStyle = rgba(c);
      ctx.beginPath(); ctx.arc(b.sx, b.sy, sr, 0, TAU); ctx.fill();
    }
    // Lens flare: an anamorphic streak plus ghosts mirrored through the centre.
    ctx.globalCompositeOperation = 'lighter';
    const onScreen = smooth(this.halfDiag * 1.1, this.halfDiag * 0.3, Math.hypot(b.sx, b.sy));
    const fl = onScreen * b.alpha * Math.min(1, 0.25 + sr / 60);
    if (fl > 0.01) {
      ctx.save();
      ctx.translate(b.sx, b.sy);
      ctx.rotate(-this.roll);
      ctx.scale(1, 0.025);
      const w = this.W * 0.6;
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, w);
      g.addColorStop(0, `rgba(200,220,255,${0.45 * fl})`);
      g.addColorStop(1, 'rgba(200,220,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-w, -w, w * 2, w * 2);
      ctx.restore();
      for (const [k, s, h] of [[-0.35, 0.18, 30], [-0.7, 0.07, 200], [-1.15, 0.28, 280]]) {
        const gx = b.sx * k * 1.6 + b.sx, gy = b.sy * k * 1.6 + b.sy;
        const gr = this.W * s * 0.25;
        const gg = ctx.createRadialGradient(gx, gy, gr * 0.6, gx, gy, gr);
        const col = hsl(h, 0.7, 0.6);
        gg.addColorStop(0, rgba(col, 0.025 * fl));
        gg.addColorStop(0.9, rgba(col, 0.06 * fl));
        gg.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(gx, gy, gr, 0, TAU); ctx.fill();
      }
    }
    // Close stars wash the view with their light.
    const wash = smooth(this.W * 0.05, this.W * 0.6, b.sr) * b.alpha * 0.18;
    if (wash > 0) {
      ctx.globalAlpha = wash;
      ctx.fillStyle = rgba(c);
      ctx.fillRect(-this.halfDiag, -this.halfDiag, this.halfDiag * 2, this.halfDiag * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawBlackHole(b) {
    const { ctx } = this;
    const rs = b.sr;
    const Rd = rs * 6;
    const a = b.alpha;
    ctx.save();
    ctx.translate(b.sx, b.sy);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, rs, 0, 0, Rd * 1.8);
    g.addColorStop(0, `rgba(255,170,90,${0.22 * a})`);
    g.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-Rd * 1.8, -Rd * 1.8, Rd * 3.6, Rd * 3.6);
    ctx.rotate(b.angle);
    if (b.disk) {
      const disk = (radius, squash, side, alpha) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(-radius * 1.1, side < 0 ? -radius * 1.1 : 0, radius * 2.2, radius * 1.1);
        ctx.clip();
        ctx.scale(1, squash);
        ctx.rotate(b.spin);
        ctx.globalAlpha = alpha;
        ctx.drawImage(b.disk, -radius, -radius, radius * 2, radius * 2);
        ctx.restore();
      };
      disk(Rd, b.tilt, -1, a);           // far side of the disk
      disk(rs * 2.9, 0.93, -1, a * 0.9);  // far side lensed up over the top
      disk(rs * 2.1, 0.9, 1, a * 0.45);   // secondary image under the bottom
    }
    // Event horizon shadow and photon ring.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(0, 0, rs * 1.05, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,225,180,0.8)';
    ctx.lineWidth = Math.max(1, rs * 0.04);
    ctx.beginPath(); ctx.arc(0, 0, rs * 1.08, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,180,110,0.25)';
    ctx.lineWidth = Math.max(2, rs * 0.14);
    ctx.stroke();
    if (b.disk) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-Rd * 1.1, 0, Rd * 2.2, Rd * 1.1);
      ctx.clip();
      ctx.scale(1, b.tilt);
      ctx.rotate(b.spin);
      ctx.globalAlpha = a;
      ctx.drawImage(b.disk, -Rd, -Rd, Rd * 2, Rd * 2);
      ctx.restore();
      // Doppler beaming: the side spinning towards us is brighter.
      const side = b.spinRate > 0 ? -1 : 1;
      ctx.save();
      ctx.scale(1, b.tilt * 1.4);
      const bg = ctx.createRadialGradient(side * Rd * 0.45, 0, 0, side * Rd * 0.45, 0, Rd * 0.7);
      bg.addColorStop(0, `rgba(255,240,210,${0.35 * a})`);
      bg.addColorStop(1, 'rgba(255,200,150,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(-Rd, -Rd, Rd * 2, Rd * 2);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  drawPuff(b) {
    const { ctx } = this;
    const near = smooth(b.R * 0.3, b.R * 2.5, b.z);
    const a = b.opacity * near * smooth(BODY_FAR * 1.3, BODY_FAR * 0.8, b.z);
    if (a <= 0.004 || b.sr > this.halfDiag * 4) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.translate(b.sx, b.sy);
    ctx.rotate(b.rot);
    const s = b.sr * 2;
    ctx.drawImage(b.sprite, -s / 2, -s / 2, s, s);
    ctx.restore();
  }

  drawRock(b) {
    const { ctx } = this;
    const s = b.sr * 2;
    if (s < 0.6) return;
    ctx.save();
    ctx.globalAlpha = b.alpha;
    ctx.translate(b.sx, b.sy);
    ctx.rotate(b.rot);
    if (s < 3) {
      ctx.fillStyle = '#6b6560';
      ctx.fillRect(-s / 2, -s / 2, s, s);
    } else {
      ctx.drawImage(b.sprite, -s / 2, -s / 2, s, s);
    }
    ctx.restore();
  }

  drawComet(b) {
    const { ctx, f } = this;
    const [dx, dy, dz] = b.dir;
    const project = (k, spread = 0) => {
      let z = b.z + dz * b.tail * k;
      if (z < 20) z = 20;
      return [((b.x + dx * b.tail * k + spread) / z) * f, ((b.y + dy * b.tail * k) / z) * f];
    };
    const [hx, hy] = [b.sx, b.sy];
    const [ex, ey] = project(1);
    const [ix, iy] = project(1.15, b.tail * 0.12);
    const a = b.alpha;
    ctx.globalCompositeOperation = 'lighter';
    const tail = (tx, ty, width, c, alpha) => {
      const len = Math.hypot(tx - hx, ty - hy) || 1;
      const nx = -(ty - hy) / len, ny = (tx - hx) / len;
      const w0 = Math.max(1, b.sr * 1.5), w1 = Math.max(w0, len * width);
      const g = ctx.createLinearGradient(hx, hy, tx, ty);
      g.addColorStop(0, rgba(c, alpha * a));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(hx + nx * w0, hy + ny * w0);
      ctx.lineTo(tx + nx * w1, ty + ny * w1);
      ctx.lineTo(tx - nx * w1, ty - ny * w1);
      ctx.lineTo(hx - nx * w0, hy - ny * w0);
      ctx.fill();
    };
    // Broad, curving-looking dust tail built from a few offset layers, plus a thin ion tail.
    for (let k = 0; k < 3; k++) tail(ex + k * b.sr * 4, ey + k * b.sr * 3, 0.07 + k * 0.06, [255, 236, 200], 0.16);
    tail(ix, iy, 0.012, hsl(b.hue, 0.8, 0.7), 0.3);
    tail(ix, iy, 0.035, hsl(b.hue, 0.8, 0.6), 0.1);
    const r = Math.max(2 * this.dpr, b.sr * 6);
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.25, `rgba(200,240,255,${0.5 * a})`);
    g.addColorStop(1, 'rgba(160,220,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(hx - r, hy - r, r * 2, r * 2);
    ctx.globalCompositeOperation = 'source-over';
  }

  drawPulsar(b) {
    const { ctx } = this;
    const a = b.alpha;
    const c = b.color;
    const len = ((b.R * 90) / b.z) * this.f;
    const ang = b.angle + this.time * b.rate * (this.reducedMotion ? 0.3 : 1);
    ctx.save();
    ctx.translate(b.sx, b.sy);
    ctx.globalCompositeOperation = 'lighter';
    // The beams sweep a cone; foreshortening makes them pulse in length.
    const sweep = 0.55 + 0.45 * Math.cos(ang * 2);
    ctx.rotate(b.tiltB + Math.sin(ang) * 0.6);
    for (const dir of [1, -1]) {
      const L = len * (dir > 0 ? sweep : 1.45 - sweep);
      const w = Math.max(1, b.sr * 0.4);
      // Soft halo layer, then a narrow bright core.
      for (const [spread, alpha] of [[9, 0.12], [2.5, 0.45]]) {
        const g = ctx.createLinearGradient(0, 0, 0, -dir * L);
        g.addColorStop(0, rgba(c, alpha * a));
        g.addColorStop(0.6, rgba(c, alpha * 0.3 * a));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-w, 0);
        ctx.lineTo(-w * spread, -dir * L);
        ctx.lineTo(w * spread, -dir * L);
        ctx.lineTo(w, 0);
        ctx.fill();
      }
    }
    const r = Math.max(3 * this.dpr, b.sr * 8);
    const pulse = 0.75 + 0.25 * Math.abs(Math.cos(ang * 2));
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.2, rgba(c, 0.6 * a * pulse));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  drawWormhole(b) {
    const { ctx } = this;
    const sr = b.sr;
    const a = b.alpha;
    const next = this.nextSector;
    const col = hsl(b.hue, 0.8, 0.65);
    ctx.save();
    ctx.translate(b.sx, b.sy);
    // The mouth shows the destination sector, fisheyed and turning.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, sr, 0, TAU);
    ctx.clip();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#000';
    ctx.fillRect(-sr, -sr, sr * 2, sr * 2);
    if (next.sky) {
      ctx.rotate(-b.spin * 0.5);
      const D = sr * 3.2;
      ctx.drawImage(next.sky.canvas, -D / 2, -D / 2, D, D);
      const st = next.sky.stars;
      ctx.fillStyle = '#fff';
      for (let i = 0; i < st.length; i += 8) {
        // Squeeze stars towards the rim like a fisheye lens.
        const ux = st[i] * 2, uy = st[i + 1] * 2;
        const r = Math.hypot(ux, uy);
        if (r >= 1) continue;
        const k = Math.sin((r * Math.PI) / 2) / (r || 1);
        const s = this.dpr * (0.6 + st[i + 2] * 1.4);
        ctx.globalAlpha = a * (0.3 + st[i + 2] * 0.7);
        ctx.fillRect(ux * k * sr, uy * k * sr, s, s);
      }
    }
    ctx.globalAlpha = a;
    const inner = ctx.createRadialGradient(0, 0, sr * 0.55, 0, 0, sr);
    inner.addColorStop(0, 'rgba(0,0,0,0)');
    inner.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = inner;
    ctx.fillRect(-sr, -sr, sr * 2, sr * 2);
    ctx.restore();
    // Bright Einstein ring with swirling arcs.
    ctx.globalCompositeOperation = 'lighter';
    const rim = ctx.createRadialGradient(0, 0, sr * 0.92, 0, 0, sr * 1.5);
    rim.addColorStop(0, rgba(col, 0.75 * a));
    rim.addColorStop(0.15, rgba(col, 0.3 * a));
    rim.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(0, 0, sr * 1.5, 0, TAU);
    ctx.arc(0, 0, sr * 0.92, 0, TAU, true);
    ctx.fill();
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const r = sr * (1 + i * 0.045);
      const start = b.spin * (1 + i * 0.3) + i * 1.7;
      ctx.strokeStyle = rgba(hsl(b.hue + i * 12, 0.9, 0.75), (0.45 - i * 0.05) * a);
      ctx.lineWidth = Math.max(1, sr * 0.025);
      ctx.beginPath();
      ctx.arc(0, 0, r, start, start + 1.3 + (i % 3) * 0.4);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  drawWarpGlow() {
    const { ctx } = this;
    const k = smooth(CRUISE * 3, (this.reducedMotion ? WARP_GENTLE : WARP) * 0.7, this.speed);
    if (k <= 0) return;
    ctx.globalCompositeOperation = 'lighter';
    const r = this.halfDiag;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.5);
    g.addColorStop(0, `rgba(190,215,255,${0.5 * k})`);
    g.addColorStop(0.3, `rgba(110,150,255,${0.12 * k})`);
    g.addColorStop(1, 'rgba(80,120,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    const e = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r);
    e.addColorStop(0, 'rgba(60,90,220,0)');
    e.addColorStop(1, `rgba(60,90,220,${0.25 * k})`);
    ctx.fillStyle = e;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.globalCompositeOperation = 'source-over';
  }

  drawTunnel() {
    const { ctx, f } = this;
    const tn = this.tunnel;
    const t = this.time;
    const R = 260;            // tunnel radius in world units
    const spacing = 70;
    const count = 90;
    const near = 25;
    const far = near + count * spacing;
    const path = (z) => [
      Math.sin(z * 0.0009 + t * 0.3) * 200 + Math.sin(z * 0.0021) * 90,
      Math.cos(z * 0.0008 + t * 0.23) * 160,
    ];
    const [px0, py0] = path(tn.travel);
    const vis = smooth(0, 1.2, tn.t) * smooth(tn.dur, tn.dur - 1.5, tn.t);
    const hd = this.halfDiag;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(hsl(tn.hue + 180, 0.5, 0.025));
    ctx.fillRect(-hd, -hd, hd * 2, hd * 2);
    ctx.globalCompositeOperation = 'lighter';

    // Light at the end of the tunnel.
    const [fx, fy] = path(tn.travel + far);
    const ex = ((fx - px0) / far) * f, ey = ((fy - py0) / far) * f;
    const er = (R / far) * f * 2.5;
    const lg = ctx.createRadialGradient(ex, ey, 0, ex, ey, er);
    lg.addColorStop(0, rgba([255, 255, 255], 0.95 * vis));
    lg.addColorStop(0.35, rgba(hsl(tn.hue, 0.8, 0.75), 0.4 * vis));
    lg.addColorStop(1, rgba(hsl(tn.hue, 0.8, 0.5), 0));
    ctx.fillStyle = lg;
    ctx.fillRect(ex - er, ey - er, er * 2, er * 2);

    // Rings of light, far to near; dashes twist with depth so the walls spiral.
    const offset = tn.travel % spacing;
    const segs = 18;
    ctx.lineCap = 'round';
    for (let i = count - 1; i >= 0; i--) {
      const z = near + i * spacing - offset;
      if (z <= 4) continue;
      const worldZ = tn.travel + z;
      const [cx, cy] = path(worldZ);
      const sx = ((cx - px0) / z) * f, sy = ((cy - py0) / z) * f;
      const sr = (R / z) * f;
      const depth = z / far;
      const fade = smooth(1, 0.75, depth) * smooth(0, 0.08, depth) * vis;
      if (fade <= 0.003) continue;
      const ring = Math.round(worldZ / spacing);
      const hue = tn.hue + 40 * Math.sin(ring * 0.07 + t * 0.4);
      const light = 0.5 + 0.25 * (1 - depth);
      const circ = TAU * sr;
      ctx.setLineDash([circ / segs * 0.45, circ / segs * 0.55]);
      ctx.lineDashOffset = -((worldZ * 0.0015 + t * 0.35) % 1) * circ;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, TAU);
      ctx.strokeStyle = rgba(hsl(hue, 0.85, light), 0.07 * fade);
      ctx.lineWidth = sr * 0.3;
      ctx.stroke();
      ctx.strokeStyle = rgba(hsl(hue + 20, 0.9, 0.8), 0.32 * fade);
      ctx.lineWidth = Math.max(0.6, sr * 0.035);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalCompositeOperation = 'source-over';
  }
}
