/* Precision Fill emulator — the fault catalogue.
 *
 * Each entry is something that actually goes wrong on a Precision Fill.
 * `complaint` is what a roastery rings in with and is the only part the trainee
 * sees; `tell`, `cause` and `fix` are the answer.
 *
 * DOM-free on purpose, so test/faults.js can assert that each fault really does
 * produce the signature its answer claims it does.
 */
(function (global) {
  'use strict';

  var LIST = [
    {
      id: 'cal-heavy',
      name: 'Scale span low — bags are overweight',
      setup: function (m) { m.rawPerGram = 0.969; },
      complaint: 'A roastery says their 500 g retail bags are weighing about 515 g ' +
        'on the shop scale. They are giving away coffee on every bag. The machine ' +
        'looks fine to them.',
      tell: 'The HMI is tight and dead on target, but the check scale disagrees with it. ' +
        'A machine cannot see its own scale error — it is measuring with a wrong ruler.',
      cause: 'The load cell span is about 3% low, so the chamber really holds ~515 g ' +
        'by the time the controller reads 500 g.',
      fix: 'System Settings (password 0) → 1 Calibration → 1.2 Material Clb. Empty the ' +
        'chamber, Zero Clb, load a known charge, Record Wt, type the true weight into ' +
        'Clb Wt, then Wt Clb.'
    },
    {
      id: 'cal-light',
      name: 'Scale span high — bags are underweight',
      setup: function (m) { m.rawPerGram = 1.031; },
      complaint: 'A roastery has had a short-weight complaint from a stockist. Their ' +
        '500 g bags are coming in around 484 g. The Precision Fill says 500 every time.',
      tell: 'Same signature as an overweight scale fault, the other way up: the HMI is ' +
        'consistent and on target while the check scale reads low.',
      cause: 'The load cell span is about 3% high, so the controller reaches 500 g ' +
        'before the chamber actually holds it.',
      fix: 'Re-run 1.2 Material Clb against a known weight. Short weight is a legal ' +
        'problem for the roastery, so confirm with a few bags on the check scale afterwards.'
    },
    {
      id: 'air-low',
      name: 'Air pressure well below spec',
      setup: function (m) { m.pressure = 0.17; },
      complaint: 'Bagging has got slow and the weights have gone wandery since they ' +
        'moved the machine to the other end of the roastery.',
      tell: 'Cycle time is noticeably longer and the fills scatter and run heavy. ' +
        'The gate is the clue: it cannot move properly.',
      cause: 'Air is down around 0.17 MPa. The cylinder cannot drive the gate cleanly, ' +
        'so it is slow to open, slow to seat, and lets coffee trickle past cutoff.',
      fix: 'Set the regulator on the side of the machine to 0.4 MPa — lift the dial, ' +
        'turn, push down to lock. Then look for why it dropped: compressor, a long or ' +
        'kinked line, or something else drawing air.'
    },
    {
      id: 'med-low',
      name: 'Med Feed set far too low',
      setup: function (m) { m.recipes[4].med = 45; },
      complaint: 'Someone was "speeding the machine up" last week. Now the 500 g bags ' +
        'are all over the place — some fine, some 20 g over — and the alarm keeps going.',
      tell: 'The HMI itself shows the scatter, and the check scale agrees with it. ' +
        'That rules out calibration: the machine is genuinely putting in the wrong amount.',
      cause: 'Med Feed is 45. The gate cuts off so late that its in-flight coffee lands ' +
        'after the slow cutoff, where nothing can correct it — and gate flow arrives in ' +
        'surges, so it never repeats.',
      fix: 'Raise Med Feed until the weights agree bag to bag — around 130 on this ' +
        'recipe — then trim Slow Feed by the deviation to bring it back onto target.'
    },
    {
      id: 'hopper-low',
      name: 'Hopper nearly empty',
      setup: function (m) { m.hopper = 550; },
      complaint: 'The machine has started running light and then stops with an alarm ' +
        'partway through a batch.',
      tell: 'Fills drift under, the cycle drags, and it eventually alarms. The simplest ' +
        'check on the list, and the one people skip.',
      cause: 'There is almost nothing left in the hopper. Head pressure falls away as it ' +
        'empties, so flow drops and the fill cannot make target.',
      fix: 'Refill the hopper. Worth telling the roastery to keep it topped up rather ' +
        'than running it down, because the last few kilos fill differently.'
    },
    {
      id: 'slow-off',
      name: 'Slow Feed mis-set',
      setup: function (m) { m.recipes[4].slow = 34; },
      complaint: 'Every bag is coming out around 475 g instead of 500 g. Very consistent ' +
        'about it, just wrong.',
      tell: 'Consistent but offset — and the check scale agrees with the HMI. Consistency ' +
        'means the feeds are behaving; a constant offset points at the Slow value, not the scale.',
      cause: 'Slow Feed is 34, so the controller shuts everything off 34 g before target ' +
        'when only about 8 g is actually in flight.',
      fix: 'Shortcut → Slow Feed. The manual\'s rule: under by n grams, drop Slow by n. ' +
        'From 34 that is roughly 8 or 9.'
    }
  ];

  global.PFFaults = { LIST: LIST };
})(typeof window !== 'undefined' ? window : this);
