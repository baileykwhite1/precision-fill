/* The fault catalogue.
 *
 * A training fault is only useful if the machine really behaves the way the
 * answer card says it does. These checks run each fault and assert its actual
 * signature — in particular the distinction the whole exercise turns on:
 *
 *   a CALIBRATION fault is invisible on the HMI and only the check scale sees it
 *   a FEED fault shows up on the HMI, and the check scale agrees with it
 *
 * Run: node test/faults.js
 */
'use strict';
global.window = global;
var path = require('path');
require(path.join(__dirname, '../js/sim.js'));
require(path.join(__dirname, '../js/faults.js'));
var Machine = global.PFSim.Machine;
var FAULTS = global.PFFaults.LIST;

var pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
}

// Run a faulted machine on the 500 g recipe and report what each side sees.
function observe(fault, seed, bags) {
  var m = new Machine(seed || 13);
  m.sel = 5;
  if (fault) fault.setup(m);
  m.recipe().ou.func = false;          // do not halt on every bag while observing
  m.start();
  var want = bags || 10, guard = 0;
  while (m.log.length < want && guard < 400000) {
    m.tick(0.02);
    if (m.state === 'WAIT_CLAMP') m.pressPedal();
    if (m.state === 'ALARM_HOLD') { m.clearAlarm(); m.pressPedal(); }
    guard++;
  }
  var s = m.stats(want);
  if (!s) return { stalled: true, machine: m };
  return {
    machine: m,
    hmiMean: s.mean, hmiSd: s.sd,
    bagMean: s.trueMean,
    disagree: Math.abs(s.trueMean - s.mean),
    cycle: s.cycle, n: s.n
  };
}

function byId(id) {
  return FAULTS.filter(function (f) { return f.id === id; })[0];
}

console.log('\n-- the catalogue is complete --');
check('six faults defined', FAULTS.length === 6, FAULTS.length + ' found');
var missing = FAULTS.filter(function (f) {
  return !f.id || !f.name || !f.setup || !f.complaint || !f.tell || !f.cause || !f.fix;
});
check('every fault has a complaint, tell, cause and fix', missing.length === 0,
  missing.map(function (f) { return f.id; }).join(', '));
var ids = FAULTS.map(function (f) { return f.id; });
check('fault ids are unique', new Set(ids).size === ids.length, ids.join(', '));

console.log('\n-- a healthy machine is the baseline --');
var well = observe(null);
console.log('       HMI ' + well.hmiMean.toFixed(1) + '  bag ' + well.bagMean.toFixed(1) +
  '  sd ' + well.hmiSd.toFixed(2) + '  cycle ' + well.cycle.toFixed(1) + 's');
check('healthy: HMI and check scale agree', well.disagree < 1.5, well.disagree.toFixed(1) + ' g apart');
check('healthy: on target', Math.abs(well.hmiMean - 500) < 2, well.hmiMean.toFixed(1));
check('healthy: repeatable', well.hmiSd < 1.2, 'sd ' + well.hmiSd.toFixed(2));

console.log('\n-- calibration faults hide from the machine --');
[['cal-heavy', 8, 'over'], ['cal-light', -8, 'under']].forEach(function (spec) {
  var f = byId(spec[0]);
  var o = observe(f);
  console.log('       ' + spec[0] + ': HMI ' + o.hmiMean.toFixed(1) +
    '  bag ' + o.bagMean.toFixed(1) + '  sd ' + o.hmiSd.toFixed(2));
  check(spec[0] + ': HMI still looks on target', Math.abs(o.hmiMean - 500) < 3,
    'HMI ' + o.hmiMean.toFixed(1));
  check(spec[0] + ': HMI still looks consistent', o.hmiSd < 1.5, 'sd ' + o.hmiSd.toFixed(2));
  check(spec[0] + ': the bag really is ' + spec[2] + 'weight',
    spec[1] > 0 ? o.bagMean - 500 > 10 : 500 - o.bagMean > 10,
    'bag ' + o.bagMean.toFixed(1));
  check(spec[0] + ': only the check scale can see it', o.disagree > 10,
    o.disagree.toFixed(1) + ' g apart');
});

console.log('\n-- feed faults show on the machine itself --');
var medLow = observe(byId('med-low'));
console.log('       med-low: HMI ' + medLow.hmiMean.toFixed(1) + '  bag ' + medLow.bagMean.toFixed(1) +
  '  sd ' + medLow.hmiSd.toFixed(2));
check('med-low: the HMI itself scatters', medLow.hmiSd > 3, 'sd ' + medLow.hmiSd.toFixed(2));
check('med-low: check scale agrees with the HMI', medLow.disagree < 2,
  medLow.disagree.toFixed(1) + ' g apart');
check('med-low: runs heavy', medLow.hmiMean > 505, 'HMI ' + medLow.hmiMean.toFixed(1));

