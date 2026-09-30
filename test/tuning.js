/* Tuning characteristics.
 *
 * These lock in the behaviour the manual's tuning method depends on, and that an
 * operator who knows the real machine expects to feel:
 *
 *   - a well-tuned recipe repeats the same number, it does not wander
 *   - lowering Med makes the machine ERRATIC, progressively, not just heavy
 *   - raising Med back up recovers the repeat
 *   - Slow moves the mean about 1 g per gram and barely touches consistency
 *
 * Run: node test/tuning.js
 */
'use strict';
global.window = global;
require(require('path').join(__dirname, '../js/sim.js'));
var Machine = global.PFSim.Machine;

var pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
}

// Run a recipe with the over/under alarm off — tuning is done by reading weights,
// not by being halted after every bag.
function sample(opts) {
  var m = new Machine(opts.seed == null ? 7 : opts.seed);
  m.sel = opts.recipe == null ? 5 : opts.recipe;
  var r = m.recipe();
  if (opts.med != null) r.med = opts.med;
  if (opts.slow != null) r.slow = opts.slow;
  if (opts.fast != null) r.fast = opts.fast;
  r.ou.func = false;
  m.hopper = m.hopperCap;
  m.start();
  var bags = opts.bags || 16, guard = 0;
  while (m.log.length < bags && guard < 400000) {
    m.tick(0.02);
    if (m.state === 'WAIT_CLAMP') m.pressPedal();
    if (m.state === 'ALARM_HOLD') { m.clearAlarm(); m.pressPedal(); }
    guard++;
  }
  return m.stats(bags);
}

// Average over several seeds so a single lucky run cannot pass a check.
function avg(opts, seeds) {
  var sd = 0, mean = 0, range = 0, n = seeds.length;
  seeds.forEach(function (s) {
    var o = {};
    for (var k in opts) o[k] = opts[k];
    o.seed = s;
    var st = sample(o);
    sd += st.sd; mean += st.mean; range += st.range;
  });
  return { sd: sd / n, mean: mean / n, range: range / n };
}

var SEEDS = [3, 11, 29, 47];

console.log('\n-- a tuned recipe repeats --');
var tuned = avg({ med: 130, slow: 8 }, SEEDS);
check('Med 130 / Slow 8 holds the target', Math.abs(tuned.mean - 500) <= 1.5,
  'mean ' + tuned.mean.toFixed(1));
check('Med 130 / Slow 8 repeats (sd under 1 g)', tuned.sd < 1.0, 'sd ' + tuned.sd.toFixed(2));
check('Med 130 / Slow 8 spans no more than 3 g', tuned.range <= 3, 'range ' + tuned.range.toFixed(1));

console.log('\n-- lowering Med makes it erratic, progressively --');
var curve = [130, 110, 90, 70, 50].map(function (med) {
  return { med: med, s: avg({ med: med, slow: 8 }, SEEDS) };
});
curve.forEach(function (p) {
  console.log('       med ' + String(p.med).padStart(3) +
    '  sd ' + p.s.sd.toFixed(2).padStart(5) +
    '  range ' + p.s.range.toFixed(1).padStart(5) +
    '  mean ' + p.s.mean.toFixed(1));
});
// Only through the region an operator actually tunes in. Below that the slow
// phase is bypassed entirely, so the fill is just "cutoff plus one avalanche"
// and the scatter saturates — lowering Med further adds overshoot, not spread.
var rising = true;
for (var i = 1; i <= 3; i++) if (curve[i].s.sd <= curve[i - 1].s.sd) rising = false;
check('scatter grows at every step down through the tuning region', rising,
  curve.slice(0, 4).map(function (p) { return p.s.sd.toFixed(2); }).join(' -> '));
check('below the tuning region it stays erratic', curve[4].s.sd > curve[0].s.sd * 5,
  'sd ' + curve[4].s.sd.toFixed(2) + ' at med 50');
check('Med 50 is at least 6x more scattered than Med 130',
  curve[4].s.sd > curve[0].s.sd * 6,
  curve[0].s.sd.toFixed(2) + ' vs ' + curve[4].s.sd.toFixed(2));
check('the erratic regime really is erratic, not just heavy',
  curve[3].s.range >= 12, 'range at med 70 = ' + curve[3].s.range.toFixed(1));

console.log('\n-- raising Med back recovers the repeat --');
check('Med 110 is already worse than 130', curve[1].s.sd > curve[0].s.sd * 1.4,
  curve[0].s.sd.toFixed(2) + ' -> ' + curve[1].s.sd.toFixed(2));
var high = avg({ med: 200, slow: 8 }, SEEDS);
check('Med 200 is still tight', high.sd < 1.0, 'sd ' + high.sd.toFixed(2));

console.log('\n-- Slow moves accuracy, not consistency --');
var slowPts = [4, 8, 12, 16].map(function (sl) { return { sl: sl, s: avg({ med: 130, slow: sl }, SEEDS) }; });
slowPts.forEach(function (p) {
  console.log('       slow ' + String(p.sl).padStart(2) +
    '  mean ' + p.s.mean.toFixed(1).padStart(6) +
    '  sd ' + p.s.sd.toFixed(2));
});
var gPerG = (slowPts[0].s.mean - slowPts[3].s.mean) / (slowPts[3].sl - slowPts[0].sl);
check('about 1 g of target per gram of Slow', gPerG > 0.75 && gPerG < 1.35,
  gPerG.toFixed(2) + ' g per g');
var worstSlowSd = Math.max.apply(null, slowPts.map(function (p) { return p.s.sd; }));
check('Slow barely affects consistency', worstSlowSd < 1.4, 'worst sd ' + worstSlowSd.toFixed(2));
check('Slow 8 sits within a gram of target', Math.abs(slowPts[1].s.mean - 500) <= 1.5,
  'mean ' + slowPts[1].s.mean.toFixed(1));

console.log('\n-- the shipped recipes are tuned --');
[[1, 2300], [2, 1000], [3, 454], [4, 100], [5, 500]].forEach(function (p) {
  var s = avg({ recipe: p[0], bags: 10 }, [5, 19]);
  check('Rec ' + p[0] + ' (' + p[1] + ' g) lands on target',
    Math.abs(s.mean - p[1]) <= 2.0 && s.sd < 2.0,
    'mean ' + s.mean.toFixed(1) + ' sd ' + s.sd.toFixed(2));
});

console.log('\n-- Fast still only buys speed, and breaks when too low --');
var fastOk = avg({ recipe: 1, fast: 900, bags: 8 }, [5, 19]);
var fastLow = avg({ recipe: 1, fast: 120, bags: 8 }, [5, 19]);
check('Fast 900 holds 2300 g', Math.abs(fastOk.mean - 2300) <= 3, 'mean ' + fastOk.mean.toFixed(1));
check('Fast far too low overfills badly', fastLow.mean > 2310,
  'mean ' + fastLow.mean.toFixed(1));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
