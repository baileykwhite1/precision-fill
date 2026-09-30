# Precision Fill Emulator — design & machine model

A software emulator of the SOVDA Precision Fill / Precision Fill Mini net-weigh
filler and its AMC501-U HMI. It exists so an operator can learn to calibrate the
machine and tune a recipe — the two things that actually go wrong — without
standing at a machine or wasting coffee.

Everything in [Behaviour](#behaviour-taken-from-the-manual) is taken from the
[user manual](https://knowledge.sovdacoffee.com/user-manual-precision-fill) and
its screenshots. Everything in [Physics](#physics-the-part-the-manual-doesnt-state)
is a model chosen to *reproduce* the behaviour the manual describes; the manual
does not state flow rates, so those constants are ours and are marked as such.

## What kind of machine this is

The Precision Fill is a **two-hopper net-weigh filler**. Coffee sits in an upper
storage hopper. A pneumatic cylinder drives a pivoting gate that lets coffee fall
into a weighing chamber sitting on a load cell. When the chamber holds the target
weight, the operator puts a bag on the outlet head and presses a foot pedal; a
discharge gate opens and the charge drops into the bag.

"Net weigh" means each charge is weighed on its own before it ever reaches the
bag — as opposed to weighing the bag as it fills. The consequence that drives
every tuning decision: **the controller can only stop the feed, it cannot un-feed.**
Coffee already falling when the gate shuts still lands. So the cutoff has to
happen *early*, by an amount equal to what is in the air. In general net-weigher
terminology that offset is the *preact*; on this machine it is spelled Fast /
Med / Slow Feed.

### The three feeds

| Feed | Actuator | Manual's words | Used for |
|---|---|---|---|
| Fast | Gate driven **fully** open | "Opens the gate fully for quick bulk filling" | ≥ 1000 g only |
| Med | Gate driven **partly** open | "Partially opens the gate for controlled filling" | ≥ 150 g |
| Slow | Gate shut, **vibrating plate** | "Closes the gate and uses a vibrating plate" | ≤ 150 g, and final top-off |

Fast and Med are two stroke positions of the same gate, so they are mutually
exclusive. Slow is a separate device, so it runs *alongside* whichever gate
position is active and is the last thing to shut off.

Air pressure must be 0.4 MPa. Below that the cylinder neither opens nor closes
the gate cleanly, which shows up as scatter — so the emulator models it.

## Behaviour taken from the manual

### Cutoff arithmetic

> "The weight listed next to a feed is the weight difference from the target
> weight which will shut off that feed type."

So each feed value is an offset *below* target, and a feed runs while the
measured weight is below its cutoff:

```
fast runs while  w < target − fast
med  runs while  w < target − med
slow runs while  w < target − slow
```

Because `fast > med > slow` as values, the cutoffs ascend, and the feeds drop out
in order Fast → Med → Slow. Setting a feed value **equal to the target** disables
it (its cutoff lands at 0, already passed). That is the documented way to switch
Fast off on a sub-1000 g recipe, and the same trick disables Med on a ≤150 g
recipe.

The manual's worked example, which the emulator reproduces exactly — Target 340,
Fast 340, Med 180, Slow 12:

- Fast cutoff `340−340 = 0` → never runs.
- Med cutoff `340−180 = 160` → Med shuts off at 160 g in the chamber.
- Slow cutoff `340−12 = 328` → all feeds off at 328 g.
- The remaining ~12 g is material already in flight, which lands to make target.

### Why tuning works the way it does

The manual prescribes: get **consistency** first with Med, then **accuracy** with
Slow. That order is not arbitrary, and the model has to explain it:

- **Med sets consistency.** When Med cuts off, a large flow is in the air, and
  that in-flight lump has real scatter (it is a random number of beans). If Med
  cuts off too late — a Med *value* that is too low — that scatter lands near
  target with no time left to correct it, and you get the manual's 496 / 482 /
  508. Raising Med cuts the gate earlier, handing the final approach to the
  low-rate vibrating plate, whose in-flight lump is small and therefore tight.
  Consistency is bought with cycle time, which is why the manual wants the
  *lowest* Med that is still consistent.
- **Slow sets accuracy.** Once the final approach is at a fixed low rate, the
  in-flight amount is a repeatable constant. Slow just has to equal it. Hence the
  manual's rule: over by *n* grams → raise Slow by *n*; under by *n* → lower Slow
  by *n*. It converges in one step, which is the signature of a constant offset.
- **Fast only buys speed**, and only above 1000 g. Too low and its cutoff plus
  its large in-flight overshoots everything downstream — "the machine will
  dispense significantly more coffee than the target." Too high and you have
  simply made the cycle longer for nothing.

### Cycle sequence

Timings are the per-recipe Time Set values (4.3.x). Manual-recommended values in
brackets.

1. **Stop** — idle.
2. Start pressed → **Feed Delay Time** [1.0 s] before feeding begins (4.3.1).
3. **Feeding** — feeds drop out per the cutoff arithmetic above.
4. **Stabilisation Time** [0.5 s] after the last feed shuts, for in-flight to
   land and the load cell to settle (4.3.2). STAB lamp goes green.
5. **Over/Under check** after Check Delay Time [0.5 s] (4.5.2). Outside
   tolerance → O/U lamp, warning text, and if Over/Under Pause is ON the machine
   will not discharge until `Clr Alarm`.
6. **Wait Clamp** — charge is ready, machine waits on the foot pedal. This is
   where the operator bags.
7. Pedal → **Clamp Delay Time** [0.5 s] (4.3.4) → clamp closes, discharge gate
   opens.
8. **Discharging** — when the remaining weight falls to **Discharge Zero Area**
   (4.2.5, e.g. 30 g) the controller waits **Discharge Delay Time** [0.5 s]
   (4.3.3) so the last beans clear, then shuts the gate.
9. **Unclamp Delay Time** [0.5 s] (4.3.5) → clamp releases → **End Unclamp Delay
   Time** [1.0 s] (4.3.6) → next cycle starts.
10. Counters advance: Acc. Nums, Acc. Wt, Complete. If Batch > 0 and Complete
    reaches it, the machine stops and needs `Clr Alarm`.

### Scale and calibration

From screen 1.1 (Wt Clb): Unit `g`, Accuracy `0` decimals, Division Value `1`,
Capacity `2500 g`. Division quantises the reading — at Division 2 the scale
counts 2 g at a time. Over capacity the readout shows `OFL`.

Material calibration (1.2) is the documented procedure, and the emulator
implements it as a real two-point calibration you can get wrong:

1. Empty the chamber (Fast + Discharge).
2. Let the reading settle, `Zero Clb` — stores the zero offset.
3. Load a known 2000 g, let it settle, `Record Wt` — captures the raw span.
4. Type the true weight into `Clb Wt`, press `Wt Clb` — sets the scale factor.

Enter the wrong number in step 4 and every fill afterwards is proportionally
wrong, which is a failure mode worth being able to practise on.

### Alarms

Over Tolerance, Under Tolerance, Batch Finished, `OFL` overload, low air
pressure, and hopper-empty / no-flow. All clear with `Clr Alarm` (F3). An alarm is
a fault rather than a state, so it is shown in red and pulses until acknowledged —
the warning field, the `O/U` indicator on the LCD strip and the `Clr Alarm` key
all go red together.

### AI Pack

The manual says only that it "turns on/off the intelligent packing function" and
warns that it will modify your feed values. The emulator makes it do the obvious
thing: it applies the manual's own accuracy rule automatically, trimming Slow
toward the target by up to 3 g per weighment. It trims on the **weighment**, not
after the discharge, because an out-of-tolerance fill blocks the discharge and
that is precisely when it needs to adapt.

### The readout and the STAB lamp

Two details that matter more than they sound. The weight is repainted every frame
with only a 10 ms display filter, because the real readout counts up essentially
live and digits that lag or stutter read as a broken machine. The instrument
voltages are repainted a few times a second instead, since they barely move.

`STAB` is a **latch over a window**, not an instantaneous comparison: the reading
must sit inside a band for 0.35 s to go stable, and needs an excursion of 2.5x
that band to drop out. Compared instantaneously, load-cell noise sits on the
threshold and the lamp chatters continuously. `ZERO` gets the same hysteresis for
the same reason.

## Physics — the part the manual doesn't state

A time-stepped model at 50 Hz, which is also roughly a load cell's update rate.
These constants were chosen so the emulator lands on the tuned values visible in
the manual's own screenshots — in particular Rec 5 (500 g) tuning out at
**Med 130 / Slow 9**, which is what the Shortcut screenshot shows.

| Constant | Value | Meaning |
|---|---|---|
| `maxGateRate` | 480 g/s | Flow with the gate fully open (Fast), nominal coffee at 0.4 MPa |
| `medOpenFrac` | 0.45 | Gate opening fraction for Med; flow ∝ opening^1.5 → ≈ 145 g/s |
| `vibRate` | 38 g/s | Vibrating plate (Slow) |
| `transitTime` | 0.12 s | Fall time from gate to chamber — the in-flight column |
| `tauGate` | 0.06 s | Pneumatic gate open/close time constant |
| `tauVib` | 0.10 s | Vibrator spin-up / coast-down |
| `sampleTime` | 0.02 s | Controller sample interval — adds cutoff latency ∝ rate |
| `beanMass` | 0.13 g | One bean; the source of discreteness and therefore of scatter |
| `fanoGate` | 1.8 | Gate stream regularity (variance / mean bean count) — worse than random |
| `fanoVib` | 0.20 | Plate stream regularity — far better than random |
| `vibTransit` | 0.09 s | The plate meters at the chamber mouth, a shorter drop than the gate |
| `capacity` | 2500 g | Weighing chamber |

Flow leaves each feeder into a transport pipeline and arrives a fall time later.
Mass per tick is converted to an expected bean count and drawn with a given
**Fano factor** — the ratio of variance to mean in that count. Fano 1 is Poisson;
above 1 is clumpy; below 1 is a regularly metered stream.

The two feeders are drawn **separately, with opposite statistics**, and this is
the heart of the model:

- The **gate** releases an avalanche. Bulk solids discharging through an orifice
  arrive in surges, not as independent grains, so its count is *worse* than
  random (`fanoGate` 1.8). A lump of gate in-flight is both large and variable.
- The **vibrating plate** meters a thin, near-ordered monolayer off a tray. That
  is a far more regular process than random arrival (`fanoVib` 0.20), so its
  in-flight lump is both small and repeatable.

Everything the operator feels follows from that contrast. When Med is high enough
that the slow phase makes the final approach, the last thing to land is a small,
regular lump, and the machine returns **the same number every bag**. As Med comes
down, the gate's cutoff moves closer to target until its avalanche starts landing
after the slow cutoff, uncorrected — and an avalanche is exactly the thing that
does not repeat, so the fills go **erratic** before they go merely heavy. Lower
still and the slow phase is bypassed entirely: the scatter then saturates (it is
one avalanche's worth either way) while the mean runs away, which is the
"significantly more coffee than the target" the manual warns about for Fast.

Measured across the range an operator actually tunes in, at target 500 g:

| Med | 130 | 110 | 90 | 70 | 50 |
|---|---|---|---|---|---|
| spread (sd) | 0.7 g | 1.2 g | 4.1 g | 6.3 g | 5.7 g |
| range over 16 bags | 2 g | 5 g | 15 g | 23 g | 20 g |
| mean error | +0.2 | +0.9 | +5.5 | +14.8 | +28.6 |

Slow, by contrast, moves the mean about one gram per gram and leaves the spread
alone (sd 0.5–0.9 across Slow 4 to 16) — accuracy without touching consistency,
which is why the manual tunes it second and in single grams.

`test/tuning.js` asserts all of this, so a later change to the physics cannot
quietly break the feel of the tuning procedure.

Sanity check on the 500 g recipe: the slow-phase overshoot is
`38 · (0.02 sample + 0.09 transit + 0.125 decay) ≈ 8.9 g`, so Slow lands between
8 and 9 — which is what the real machine tunes to. Walking the manual's whole
procedure on the emulator (drop Med by 10 until consistency is lost, back off 10,
then trim Slow by the deviation) converges on Med 140 / Slow 8 and finishes on
500 / 500 / 500.

### Running the hopper out

Discharge through an orifice barely depends on how full the hopper is — a deep
bed and a shallow one feed at much the same rate, which is why a roastery never
notices the level until it matters. It is only when the level drops toward the
outlet that the flow channel collapses, and then the rate falls away steeply:
full rate above 1.5 kg, about a third of it at 1 kg, and a fraction of it below
that. The last of the bed still slides down the walls at a steady trickle, so it
does empty rather than asymptoting towards never.

The result is the symptom operators actually report: the machine does not stop,
it **crawls**. From the 550 g the training fault ships with, the weight creeps up
at roughly 39 g every five seconds — against a healthy fill that finishes in
under seven seconds — it manages one underweight bag, and the hopper is empty
about 27 seconds in, ending on `Hopper empty` rather than a generic feed timeout.
The feed timeout sits at 45 s so the informative alarm is the one that fires.

This is also why the calibration exercise takes a moment: moving a 2000 g charge
into the chamber with Fast open runs about 12 seconds, since the last of it comes
through slowly. That matches the manual's instruction to press Fast and *wait for
all of the coffee to enter the weighing chamber*.

Coffee presets scale the flow rate, the bean mass and the surging: medium roast
is the baseline; dark roast flows a little slower on a bigger, more brittle bean;
light roast and decaf are denser; peaberry is small, round and free-running; an
oily dark roast is the worst-behaved, surging rather than streaming. **Whole bean
only** — the Precision Fill is not a ground-coffee machine, so there is no ground
preset. The manual's own advice — "for very dense or very light coffees (e.g.
decaf vs peaberry), consider creating separate recipes" — is a thing you can now
demonstrate: run a recipe tuned on medium roast with peaberry loaded and watch it
drift off target.

## What is inferred rather than documented

Called out so nobody mistakes the emulator for the spec:

- **Flow rates and all the physics constants above.** Chosen to reproduce
  documented behaviour and the screenshots' tuned values.
- **`Current Operation:` strings** other than `Stop`. Only `Stop` appears in the
  screenshots; the rest (`Feed Delay`, `Fast Feed`, `Stabilising`, `Wait Clamp`,
  `Discharging`, …) are plausible firmware wording.
- **Settings screens not photographed.** 2 Weighing Parameters, 3 Scale
  Parameters, 6 I/O, 8 Comm Setting, 9 Analog, 10 Logic, 11 Shortcut Setting and
  13 System appear as menu tiles but are not implemented; 4.4 Flapping, 4.6 Valve
  Set and 4.7 Feed Analog are stubbed, which matches the manual telling you not
  to touch them.
- **Exact alarm wording** beyond the Over/Under alarm the manual describes, and
  the fact that alarms are rendered red — the screenshots show no active alarm.
- **The AI Pack trim rule.** The manual documents the toggle and its warning, not
  the algorithm; the ±3 g Slow trim is ours.
- **The training faults** in `js/faults.js`. The failure modes are real and the
  fixes follow the manual, but the customer complaints, the wording and the
  chosen severities are ours. `test/faults.js` checks that each one actually
  produces the signature its answer claims, and that no two look alike across
  the five things a tech can observe — HMI scatter, whether a check scale agrees
  and which way, weight, cycle time, and whether the machine keeps running.
- **The pre-loaded recipes' feed values.** The manual gives the five targets
  (2300 / 1000 / 454 / 100 / 500 g) but only Rec 5's feeds are visible in a
  screenshot; the others use tuned values from this model.

Firmware typos are reproduced deliberately, not fixed: `Warring` for Warning on
the home screen, `Seleted Recipe` on 4.1.1. They are what an operator sees.
