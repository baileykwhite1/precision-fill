# Precision Fill Emulator

A software emulator of the SOVDA **Precision Fill** / **Precision Fill Mini** net-weigh
filler and its AMC501-U touchscreen. It reproduces the HMI screen for screen and
simulates the filling physics closely enough that **tuning a recipe on the emulator
teaches the same reflexes as tuning the real machine** — without a machine, and
without pouring coffee through it.

Built from the [Precision Fill user manual](https://knowledge.sovdacoffee.com/user-manual-precision-fill)
and its screenshots.

Static site — no build step, no dependencies, no backend. Open `index.html`, or
serve the folder:

```bash
python3 -m http.server 8731
```

## What it is for

The two things that actually go wrong on a Precision Fill are **calibration** and
**recipe tuning**, and both are hard to teach because each attempt costs a hopper
of coffee and a customer's afternoon. Here you can get them wrong for free.

- **Tune a recipe** the way the manual prescribes — consistency with Med Feed
  first, then accuracy with Slow Feed — and watch the spread on the chart tighten.
  Set Med too low and you get the manual's 496 / 482 / 508 scatter, for the real
  reason: the gate's in-flight coffee lands with no time left to correct it.
- **Calibrate the scale** through the real 1.2 Material Clb procedure, including
  the failure mode where you type the wrong number into `Clb Wt` and every fill
  afterwards is quietly 3% light. The fill log carries a check-scale column the
  machine itself cannot see, so you can spot exactly that.
- **Diagnose a fault.** Low air, a span error, a badly tuned Med, a starved
  hopper — each has its own fingerprint in the numbers.

## What is emulated

| | |
|---|---|
| **Home screen** | Live readout, RUN/FAST/MED/SLOW/O-U/HOLD/DISC/CLAMP lamps, operation status, recipe, target, batch, accumulated counts, STAB/ZERO lamps, F1–F7 |
| **Recipes** | 5 pre-loaded + up to 20, selectable from the home dropdown |
| **Shortcut** | Target, Fast/Med/Slow Feed, AI Pack, Feed Speed, Discharge Zero Area |
| **4 Recipe Setting** | 4.1 Recipe, 4.2 Target, 4.3 Time Set, 4.5 Over/Under (4.4, 4.6, 4.7 stubbed, as the manual says to leave them alone) |
| **1 Calibration** | 1.1 Wt Clb (unit, accuracy, division, capacity) and 1.2 Material Clb as a working two-point calibration with live sensor voltage |
| **Manual Override** | Fast / Med / Slow / Disc latches, Clamp as a foot-pedal signal, IO port runtime state |
| **7 Acc Data** | Batch Set, accumulated totals, clear |
| **Cycle timing** | All six Time Set delays drive the real sequence |
| **Alarms** | Over/Under with pause, batch finished, `OFL` overload, low air, hopper empty |
| **Rig** | Foot pedal (Space), hopper level, air pressure, six whole-bean products, run chart, fill log, CSV export |

Firmware quirks are reproduced rather than corrected — `Warring` on the home
screen, `Seleted Recipe` on 4.1.1 — because that is what an operator sees.

## Keyboard

`Space` foot pedal · `S` start/stop · `H` home · `C` clear alarm · `Esc` close popup.
Default system password is `0`.

## Layout

```
index.html        HMI markup + rig panel
css/hmi.css       AMC501-U skin, traced from the screenshots
js/sim.js         machine model — physics + controller state machine, no DOM
js/ui.js          screens, popups, keypads, render loop
js/rig.js         hopper/air/product controls, statistics, run chart, fill log
docs/DESIGN.md    the machine model, and what is documented vs inferred
```

`js/sim.js` is deliberately DOM-free so it can be driven headlessly:

```js
global.window = global;
require('./js/sim.js');
const m = new PFSim.Machine(7);
m.sel = 5;                       // the 500 g recipe
m.start();
while (m.log.length < 20) {
  m.tick(0.01);
  if (m.state === 'WAIT_CLAMP') m.pressPedal();
}
console.log(m.stats(20));        // { mean: 499.6, sd: 1.22, ... }
```

## Fidelity

Behaviour comes from the manual. The physics constants do not — the manual states
no flow rates — so they were chosen to reproduce documented behaviour, and they
land on the tuned values visible in the manual's own screenshots: the 500 g recipe
settles at **Med 130 / Slow 9**, which is what the Shortcut screenshot shows.

[docs/DESIGN.md](docs/DESIGN.md) sets out the model and is explicit about what is
inferred: the flow constants, the `Current Operation:` wording beyond `Stop`, the
settings screens that exist only as menu tiles, and the feed values of the
pre-loaded recipes other than Rec 5.

Whole bean only — the Precision Fill is not a ground-coffee machine.
