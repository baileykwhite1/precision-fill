/* Precision Fill — machine model.
 *
 * Pure simulation: no DOM, no globals beyond PFSim. See docs/DESIGN.md for where
 * each number comes from. Behaviour is from the user manual; the physics
 * constants are ours, chosen to reproduce it.
 */
(function (global) {
  'use strict';

  /* ---------- constants (see DESIGN.md § Physics) ---------- */

  var K = {
    maxGateRate: 480,     // g/s, gate fully open (Fast)
    medOpenFrac: 0.55,    // gate opening fraction for Med; flow goes as opening^1.5
    vibRate: 38,          // g/s, vibrating plate (Slow)
    transitTime: 0.12,    // s, gate -> chamber fall time
    tauGate: 0.06,        // s, gate opening time constant
    tauGateClose: 0.28,   // s, closing is slower — the blade shears the bean column
    tauVib: 0.10,         // s, vibrator spin-up / coast-down
    sampleTime: 0.02,     // s, controller sample interval
    beanMass: 0.13,       // g, one bean — the source of scatter
    clumpSd: 0.085,       // bulk-solids flow is lumpy: rms fractional flow wobble
    clumpTau: 0.20,       // s, correlation time of that wobble
    vibClump: 0.40,       // the vibrating plate meters a thin stream — far steadier
    gateJitter: 0.12,     // shot-to-shot spread in pneumatic gate travel time
    dischargeRate: 900,   // g/s out of the chamber
    nomPressure: 0.40,    // MPa
    cellNoise: 0.18,      // g rms, load cell noise at rest
    stabBand: 1.2,        // g/s, |dw/dt| under this reads as stable
    zeroV: 2.195,         // mV at zero, per the Calibration screen
    vPerGram: 0.0009      // mV/g
  };

  // Whole bean only — the Precision Fill does not run ground coffee.
  // `rate` scales flow (bulk density and how freely the bean runs), `bean` is one
  // bean's mass, `clump` scales the flow surging that governs consistency.
  var COFFEES = [
    { id: 'medium',   name: 'Medium roast',   rate: 1.00, bean: 0.13, clump: 1.00 },
    { id: 'light',    name: 'Light roast',    rate: 1.06, bean: 0.12, clump: 0.95 },
    { id: 'dark',     name: 'Dark roast',     rate: 0.92, bean: 0.15, clump: 1.20 },
    { id: 'decaf',    name: 'Decaf',          rate: 1.04, bean: 0.13, clump: 1.05 },
    { id: 'peaberry', name: 'Peaberry',       rate: 1.10, bean: 0.10, clump: 0.80 },
    { id: 'oily',     name: 'Oily dark roast', rate: 0.86, bean: 0.15, clump: 1.55 }
  ];

  /* ---------- small helpers ---------- */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function approach(cur, target, dt, tau) {
    // first-order lag toward target
    return target + (cur - target) * Math.exp(-dt / tau);
  }

  /* ---------- recipes ---------- */

  function defaultTimes() {
    return {
      feedDelay: 1.0, stab: 0.5, dischargeDelay: 0.5,
      clampDelay: 0.5, unclampDelay: 0.5, endUnclampDelay: 1.0
    };
  }

  function defaultOU() {
    return { func: true, checkDelay: 0.5, over: 5, under: 5, pause: true, interval: 0 };
  }

  function makeRecipe(n, name, target, fast, med, slow, dz) {
    return {
      n: n, name: name, enabled: true,
      target: target, fast: fast, med: med, slow: slow,
      dischargeZero: dz == null ? 30 : dz,
      aiPack: false,
      feedSpeed: 3,           // 3 = Three Speed, 2 = Med/Slow, 1 = Fast/Slow
      times: defaultTimes(),
      ou: defaultOU()
    };
  }

  // The five pre-loaded recipes. Targets are from the manual; Rec 5's feed values
  // are the tuned ones visible in the Shortcut screenshot.
  function factoryRecipes() {
    var r = [];
    r.push(makeRecipe(1, '2300g', 2300, 900, 130, 8, 30));
    r.push(makeRecipe(2, '1000g', 1000, 900, 130, 8, 30));
    r.push(makeRecipe(3, '454g', 454, 454, 130, 9, 30));
    r.push(makeRecipe(4, '100g', 100, 100, 100, 8, 20));
    r.push(makeRecipe(5, '500g', 500, 500, 130, 9, 30));
    for (var i = 6; i <= 20; i++) {
      var e = makeRecipe(i, '', 0, 0, 0, 0, 30);
      e.enabled = false;
      r.push(e);
    }
    return r;
  }

  /* ---------- machine ---------- */

  function Machine(seed) {
    this.rnd = mulberry32(seed == null ? 12345 : seed);
    this.reset();
  }

  Machine.prototype.reset = function () {
    // scale settings (screen 1.1)
    this.unit = 'g';
    this.accuracy = 0;
    this.division = 1;
    this.capacity = 2500;

    // true load-cell physics. raw = mass * rawPerGram + rawOffset
    this.rawPerGram = 1.0;
    this.rawOffset = 0;
    // stored calibration
    this.calZero = 0;
    this.calSpan = 1.0;
    // material-calibration scratch
    this.recordedRaw = null;
    this.clbWt = 0;

    // plant state
    this.mass = 0;             // true mass in the weighing chamber, g
    this.gate = 0;             // gate opening 0..1
    this.vib = 0;              // vibrator 0..1
    this.discGate = 0;         // discharge gate 0..1
    this.transit = [];         // in-flight mass packets {due, m}
    this.t = 0;
    this.clump = 0;            // OU process: fractional flow wobble
    this.gateTauMul = 1;       // re-drawn on every gate actuation
    this.prevGateCmd = 0;
    this.stepAcc = 0;          // leftover time between fixed sub-steps
    this.mdState = null;       // manual clamp/discharge sequence
    this.mdT = 0;

    this.hopper = 12000;       // g in the upper hopper
    this.hopperCap = 25000;
    this.pressure = 0.40;      // MPa
    this.coffee = COFFEES[0];

    // filtered / displayed scale
    this.shown = 0;
    this.dwdt = 0;
    this.lastShownRaw = 0;

    // controller
    this.recipes = factoryRecipes();
    this.sel = 1;
    this.state = 'STOP';
    this.phaseT = 0;
    this.running = false;
    this.pedal = false;
    this.alarm = null;         // {code, text}
    this.accNums = 0;
    this.accWt = 0;
    this.batchSet = 0;
    this.complete = 0;
    this.workMode = 2;
    this.combine = 1;
    this.password = '0';

    // feeds as commanded this instant
    this.fastOn = false;
    this.medOn = false;
    this.slowOn = false;
    this.clampOn = false;
    this.discOn = false;
    this.holdOn = false;

    // manual override latches
    this.man = { fast: false, med: false, slow: false, disc: false, clamp: false };
    this.manualMode = false;

    // history
    this.log = [];
    this.cycleStart = 0;
    this.sampleAcc = 0;
    this.ouLamp = false;
  };

  Machine.prototype.recipe = function () {
    return this.recipes[this.sel - 1];
  };

  /* ----- scale ----- */

  Machine.prototype.rawCounts = function () {
    return this.mass * this.rawPerGram + this.rawOffset;
  };

  // Weight as the controller sees it, before quantisation.
  Machine.prototype.trueReading = function () {
    return (this.rawCounts() - this.calZero) / this.calSpan;
  };

  Machine.prototype.sensorVoltage = function () {
    return K.zeroV + this.mass * K.vPerGram * this.rawPerGram;
  };

  Machine.prototype.quantise = function (w) {
    var d = this.division || 1;
    return Math.round(w / d) * d;
  };

  Machine.prototype.isOverload = function () {
    return this.trueReading() > this.capacity + 9;
  };

  // Displayed weight string, honouring unit / accuracy / division / OFL.
  Machine.prototype.display = function () {
    if (this.isOverload()) return 'OFL';
    var g = this.quantise(this.shown);
    var v = g, dp = this.accuracy;
    if (this.unit === 'kg') { v = g / 1000; dp = Math.max(this.accuracy, 2); }
    else if (this.unit === 'oz') { v = g / 28.3495; dp = Math.max(this.accuracy, 1); }
    else if (this.unit === 'lb') { v = g / 453.592; dp = Math.max(this.accuracy, 2); }
    return v.toFixed(dp);
  };

  Machine.prototype.stable = function () {
    return Math.abs(this.dwdt) < K.stabBand;
  };

  Machine.prototype.atZero = function () {
    return Math.abs(this.quantise(this.shown)) < Math.max(0.5, this.division * 0.5);
  };

  /* ----- environment factors ----- */

  Machine.prototype.airFactor = function () {
    // gate travel falls away below ~0.25 MPa and is nominal at 0.4
    return clamp((this.pressure - 0.12) / (K.nomPressure - 0.12), 0, 1.06);
  };

  // `closing` picks the slower stroke. Low air makes the cylinder sluggish either
  // way, which widens the in-flight lump and is why the manual insists on 0.4 MPa.
  Machine.prototype.gateTau = function (closing) {
    var base = closing ? K.tauGateClose : K.tauGate;
    return base * this.gateTauMul / clamp(this.airFactor(), 0.25, 1.1);
  };

  // 0 at healthy pressure, rising to 1 as the air supply collapses.
  Machine.prototype.leakFrac = function () {
    return clamp((0.30 - this.pressure) / 0.30, 0, 1);
  };

  Machine.prototype.hopperFactor = function () {
    if (this.hopper <= 0) return 0;
    if (this.hopper < 800) return 0.35 + 0.65 * (this.hopper / 800); // head pressure falls off
    return 1;
  };

  /* ----- random draws ----- */

  Machine.prototype.normal = function () {
    var u = 1 - this.rnd(), v = this.rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // Poisson-ish bean count; normal approximation above ~20 expected beans.
  Machine.prototype.poisson = function (lam) {
    if (lam <= 0) return 0;
    if (lam > 20) return Math.max(0, Math.round(lam + Math.sqrt(lam) * this.normal()));
    var L = Math.exp(-lam), k = 0, p = 1;
    do { k++; p *= this.rnd(); } while (p > L);
    return k - 1;
  };

  /* ----- the feed decision (cutoff arithmetic from the manual) ----- */

  Machine.prototype.feedDemand = function (w) {
    var r = this.recipe();
    var useFast = r.feedSpeed === 3 || r.feedSpeed === 1;
    var useMed = r.feedSpeed === 3 || r.feedSpeed === 2;
    return {
      fast: useFast && w < r.target - r.fast,
      med: useMed && w < r.target - r.med,
      slow: w < r.target - r.slow
    };
  };

  Machine.prototype.feedsDone = function (w) {
    var d = this.feedDemand(w);
    return !d.fast && !d.med && !d.slow;
  };

  /* ----- plant step ----- */

  Machine.prototype.stepPlant = function (dt) {
    var fast = this.fastOn, med = this.medOn, slow = this.slowOn;

    // gate position: Fast and Med are two stroke positions of one gate
    var gTarget = fast ? 1 : (med ? K.medOpenFrac : 0);
    // every actuation of the cylinder travels at a slightly different speed, and
    // it is the closing stroke that sets how much coffee escapes after cutoff
    if (gTarget !== this.prevGateCmd) {
      // under-pressured air makes the stroke erratic as well as slow
      var jit = K.gateJitter * (1 + 3 * this.leakFrac());
      this.gateTauMul = 1 + this.normal() * jit;
      if (this.gateTauMul < 0.5) this.gateTauMul = 0.5;
      this.prevGateCmd = gTarget;
    }
    // Below about 0.3 MPa the cylinder cannot seat the blade against the bean
    // column, so the gate never fully closes and coffee keeps trickling in after
    // cutoff. This is the fault the manual's 0.4 MPa requirement prevents.
    var floor = this.leakFrac() * 0.085;
    var gWant = Math.max(gTarget * clamp(this.airFactor(), 0, 1), floor);
    this.gate = approach(this.gate, gWant, dt, this.gateTau(gWant < this.gate));
    this.vib = approach(this.vib, slow ? 1 : 0, dt, K.tauVib);
    var dWant = this.discOn ? 1 : 0;
    this.discGate = approach(this.discGate, dWant, dt, this.gateTau(dWant < this.discGate));

    var hf = this.hopperFactor();
    var cf = this.coffee;

    // Bulk solids do not flow smoothly — they arrive in surges. An
    // Ornstein-Uhlenbeck wobble on the flow makes each in-flight lump vary in
    // proportion to its size, which is why the gate (big lump) governs
    // consistency and the vibrating plate (small lump) governs accuracy.
    var decay = Math.exp(-dt / K.clumpTau);
    this.clump = this.clump * decay +
      this.normal() * K.clumpSd * (cf.clump || 1) * Math.sqrt(1 - decay * decay);

    // flow out of the hopper, orifice-like in gate opening
    var gateFlow = K.maxGateRate * Math.pow(clamp(this.gate, 0, 1), 1.5) * cf.rate * hf;
    var vibFlow = K.vibRate * this.vib * cf.rate * hf;
    gateFlow *= clamp(1 + this.clump, 0, 2);
    vibFlow *= clamp(1 + this.clump * K.vibClump, 0, 2);

    var flow = gateFlow + vibFlow;
    if (flow > 0 && this.hopper > 0) {
      var want = flow * dt;
      var bean = Math.max(0.004, cf.bean);
      var lam = want / bean;
      var got = this.poisson(lam) * bean;      // discrete beans -> real scatter
      got = Math.min(got, this.hopper);
      this.hopper -= got;
      if (got > 0) this.transit.push({ due: this.t + K.transitTime, m: got });
    }

    // in-flight arrivals
    var keep = [];
    for (var i = 0; i < this.transit.length; i++) {
      if (this.transit[i].due <= this.t) this.mass += this.transit[i].m;
      else keep.push(this.transit[i]);
    }
    this.transit = keep;

    // discharge
    if (this.discGate > 0.02 && this.mass > 0) {
      var out = K.dischargeRate * Math.pow(this.discGate, 1.3) * dt;
      this.mass = Math.max(0, this.mass - out);
    }

    this.t += dt;
  };

  Machine.prototype.stepScale = function (dt) {
    var target = this.trueReading() + this.normal() * K.cellNoise;
    var prev = this.shown;
    // load cell + filter settling
    this.shown = approach(this.shown, target, dt, 0.05);
    var rate = (this.shown - prev) / dt;
    this.dwdt = this.dwdt * 0.7 + rate * 0.3;
  };

  /* ----- alarms ----- */

  Machine.prototype.raise = function (code, text) {
    this.alarm = { code: code, text: text };
    if (code === 'OVER' || code === 'UNDER') this.ouLamp = true;
  };

  Machine.prototype.clearAlarm = function () {
    this.alarm = null;
    this.ouLamp = false;
    if (this.state === 'BATCH_END') {
      this.complete = 0;
      this.state = 'STOP';
      this.running = false;
    }
    if (this.state === 'ALARM_HOLD') this.state = 'WAIT_CLAMP';
  };

  /* ----- controller ----- */

  Machine.prototype.setState = function (s) { this.state = s; this.phaseT = 0; };

  Machine.prototype.start = function () {
    if (this.alarm && this.alarm.code === 'BATCH') return;
    this.running = true;
    this.manualMode = false;
    if (this.state === 'STOP') {
      this.cycleStart = this.t;
      this.setState('FEED_DELAY');
    }
  };

  Machine.prototype.stop = function () {
    this.running = false;
    this.setState('STOP');
    this.fastOn = this.medOn = this.slowOn = false;
    this.holdOn = false;
  };

  Machine.prototype.pressPedal = function () { this.pedal = true; };

  Machine.prototype.zero = function () {
    if (!this.stable()) return false;
    this.calZero = this.rawCounts();
    this.shown = 0;
    return true;
  };

  Machine.prototype.zeroClb = function () { return this.zero(); };

  Machine.prototype.recordWt = function () {
    this.recordedRaw = this.rawCounts();
    return true;
  };

  Machine.prototype.wtClb = function () {
    if (this.recordedRaw == null || !(this.clbWt > 0)) return false;
    var span = (this.recordedRaw - this.calZero) / this.clbWt;
    if (!(span > 0)) return false;
    this.calSpan = span;
    return true;
  };

  Machine.prototype.stepController = function (dt) {
    var r = this.recipe();
    var w = this.quantise(this.trueReading());
    this.phaseT += dt;

    if (this.manualMode) {
      this.fastOn = this.man.fast;
      this.medOn = this.man.med;
      this.slowOn = this.man.slow;

      // Manual Override's Clamp button is a foot-pedal signal, so it runs the
      // real clamp-then-discharge sequence rather than just holding the output.
      if (this.pedal && !this.mdState) { this.pedal = false; this.mdState = 'CLAMP'; this.mdT = 0; }

      if (this.mdState) {
        this.mdT += dt;
        if (this.mdState === 'CLAMP') {
          this.clampOn = true;
          if (this.mdT >= r.times.clampDelay) { this.mdState = 'DISC'; this.mdT = 0; }
        } else if (this.mdState === 'DISC') {
          this.clampOn = true;
          if (this.quantise(this.trueReading()) <= r.dischargeZero) { this.mdState = 'DDELAY'; this.mdT = 0; }
        } else if (this.mdState === 'DDELAY') {
          if (this.mdT >= r.times.dischargeDelay) { this.mdState = 'UNCLAMP'; this.mdT = 0; }
        } else if (this.mdState === 'UNCLAMP') {
          if (this.mdT >= r.times.unclampDelay) { this.mdState = null; this.clampOn = false; }
        }
        // the discharge gate is open for the clamped part of the sequence
        this.discOn = this.man.disc || this.mdState === 'DISC' || this.mdState === 'DDELAY';
      } else {
        this.discOn = this.man.disc;
        this.clampOn = false;
      }
      return;
    }

    // overload is checked everywhere
    if (this.isOverload() && (!this.alarm || this.alarm.code !== 'OFL')) {
      this.raise('OFL', 'Overload');
      this.fastOn = this.medOn = this.slowOn = false;
      this.running = false;
      this.setState('STOP');
      return;
    }

    switch (this.state) {
      case 'STOP':
        this.fastOn = this.medOn = this.slowOn = false;
        this.discOn = this.man.disc;
        this.holdOn = false;
        if (this.running) { this.cycleStart = this.t; this.setState('FEED_DELAY'); }
        break;

      case 'FEED_DELAY':
        this.fastOn = this.medOn = this.slowOn = false;
        this.discOn = false;
        if (this.phaseT >= r.times.feedDelay) this.setState('FEED');
        break;

      case 'FEED': {
        if (this.hopper <= 0) {
          this.raise('HOPPER', 'Hopper empty');
          this.fastOn = this.medOn = this.slowOn = false;
          this.running = false;
          this.setState('STOP');
          break;
        }
        if (this.pressure < 0.20) {
          this.raise('AIR', 'Low air pressure');
        }
        // controller samples at a fixed interval, which is itself a source of
        // cutoff latency proportional to flow rate
        this.sampleAcc += dt;
        if (this.sampleAcc >= K.sampleTime) {
          this.sampleAcc = 0;
          var d = this.feedDemand(w);
          this.fastOn = d.fast;
          this.medOn = d.med;
          this.slowOn = d.slow;
          if (!d.fast && !d.med && !d.slow) this.setState('STAB');
        }
        // feed timeout — no flow
        if (this.phaseT > 30) {
          this.raise('NOFLOW', 'Feed timeout');
          this.fastOn = this.medOn = this.slowOn = false;
          this.running = false;
          this.setState('STOP');
        }
        break;
      }

      case 'STAB':
        this.fastOn = this.medOn = this.slowOn = false;
        if (this.phaseT >= r.times.stab) this.setState('CHECK');
        break;

      case 'CHECK':
        if (this.phaseT >= r.ou.checkDelay) {
          var fin = this.quantise(this.trueReading());
          this.lastFill = fin;        // what the machine believes it weighed
          this.lastTrue = this.mass;  // what a check scale would say
          if (r.ou.func) {
            if (fin > r.target + r.ou.over) {
              this.raise('OVER', 'Over tolerance');
              if (r.ou.pause) { this.setState('ALARM_HOLD'); break; }
            } else if (fin < r.target - r.ou.under) {
              this.raise('UNDER', 'Under tolerance');
              if (r.ou.pause) { this.setState('ALARM_HOLD'); break; }
            }
          }
          this.setState('WAIT_CLAMP');
        }
        break;

      case 'ALARM_HOLD':
        this.holdOn = true;
        this.pedal = false;          // will not discharge until cleared
        break;

      case 'WAIT_CLAMP':
        this.holdOn = true;
        if (this.pedal) {
          this.pedal = false;
          this.holdOn = false;
          this.setState('CLAMP_DELAY');
        }
        break;

      case 'CLAMP_DELAY':
        this.clampOn = true;
        if (this.phaseT >= r.times.clampDelay) {
          this.discOn = true;
          this.setState('DISCHARGE');
        }
        break;

      case 'DISCHARGE':
        this.clampOn = true;
        this.discOn = true;
        if (this.quantise(this.trueReading()) <= r.dischargeZero) this.setState('DISCH_DELAY');
        break;

      case 'DISCH_DELAY':
        if (this.phaseT >= r.times.dischargeDelay) {
          this.discOn = false;
          this.finishFill();
          this.setState('UNCLAMP_DELAY');
        }
        break;

      case 'UNCLAMP_DELAY':
        if (this.phaseT >= r.times.unclampDelay) {
          this.clampOn = false;
          this.setState('END_UNCLAMP');
        }
        break;

      case 'END_UNCLAMP':
        if (this.phaseT >= r.times.endUnclampDelay) {
          if (this.batchSet > 0 && this.complete >= this.batchSet) {
            this.raise('BATCH', 'Batch finished');
            this.running = false;
            this.setState('BATCH_END');
          } else if (this.running) {
            this.cycleStart = this.t;
            this.setState('FEED_DELAY');
          } else {
            this.setState('STOP');
          }
        }
        break;

      case 'BATCH_END':
        this.fastOn = this.medOn = this.slowOn = false;
        break;
    }
  };

  Machine.prototype.finishFill = function () {
    var r = this.recipe();
    var wt = this.lastFill == null ? 0 : this.lastFill;
    var tw = this.lastTrue == null ? wt : this.lastTrue;
    this.accNums += 1;
    this.accWt += wt;
    this.complete += 1;
    var dev = wt - r.target;
    var inSpec = !r.ou.func || (dev <= r.ou.over && -dev <= r.ou.under);
    this.log.push({
      n: this.accNums,
      recipe: r.name || ('Rec ' + r.n),
      target: r.target,
      weight: wt,          // the machine's reading
      trueWeight: tw,      // actual mass, i.e. what a check scale shows
      calErr: tw - wt,
      dev: dev,
      inSpec: inSpec,
      cycle: this.t - this.cycleStart,
      fast: r.fast, med: r.med, slow: r.slow
    });
    if (this.log.length > 500) this.log.shift();
  };

  /* ----- top-level tick ----- */

  // Fixed sub-steps keep the physics identical at any frame rate; the remainder
  // is carried so simulated time tracks real time instead of drifting (rounding
  // the step count made the machine run at ~70% speed on a 144 Hz display).
  Machine.prototype.tick = function (dt) {
    var h = 0.005;
    this.stepAcc += Math.min(dt, 0.25);
    var guard = 0;
    while (this.stepAcc >= h && guard < 200) {
      this.stepController(h);
      this.stepPlant(h);
      this.stepScale(h);
      this.stepAcc -= h;
      guard++;
    }
  };

  /* ----- status text ----- */

  var STATE_TEXT = {
    STOP: 'Stop',
    FEED_DELAY: 'Feed Delay',
    FEED: 'Feeding',
    STAB: 'Stabilising',
    CHECK: 'Check Wt',
    ALARM_HOLD: 'Alarm Hold',
    WAIT_CLAMP: 'Wait Clamp',
    CLAMP_DELAY: 'Clamping',
    DISCHARGE: 'Discharging',
    DISCH_DELAY: 'Discharging',
    UNCLAMP_DELAY: 'Unclamp',
    END_UNCLAMP: 'Cycle End',
    BATCH_END: 'Batch End'
  };

  var MD_TEXT = { CLAMP: 'Clamping', DISC: 'Discharging', DDELAY: 'Discharging', UNCLAMP: 'Unclamp' };

  Machine.prototype.operationText = function () {
    if (this.manualMode) return this.mdState ? MD_TEXT[this.mdState] : 'Manual';
    if (this.state === 'FEED') {
      if (this.fastOn) return 'Fast Feed';
      if (this.medOn) return 'Med Feed';
      if (this.slowOn) return 'Slow Feed';
      return 'Feeding';
    }
    return STATE_TEXT[this.state] || this.state;
  };

  /* ----- statistics over the fill log ----- */

  Machine.prototype.stats = function (limit) {
    var rows = this.log.slice(-(limit || 30));
    if (!rows.length) return null;
    var n = rows.length, sum = 0, min = Infinity, max = -Infinity, bad = 0, ct = 0, tsum = 0;
    for (var i = 0; i < n; i++) {
      var w = rows[i].weight;
      sum += w; ct += rows[i].cycle;
      tsum += rows[i].trueWeight == null ? w : rows[i].trueWeight;
      if (w < min) min = w;
      if (w > max) max = w;
      if (!rows[i].inSpec) bad++;
    }
    var mean = sum / n, v = 0;
    for (var j = 0; j < n; j++) v += Math.pow(rows[j].weight - mean, 2);
    var sd = n > 1 ? Math.sqrt(v / (n - 1)) : 0;
    return {
      n: n, mean: mean, sd: sd, min: min, max: max, range: max - min,
      trueMean: tsum / n, calErr: (tsum / n) - mean,
      bad: bad, target: rows[n - 1].target,
      cycle: ct / n, rate: ct > 0 ? 60 / (ct / n) : 0,
      rows: rows
    };
  };

  global.PFSim = {
    Machine: Machine,
    COFFEES: COFFEES,
    K: K,
    makeRecipe: makeRecipe,
    defaultTimes: defaultTimes,
    defaultOU: defaultOU
  };
})(typeof window !== 'undefined' ? window : this);
