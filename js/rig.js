/* Precision Fill emulator — test rig: physical controls, statistics, run chart.
 * The rig is deliberately outside the HMI: it is the things an operator does with
 * their hands, plus the check scale the machine cannot see. */
(function () {
  'use strict';

  var M = window.PFUI.M;
  var say = window.PFUI.say;
  var $ = function (id) { return document.getElementById(id); };

  var WINDOW = 25;          // fills shown in the chart and the tiles
  var tip = $('tip');

  /* ---------------- controls ---------------- */

  var coffeeSel = $('coffee');
  PFSim.COFFEES.forEach(function (c, i) {
    var o = document.createElement('option');
    o.value = c.id; o.textContent = c.name;
    coffeeSel.appendChild(o);
  });
  coffeeSel.onchange = function () {
    M.coffee = PFSim.COFFEES.filter(function (c) { return c.id === coffeeSel.value; })[0];
    say('Loaded ' + M.coffee.name + '. A recipe tuned on another coffee may drift.');
  };

  var hopSlider = $('hopper'), airSlider = $('air');
  hopSlider.oninput = function () { M.hopper = +hopSlider.value; };
  airSlider.oninput = function () { M.pressure = +airSlider.value; };

  $('refill').onclick = function () {
    M.hopper = M.hopperCap;
    hopSlider.value = M.hopperCap;
    say('Hopper refilled.');
  };
  $('empty').onclick = function () {
    M.mass = 0; M.transit.length = 0;
    say('Weighing chamber emptied.');
  };

  $('pedal').onmousedown = function () { M.pressPedal(); };
  $('pedal').ontouchstart = function (e) { e.preventDefault(); M.pressPedal(); };

  $('clearLog').onclick = function () { M.log.length = 0; renderLog(); drawChart(); };
  $('csv').onclick = function () {
    var head = 'n,recipe,target,reading,true_mass,deviation,in_spec,cycle_s,fast,med,slow\n';
    var body = M.log.map(function (r) {
      return [r.n, r.recipe, r.target, r.weight, r.trueWeight.toFixed(1), r.dev,
        r.inSpec ? 1 : 0, r.cycle.toFixed(2), r.fast, r.med, r.slow].join(',');
    }).join('\n');
    navigator.clipboard.writeText(head + body).then(
      function () { say(M.log.length + ' rows copied as CSV.'); },
      function () { say('Could not access the clipboard.'); }
    );
  };

  /* ---------------- training scenarios ---------------- */

  var TASKS = {
    tune: function () {
      var r = M.recipes[5];              // Rec 6
      r.enabled = true;
      r.name = '250g';
      r.target = 250;
      r.fast = 250;                      // disabled: Fast is for 1000 g and up
      r.med = 350;                       // deliberately far too high
      r.slow = 25;                       // deliberately too high
      r.dischargeZero = 30;
      M.sel = 6;
      M.log.length = 0;
      M.pressure = 0.40; airSlider.value = 0.40;
      M.hopper = M.hopperCap; hopSlider.value = M.hopperCap;
      return '<b>Tune Rec 6 (250 g).</b> Med is 350 and Slow is 25 — both far too high. ' +
        'Open Shortcut. Get <b>consistency</b> first: run 3 bags, drop Med by 10 until the ' +
        'weights stop agreeing, then put the last 10 back. Then get <b>accuracy</b>: if you are ' +
        'over by n grams raise Slow by n, if under lower it by n.';
    },

    calibrate: function () {
      M.rawPerGram = 1.0 + (M.rnd() * 0.06 - 0.03);   // up to 3% span error
      M.rawOffset = (M.rnd() * 30 - 15);
      M.mass = 0; M.transit.length = 0;
      M.hopper = 0; hopSlider.value = 0;
      M.log.length = 0;
      M.clbWt = 0; M.recordedRaw = null;
      return '<b>The scale is out.</b> Hopper is empty and the chamber is clear. ' +
        'Load a known charge with the button below, then System Settings (password 0) ' +
        '&rarr; 1 Calibration &rarr; 1.2 Material Clb: <b>Zero Clb</b>, press <b>Fast</b> to move the ' +
        'charge into the chamber, <b>Record Wt</b>, type the true weight into <b>Clb Wt</b>, then <b>Wt Clb</b>.';
    },

    fault: function () {
      var which = Math.floor(M.rnd() * 4);
      M.rawPerGram = 1; M.rawOffset = 0;
      M.pressure = 0.40; airSlider.value = 0.40;
      M.hopper = M.hopperCap; hopSlider.value = M.hopperCap;
      M.sel = 5;
      M.recipes[4] = PFSim.makeRecipe(5, '500g', 500, 500, 130, 9, 30);
      M.log.length = 0;
      if (which === 0) { M.pressure = 0.17; airSlider.value = 0.17; }
      else if (which === 1) { M.rawPerGram = 1.045; }
      else if (which === 2) { M.recipes[4].med = 45; }
      else { M.hopper = 600; hopSlider.value = 600; }
      return '<b>Something is wrong with this machine.</b> Recipe 5 (500 g) was signed off last week. ' +
        'Run a dozen bags, read the numbers, and work out what changed. ' +
        'The check-scale column in the log is the one the machine cannot see.';
    },

    reset: function () {
      M.reset();
      hopSlider.value = M.hopper;
      airSlider.value = M.pressure;
      coffeeSel.value = M.coffee.id;
      return 'Factory state restored: five pre-loaded recipes, scale calibrated, 12 kg in the hopper at 0.4 MPa.';
    }
  };

  Array.prototype.slice.call(document.querySelectorAll('[data-task]')).forEach(function (b) {
    b.onclick = function () {
      var msg = TASKS[b.getAttribute('data-task')]();
      M.stop();
      M.alarm = null; M.ouLamp = false;
      var hint = $('taskHint');
      hint.innerHTML = msg;
      if (b.getAttribute('data-task') === 'calibrate') addChargeControl(hint);
      window.PFUI.render();
      renderLog(); drawChart();
    };
  });

  // Only useful during the calibration exercise: a charge of exactly known mass,
  // standing in for weighing 2000 g into a bucket on a bench scale.
  function addChargeControl(host) {
    var row = document.createElement('div');
    row.className = 'btn-row';
    row.style.marginTop = '8px';
    var inp = document.createElement('input');
    inp.type = 'number'; inp.value = 2000; inp.min = 100; inp.max = 2400; inp.step = 50;
    inp.style.cssText = 'width:76px;background:#24252a;color:#fff;border:1px solid #2c2c2a;border-radius:6px;padding:5px 6px;font:500 12px system-ui';
    var btn = document.createElement('button');
    btn.className = 'mini';
    btn.textContent = 'Load known charge';
    btn.onclick = function () {
      var w = Math.max(100, Math.min(2400, +inp.value || 2000));
      M.hopper = w;
      hopSlider.value = w;
      say('Exactly ' + w + ' g is in the hopper. Press Fast on the calibration screen to move it into the chamber.');
    };
    row.appendChild(inp);
    row.appendChild(btn);
    host.parentNode.insertBefore(row, host.nextSibling);
  }

  /* ---------------- statistics tiles ---------------- */

  function tile(id, val, sub, cls) {
    var n = $(id);
    n.className = 'tile' + (cls ? ' ' + cls : '');
    n.querySelector('.val').textContent = val;
    n.querySelector('.sub').innerHTML = sub || '&nbsp;';
  }

  function renderStats() {
    var s = M.stats(WINDOW);
    if (!s) {
      tile('tMean', '—', 'no fills yet');
      tile('tSd', '—', '&nbsp;');
      tile('tRate', '—', '&nbsp;');
      $('calWarn').textContent = '';
      return;
    }
    var dev = s.mean - s.target;
    tile('tMean', s.mean.toFixed(1) + 'g',
      (dev >= 0 ? '+' : '') + dev.toFixed(1) + 'g vs target',
      Math.abs(dev) <= 1 ? 'ok' : Math.abs(dev) <= 3 ? 'warn' : 'crit');
    tile('tSd', '±' + s.sd.toFixed(1) + 'g',
      'range ' + s.range.toFixed(0) + 'g over ' + s.n,
      s.sd <= 1.5 ? 'ok' : s.sd <= 3 ? 'warn' : 'crit');
    tile('tRate', s.rate.toFixed(1), 'bags/min &middot; ' + s.cycle.toFixed(1) + 's cycle');

    // The check-scale gap: only the emulator knows this, and it is the only way to
    // see a calibration error, because the machine reads its own wrong number.
    var w = $('calWarn');
    if (Math.abs(s.calErr) > 2) {
      w.className = 'warn bad';
      w.innerHTML = 'Check scale disagrees: the machine reads <b>' + s.mean.toFixed(0) +
        ' g</b> but the true mass is <b>' + s.trueMean.toFixed(0) + ' g</b> (' +
        (s.calErr > 0 ? '+' : '') + s.calErr.toFixed(1) + ' g). Re-run 1.2 Material Clb.';
    } else if (s.bad > 0) {
      w.className = 'warn';
      w.innerHTML = s.bad + ' of the last ' + s.n + ' fills fell outside the ±' +
        M.recipe().ou.over + ' g tolerance.';
    } else {
      w.className = 'warn';
      w.textContent = '';
    }
  }

  /* ---------------- run chart ----------------
     One series (the machine's reading per bag) against its tolerance band.
     Single series, so no legend box; the title names it. Out-of-spec points get
     the status colour *and* a different shape, and are counted in words above. */

  var svg = $('chart');
  var SVGNS = 'http://www.w3.org/2000/svg';
  var PAD = { l: 34, r: 8, t: 10, b: 16 };
  var W = 352, H = 150;
  var pts = [];

  function mk(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function drawChart() {
    svg.innerHTML = '';
    pts = [];
    var rows = M.log.slice(-WINDOW);
    var note = $('chartTitle');

    if (rows.length < 2) {
      note.innerHTML = 'Run a few bags to see the spread.';
      return;
    }

    var r = M.recipe();
    var target = rows[rows.length - 1].target;
    var over = r.ou.over, under = r.ou.under;

    // y range: always show the whole tolerance band, plus any excursion
    var lo = target - under, hi = target + over;
    rows.forEach(function (d) { lo = Math.min(lo, d.weight); hi = Math.max(hi, d.weight); });
    var span = Math.max(hi - lo, 6);
    lo -= span * 0.14; hi += span * 0.14;

    var x = function (i) { return PAD.l + (W - PAD.l - PAD.r) * (rows.length === 1 ? 0.5 : i / (rows.length - 1)); };
    var y = function (v) { return PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo)); };

    // tolerance band
    svg.appendChild(mk('rect', {
      x: PAD.l, y: y(target + over), width: W - PAD.l - PAD.r,
      height: Math.max(1, y(target - under) - y(target + over)),
      fill: '#2c2c2a', opacity: '0.55'
    }));
    // band edges + target centre line
    [[target + over, '#383835', '2 2'], [target - under, '#383835', '2 2'], [target, '#898781', '']].forEach(function (g) {
      var l = mk('line', { x1: PAD.l, x2: W - PAD.r, y1: y(g[0]), y2: y(g[0]), stroke: g[1], 'stroke-width': 1 });
      if (g[2]) l.setAttribute('stroke-dasharray', g[2]);
      svg.appendChild(l);
    });

    // y labels
    [[target + over, target + over], [target, target], [target - under, target - under]].forEach(function (g) {
      svg.appendChild(mk('text', {
        x: PAD.l - 5, y: y(g[0]) + 3, fill: '#898781', 'font-size': 9, 'text-anchor': 'end'
      })).textContent = String(g[1]);
    });

    // series line
    var d = rows.map(function (row, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(row.weight).toFixed(1); }).join(' ');
    svg.appendChild(mk('path', { d: d, fill: 'none', stroke: '#3987e5', 'stroke-width': 2, 'stroke-linejoin': 'round' }));

    // points — a 2px surface ring keeps overlapping marks separable
    rows.forEach(function (row, i) {
      var cx = x(i), cy = y(row.weight);
      var bad = !row.inSpec;
      svg.appendChild(mk('circle', {
        cx: cx, cy: cy, r: bad ? 4.2 : 3.2,
        fill: bad ? '#d03b3b' : '#3987e5',
        stroke: '#1a1a19', 'stroke-width': 2
      }));
      if (bad) {
        svg.appendChild(mk('circle', {
          cx: cx, cy: cy, r: 6.4, fill: 'none', stroke: '#d03b3b', 'stroke-width': 1.5
        }));
      }
      var hit = mk('circle', { cx: cx, cy: cy, r: 11, fill: 'transparent' });
      hit.style.cursor = 'crosshair';
      pts.push({ x: cx, y: cy, row: row });
      svg.appendChild(hit);
    });

    var s = M.stats(WINDOW);
    note.innerHTML =
      '<span><i style="background:#3987e5"></i>Reading per bag</span>' +
      (s.bad ? '<span><i style="background:#d03b3b"></i>' + s.bad + ' outside tolerance</span>'
             : '<span>all within ±' + over + 'g</span>') +
      '<span>band = tolerance</span>';
  }

  svg.addEventListener('mousemove', function (e) {
    if (!pts.length) return;
    var b = svg.getBoundingClientRect();
    var sx = (e.clientX - b.left) * (W / b.width);
    var sy = (e.clientY - b.top) * (H / b.height);
    var best = null, bd = 1e9;
    pts.forEach(function (p) {
      var dd = (p.x - sx) * (p.x - sx) + (p.y - sy) * (p.y - sy);
      if (dd < bd) { bd = dd; best = p; }
    });
    if (!best || bd > 400) { tip.style.display = 'none'; return; }
    var r = best.row;
    tip.innerHTML = 'Bag ' + r.n + ' &middot; ' + r.recipe + '<br>' +
      'Reading <b>' + r.weight + ' g</b> (' + (r.dev >= 0 ? '+' : '') + r.dev + ')<br>' +
      (Math.abs(r.calErr) > 2 ? 'Check scale <b>' + r.trueWeight.toFixed(0) + ' g</b><br>' : '') +
      'Med ' + r.med + ' &middot; Slow ' + r.slow + ' &middot; ' + r.cycle.toFixed(1) + 's';
    tip.style.display = 'block';
    tip.style.left = Math.min(window.innerWidth - 230, e.clientX + 12) + 'px';
    tip.style.top = (e.clientY - 10) + 'px';
  });
  svg.addEventListener('mouseleave', function () { tip.style.display = 'none'; });

  /* ---------------- fill log table ---------------- */

  function renderLog() {
    var body = $('logBody');
    var rows = M.log.slice(-60).reverse();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#898781">No fills yet</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      var showTrue = Math.abs(r.calErr) > 2;
      return '<tr class="' + (r.inSpec ? '' : 'out') + '">' +
        '<td>' + r.n + '</td>' +
        '<td>' + r.recipe + '</td>' +
        '<td>' + r.weight + (showTrue ? ' <span style="color:#fab219">(' + r.trueWeight.toFixed(0) + ')</span>' : '') + '</td>' +
        '<td>' + (r.dev >= 0 ? '+' : '') + r.dev + '</td>' +
        '<td>' + r.cycle.toFixed(1) + 's</td>' +
        '</tr>';
    }).join('');
  }

  /* ---------------- per-frame ---------------- */

  var lastCount = -1, lastNotice = '';

  function tick() {
    $('hopV').textContent = (M.hopper / 1000).toFixed(1) + ' kg';
    $('airV').textContent = M.pressure.toFixed(2) + ' MPa';
    if (+hopSlider.value !== Math.round(M.hopper / 100) * 100) hopSlider.value = M.hopper;

    var p = $('pedal');
    var ready = M.state === 'WAIT_CLAMP';
    p.disabled = false;
    p.classList.toggle('down', ready && (Math.floor(Date.now() / 500) % 2 === 0) ? false : p.classList.contains('down'));
    p.firstChild.textContent = ready ? 'DISCHARGE — READY' : 'DISCHARGE';

    // rig-side warnings
    var w = [];
    if (M.hopper <= 0) w.push('Hopper is empty.');
    else if (M.hopper < 800) w.push('Hopper is low — flow falls off and fills run light.');
    if (M.pressure < 0.3) w.push('Air below 0.3 MPa: the gate will not seat and coffee trickles past cutoff. The manual requires 0.4 MPa.');
    else if (M.pressure > 0.46) w.push('Air above spec — the gate slams and overshoots.');
    var n = window.PFUI.notice();
    var warnEl = $('rigWarn');
    var txt = (n ? n + ' ' : '') + w.join(' ');
    if (txt !== lastNotice) { warnEl.innerHTML = txt; lastNotice = txt; }
    warnEl.className = 'warn' + (M.hopper <= 0 || M.pressure < 0.25 ? ' bad' : '');

    if (M.log.length !== lastCount) {
      lastCount = M.log.length;
      renderStats();
      drawChart();
      renderLog();
      window.PFUI.render();
    }
  }

  renderStats(); drawChart(); renderLog();
  window.PFRig = { tick: tick, drawChart: drawChart };
})();