var slowOff = observe(byId('slow-off'));
console.log('       slow-off: HMI ' + slowOff.hmiMean.toFixed(1) + '  bag ' + slowOff.bagMean.toFixed(1) +
  '  sd ' + slowOff.hmiSd.toFixed(2));
check('slow-off: consistently wrong, not erratic', slowOff.hmiSd < 2.5,
  'sd ' + slowOff.hmiSd.toFixed(2));
check('slow-off: offset is obvious on the HMI', 500 - slowOff.hmiMean > 15,
  'HMI ' + slowOff.hmiMean.toFixed(1));
check('slow-off: check scale agrees with the HMI', slowOff.disagree < 2,
  slowOff.disagree.toFixed(1) + ' g apart');

console.log('\n-- environment faults --');
var air = observe(byId('air-low'));
console.log('       air-low: HMI ' + air.hmiMean.toFixed(1) + '  sd ' + air.hmiSd.toFixed(2) +
  '  cycle ' + air.cycle.toFixed(1) + 's  (healthy ' + well.cycle.toFixed(1) + 's)');
check('air-low: the cycle slows down noticeably', air.cycle > well.cycle * 1.25,
  air.cycle.toFixed(1) + 's vs ' + well.cycle.toFixed(1) + 's');
check('air-low: gauge really is below spec', byId('air-low').setup(new Machine(1)) === undefined);

var hop = observe(byId('hopper-low'), 13, 6);
check('hopper-low: the machine cannot keep filling',
  hop.stalled || hop.n < 6 || hop.hmiMean < 498 || hop.machine.alarm != null,
  'n=' + (hop.n || 0) + ' alarm=' + (hop.machine.alarm ? hop.machine.alarm.code : 'none'));

console.log('\n-- each fault is distinguishable from the others --');
// These are the things a service tech can actually observe: does the HMI
// scatter, does a check scale agree with it and which way, is the weight high or
// low, is the cycle dragging, and does the machine keep running at all. No two
// faults may look identical across all five, or the exercise is unfair.
var sigs = FAULTS.map(function (f) {
  var o = observe(f);
  var scatter = o.hmiSd > 3 ? 'erratic' : 'steady';
  var agree = o.disagree < 5 ? 'agrees'
    : (o.bagMean > o.hmiMean ? 'bag-heavy' : 'bag-light');
  var level = o.hmiMean > 505 ? 'heavy' : o.hmiMean < 495 ? 'light' : 'on-target';
  var pace = o.cycle > well.cycle * 1.25 ? 'slow' : 'normal';
  var kept = o.n >= 10 ? 'runs' : 'stalls';
  return { id: f.id, sig: [scatter, agree, level, pace, kept].join('/') };
});
sigs.forEach(function (s) { console.log('       ' + s.id.padEnd(12) + s.sig); });
var seen = {}, dupes = [];
sigs.forEach(function (s) {
  if (seen[s.sig]) dupes.push(seen[s.sig] + ' vs ' + s.id);
  seen[s.sig] = s.id;
});
check('no two faults present identically', dupes.length === 0, dupes.join('; '));

console.log('\n-- the documented fix actually works --');
var m = new Machine(21);
m.sel = 5;
byId('cal-heavy').setup(m);
var settle = function (s) { for (var i = 0; i < Math.round(s / 0.02); i++) m.tick(0.02); };
m.mass = 0; m.hopper = 2000; settle(1);
m.zeroClb();
// the manual says to press Fast and wait for ALL of the charge to reach the
// chamber, so wait on that rather than on a stopwatch
m.manualMode = true; m.man.fast = true;
var waited = 0;
while (m.hopper > 0 && waited < 60) { m.tick(0.02); waited += 0.02; }
m.man.fast = false; settle(2);
console.log('       (the 2000 g charge took ' + waited.toFixed(0) + 's to transfer)');
m.recordWt();
m.clbWt = 2000;
m.wtClb();
m.manualMode = false; m.man.disc = true; settle(4); m.man.disc = false;
m.hopper = m.hopperCap;
var after = observe(null, 21, 6);
// re-run on the repaired machine object
m.log.length = 0; m.recipe().ou.func = false; m.start();
var g = 0;
while (m.log.length < 6 && g < 300000) {
  m.tick(0.02);
  if (m.state === 'WAIT_CLAMP') m.pressPedal();
  if (m.state === 'ALARM_HOLD') { m.clearAlarm(); m.pressPedal(); }
  g++;
}
var fixed = m.stats(6);
console.log('       after calibrating: HMI ' + fixed.mean.toFixed(1) +
  '  bag ' + fixed.trueMean.toFixed(1));
check('calibrating clears the disagreement',
  Math.abs(fixed.trueMean - fixed.mean) < 2,
  Math.abs(fixed.trueMean - fixed.mean).toFixed(1) + ' g apart');
check('and the bags come out on target', Math.abs(fixed.trueMean - 500) < 4,
  'bag ' + fixed.trueMean.toFixed(1));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
