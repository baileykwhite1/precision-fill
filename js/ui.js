/* Precision Fill emulator — HMI screens and interaction.
 * Depends on sim.js (window.PFSim). Exposes window.PFUI for rig.js. */
(function () {
  'use strict';

  var M = new PFSim.Machine(Date.now() & 0xffff);
  var hmi = document.getElementById('hmi');
  var pop = document.getElementById('pop');

  var view = { screen: 'home', stack: [], params: null, tab: 0, calTab: 0 };
  var notice = '';   // transient hint shown in the rig panel

  /* ---------------- tiny DOM helpers ---------------- */

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function $(id) { return document.getElementById(id); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function say(msg) { notice = msg; noticeUntil = Date.now() + 4000; }
  var noticeUntil = 0;

  /* ---------------- navigation ---------------- */

  function show(name, push) {
    if (push && view.screen !== name) view.stack.push(view.screen);
    // leaving a screen that drives the actuators by hand
    if ((view.screen === 'manual' || view.screen === 'cal') && name !== 'manual' && name !== 'cal') {
      M.manualMode = false;
      M.man.fast = M.man.med = M.man.slow = M.man.clamp = false;
    }
    view.screen = name;
    all('.screen').forEach(function (s) {
      s.classList.toggle('on', s.getAttribute('data-screen') === name);
    });
    if (name === 'manual' || name === 'cal') M.manualMode = true;
    render();
  }

  function goBack() {
    var prev = view.stack.pop() || 'home';
    show(prev, false);
  }

  function goHome() { view.stack.length = 0; show('home', false); }

  /* ---------------- popups ---------------- */

  function closePop() { pop.classList.remove('on'); pop.innerHTML = ''; }

  // Numeric entry, styled after the firmware's keypad.
  function keypad(opts) {
    var buf = '';
    var box = el('div', 'keypad');
    var head = el('div', 'kp-title');
    head.appendChild(el('span', null, opts.title || ''));
    head.appendChild(el('span', null, opts.range || ''));
    var disp = el('div', 'kp-disp', opts.mask ? '' : String(opts.value == null ? '' : opts.value));
    if (opts.value != null && !opts.mask) buf = String(opts.value);
    var grid = el('div', 'kp-grid');
    box.appendChild(head); box.appendChild(disp); box.appendChild(grid);

    function paint() { disp.textContent = opts.mask ? buf.replace(/./g, '*') : buf; }

    function key(label, cls, fn) {
      var b = el('button', 'kbtn' + (cls ? ' ' + cls : ''), label);
      b.onclick = function (e) { e.stopPropagation(); fn(); };
      return b;
    }
    function digit(d) {
      return key(d, null, function () {
        if (buf.length < 9) { buf += d; paint(); }
      });
    }

    var layout = [
      ['1', '2', '3', { l: '←', c: 'fn', f: function () { buf = buf.slice(0, -1); paint(); } }],
      ['4', '5', '6', { l: 'Clear', c: 'fn', f: function () { buf = ''; paint(); } }],
      ['7', '8', '9', { l: 'Back', c: 'fn', f: function () { closePop(); } }],
      ['-', '0', '.', { l: 'OK', c: 'fn ok', f: function () {
        var v = parseFloat(buf);
        if (opts.mask) { closePop(); opts.done(buf); return; }
        if (isNaN(v)) { closePop(); return; }
        if (opts.min != null && v < opts.min) v = opts.min;
        if (opts.max != null && v > opts.max) v = opts.max;
        if (opts.step === 1) v = Math.round(v);
        closePop(); opts.done(v);
      } }]
    ];
    layout.forEach(function (row) {
      row.forEach(function (k) {
        grid.appendChild(typeof k === 'string' ? digit(k) : key(k.l, k.c, k.f));
      });
    });

    paint();
    pop.innerHTML = '';
    pop.appendChild(box);
    pop.classList.add('on');
  }

  // Alphanumeric entry for the recipe name.
  function textpad(opts) {
    var buf = String(opts.value || '');
    var box = el('div', 'kbd');
    var head = el('div', 'kp-title');
    head.appendChild(el('span', null, opts.title || 'Recipe Name'));
    head.appendChild(el('span', null, 'English'));
    var disp = el('div', 'kp-disp', buf);
    var rows = el('div', 'kbd-rows');
    box.appendChild(head); box.appendChild(disp); box.appendChild(rows);

    function paint() { disp.textContent = buf; }
    function key(label, cls, fn, w2) {
      var b = el('button', 'kbtn' + (cls ? ' ' + cls : '') + (w2 ? ' w2' : ''), label);
      b.onclick = function (e) { e.stopPropagation(); fn(); };
      return b;
    }
    function chars(str) {
      var r = el('div');
      str.split('').forEach(function (c) {
        r.appendChild(key(c, null, function () {
          if (buf.length < 12) { buf += c; paint(); }
        }));
      });
      return r;
    }
    rows.appendChild(chars('1234567890'));
    rows.appendChild(chars('QWERTYUIOP'));
    rows.appendChild(chars('ASDFGHJKL'));
    rows.appendChild(chars('ZXCVBNM'));
    var last = el('div');
    last.appendChild(key('space', null, function () { if (buf.length < 12) { buf += ' '; paint(); } }, true));
    last.appendChild(key('←', 'fn', function () { buf = buf.slice(0, -1); paint(); }));
    last.appendChild(key('Clear', 'fn', function () { buf = ''; paint(); }));
    last.appendChild(key('Back', 'fn', function () { closePop(); }));
    last.appendChild(key('OK', 'fn ok', function () { closePop(); opts.done(buf.trim()); }));
    rows.appendChild(last);

    pop.innerHTML = '';
    pop.appendChild(box);
    pop.classList.add('on');
  }

  // The recipe dropdown from the home screen.
  function recipeList() {
    var box = el('div', 'reclist');
    var scroll = el('div', 'scroll');
    M.recipes.forEach(function (r) {
      if (!r.enabled) return;
      var b = el('button', 'recbtn' + (r.n === M.sel ? ' sel' : ''));
      b.appendChild(el('div', null, 'Rec ' + r.n));
      b.appendChild(el('small', null, r.name || (r.target + 'g')));
      b.onclick = function () {
        if (M.running) { say('Stop the machine before changing recipe.'); closePop(); return; }
        M.sel = r.n; closePop(); render();
      };
      scroll.appendChild(b);
    });
    box.appendChild(scroll);
    var back = el('button', 'recbtn sel', 'Back');
    back.onclick = closePop;
    box.appendChild(back);
    pop.innerHTML = '';
    pop.appendChild(box);
    pop.classList.add('on');
  }

  function askPassword(then) {
    keypad({
      title: 'Password:System Setting', mask: true,
      done: function (v) {
        if (v === M.password || (M.password === '0' && v === '000000')) then();
        else say('Password incorrect. Default is 0.');
      }
    });
  }

  /* ---------------- parameter screen definitions ---------------- */

  var FEED_SPEED = { 3: '③Three Speed', 2: '②Med/Slow', 1: '①Fast/Slow' };

  function R() { return M.recipe(); }

  function numRow(code, label, unit, get, set, min, max, step) {
    return {
      code: code, label: label, unit: unit, type: 'num',
      get: get, set: set, min: min, max: max, step: step == null ? 1 : step
    };
  }

  var SCREENS = {
    shortcut: {
      title: 'Shortcut',
      tabs: [{ code: '', label: 'Shortcut1', cols: [
        [
          numRow('4.2.1', 'Target', 'g', function () { return R().target; }, function (v) { R().target = v; }, 0, 2500),
          numRow('4.2.2', 'Fast Feed', 'g', function () { return R().fast; }, function (v) { R().fast = v; }, 0, 2500),
          numRow('4.2.3', 'Med Feed', 'g', function () { return R().med; }, function (v) { R().med = v; }, 0, 2500),
          numRow('4.2.4', 'Slow Feed', 'g', function () { return R().slow; }, function (v) { R().slow = v; }, 0, 2500)
        ],
        [
          { code: '5.1.1', label: 'AI Pack', type: 'toggle',
            get: function () { return R().aiPack; },
            set: function (v) { R().aiPack = v; if (v) say('AI Pack modifies the feed values — note them first.'); } },
          { code: '4.2.10', label: 'Feed Speed', type: 'enum',
            get: function () { return FEED_SPEED[R().feedSpeed]; },
            next: function () { var o = [3, 2, 1]; R().feedSpeed = o[(o.indexOf(R().feedSpeed) + 1) % 3]; } },
          numRow('4.2.5', 'Discharge\nZero Area', 'g', function () { return R().dischargeZero; }, function (v) { R().dischargeZero = v; }, 0, 500)
        ]
      ] }]
    },

    recipe: {
      title: '4.Recipe Setting',
      tabs: [
        { code: '4.1', label: 'Recipe', single: true, rows: [
          numRow('4.1.1', 'Seleted Recipe', '', function () { return M.sel; },
            function (v) { if (v >= 1 && v <= 20) M.sel = v; }, 1, 20),
          { code: '4.1.2', label: 'Enable Choose', type: 'toggle',
            get: function () { return R().enabled; }, set: function (v) { R().enabled = v; } },
          { code: '4.1.3', label: 'Recipe\nName', type: 'text',
            get: function () { return R().name; }, set: function (v) { R().name = v; } }
        ] },
        { code: '4.2', label: 'Target', single: true, rows: [
          numRow('4.2.1', 'Target', 'g', function () { return R().target; }, function (v) { R().target = v; }, 0, 2500),
          numRow('4.2.2', 'Fast Feed', 'g', function () { return R().fast; }, function (v) { R().fast = v; }, 0, 2500),
          numRow('4.2.3', 'Med Feed', 'g', function () { return R().med; }, function (v) { R().med = v; }, 0, 2500),
          numRow('4.2.4', 'Slow Feed', 'g', function () { return R().slow; }, function (v) { R().slow = v; }, 0, 2500),
          numRow('4.2.5', 'Discharge\nZero Area', 'g', function () { return R().dischargeZero; }, function (v) { R().dischargeZero = v; }, 0, 500),
          { code: '4.2.10', label: 'Feed Speed', type: 'enum',
            get: function () { return FEED_SPEED[R().feedSpeed]; },
            next: function () { var o = [3, 2, 1]; R().feedSpeed = o[(o.indexOf(R().feedSpeed) + 1) % 3]; } }
        ] },
        { code: '4.3', label: 'Time Set', single: true, rows: [
          numRow('4.3.1', 'Feed Delay Time', 's', function () { return R().times.feedDelay; }, function (v) { R().times.feedDelay = v; }, 0, 20, 0.1),
          numRow('4.3.2', 'Stabilisation\nTime', 's', function () { return R().times.stab; }, function (v) { R().times.stab = v; }, 0, 20, 0.1),
          numRow('4.3.3', 'Discharge\nDelay Time', 's', function () { return R().times.dischargeDelay; }, function (v) { R().times.dischargeDelay = v; }, 0, 20, 0.1),
          numRow('4.3.4', 'Clamp Delay Time', 's', function () { return R().times.clampDelay; }, function (v) { R().times.clampDelay = v; }, 0, 20, 0.1),
          numRow('4.3.5', 'Unclamp\nDelay Time', 's', function () { return R().times.unclampDelay; }, function (v) { R().times.unclampDelay = v; }, 0, 20, 0.1),
          numRow('4.3.6', 'End Unclamp\nDelay Time', 's', function () { return R().times.endUnclampDelay; }, function (v) { R().times.endUnclampDelay = v; }, 0, 20, 0.1)
        ] },
        { code: '4.4', label: 'Flapping', stub: 'Not used in this machine configuration. The manual advises leaving Flapping, Valve Set and Feed Analog alone.' },
        { code: '4.5', label: 'Over/Under', single: true, rows: [
          { code: '4.5.1', label: 'Over/Under Func', type: 'toggle',
            get: function () { return R().ou.func; }, set: function (v) { R().ou.func = v; } },
          numRow('4.5.2', 'Check Delay Time', 's', function () { return R().ou.checkDelay; }, function (v) { R().ou.checkDelay = v; }, 0, 20, 0.1),
          numRow('4.5.3', 'Over Tolerance', 'g', function () { return R().ou.over; }, function (v) { R().ou.over = v; }, 0, 500),
          numRow('4.5.4', 'Under Tolerance', 'g', function () { return R().ou.under; }, function (v) { R().ou.under = v; }, 0, 500),
          { code: '4.5.5', label: 'Over/Under Pause', type: 'toggle',
            get: function () { return R().ou.pause; }, set: function (v) { R().ou.pause = v; } },
          numRow('4.5.6', 'Over/Under\nInterval', '', function () { return R().ou.interval; }, function (v) { R().ou.interval = v; }, 0, 99)
        ] },
        { code: '4.6', label: 'Valve Set', stub: 'Not used in this machine configuration.' },
        { code: '4.7', label: 'Feed Analog', stub: 'Not used in this machine configuration.' }
      ]
    },

    acc: {
      title: '7.Acc Data',
      tabs: [{ code: '7.1', label: 'Acc Data', single: true, rows: [
        numRow('7.1.1', 'Batch Set', '', function () { return M.batchSet; },
          function (v) { M.batchSet = v; M.complete = 0; }, 0, 9999),
        { code: '7.1.2', label: 'Acc. Nums', type: 'ro', get: function () { return M.accNums; } },
        { code: '7.1.3', label: 'Acc. Wt', unit: 'g', type: 'ro', get: function () { return Math.round(M.accWt); } },
        { code: '7.1.4', label: 'Clear Acc Data', type: 'action', act: 'Clear',
          run: function () { M.accNums = 0; M.accWt = 0; M.complete = 0; say('Accumulated data cleared.'); } },
        { note: 'Batch Set at 0 disables the batch function. Above 0 the machine stops when Complete reaches it, and needs Clr Alarm to resume.' }
      ] }]
    },

    ai: {
      title: '5.AI Packing',
      tabs: [{ code: '5.1', label: 'AI Packing', single: true, rows: [
        { code: '5.1.1', label: 'AI Pack', type: 'toggle',
          get: function () { return R().aiPack; }, set: function (v) { R().aiPack = v; } },
        { note: 'Intelligent packing adjusts the feed values on the fly. Write your Fast, Medium and Slow values down before switching it on — it will overwrite them.' }
      ] }]
    },

    password: {
      title: '12.Password',
      tabs: [{ code: '12.1', label: 'Password', single: true, rows: [
        { code: '12.1.13', label: 'Password', type: 'action', act: 'Set',
          run: function () {
            keypad({ title: 'New password', mask: true, done: function (a) {
              keypad({ title: 'Confirm password', mask: true, done: function (b) {
                if (a === b && a !== '') { M.password = a; say('Password changed.'); }
                else say('Passwords did not match — unchanged.');
              } });
            } });
          } }
      ] }]
    }
  };

  var MENU = [
    { n: 1, label: 'Calibration', go: function () { view.calTab = 0; show('cal', true); } },
    { n: 2, label: 'Weighing\nParameters' },
    { n: 3, label: 'Scale\nParameters' },
    { n: 4, label: 'Recipe\nSetting', go: function () { openParams('recipe', 0); } },
    { n: 5, label: 'AI Packing', go: function () { openParams('ai', 0); } },
    { n: 6, label: 'I/O' },
    { n: 7, label: 'Acc Data', go: function () { openParams('acc', 0); } },
    { n: 8, label: 'Comm\nSetting' },
    { n: 9, label: 'Analog' },
    { n: 10, label: 'Logic' },
    { n: 11, label: 'Shortcut\nSetting' },
    { n: 12, label: 'Password', go: function () { openParams('password', 0); } },
    { n: 13, label: 'System' }
  ];

  function openParams(key, tab) {
    view.params = key;
    view.tab = tab || 0;
    show('params', true);
  }

  /* ---------------- renderers ---------------- */

  function buildMenu() {
    var g = $('menuGrid');
    g.innerHTML = '';
    MENU.forEach(function (m) {
      var b = el('button', 'mtile' + (m.go ? '' : ' dim'));
      b.appendChild(el('span', 'code', String(m.n)));
      b.appendChild(el('span', null, m.label.replace(/\n/g, ' ')));
      if (m.go) b.onclick = m.go;
      else b.onclick = function () { say(m.label.replace(/\n/g, ' ') + ' is not implemented in the emulator.'); };
      g.appendChild(b);
    });
    var foot = el('div', 'menu-foot');
    foot.appendChild(el('span', null, 'AMC501-U-920B1-34'));
    var lang = el('button', 'lang', '简体中文');
    lang.onclick = function () { say('Only English is implemented in the emulator.'); };
    foot.appendChild(lang);
    g.appendChild(foot);
  }

  function rowNode(r) {
    if (r.note) {
      return el('div', 'note', r.note);
    }
    var node = el('div', 'prow' + (r.type === 'enum' ? ' enum' : ''));
    node.appendChild(el('span', 'code', r.code || ''));
    var lbl = el('span', 'lbl');
    String(r.label).split('\n').forEach(function (line, i) {
      if (i) lbl.appendChild(document.createElement('br'));
      lbl.appendChild(document.createTextNode(line));
    });
    node.appendChild(lbl);

    var v;
    if (r.type === 'toggle') {
      v = el('button', 'pval toggle' + (r.get() ? '' : ' off'), r.get() ? 'ON' : 'OFF');
      v.onclick = function () { r.set(!r.get()); render(); };
    } else if (r.type === 'enum') {
      // short values sit centred; only long ones need left alignment to fit
      var txt = String(r.get());
      v = el('button', 'pval' + (txt.length > 6 ? ' enum' : ''), txt);
      v.onclick = function () { r.next(); render(); };
    } else if (r.type === 'text') {
      v = el('button', 'pval', r.get() || '—');
      v.onclick = function () {
        textpad({
          title: r.label.replace(/\n/g, ' '), value: r.get(),
          done: function (s) { r.set(s); render(); }
        });
      };
    } else if (r.type === 'ro') {
      v = el('div', 'pval', String(r.get()));
    } else if (r.type === 'action') {
      v = el('button', 'pval toggle', r.act);
      v.onclick = r.run;
    } else {
      var cur = r.get();
      v = el('button', 'pval', fmtNum(cur, r.step));
      v.onclick = function () {
        keypad({
          title: r.label.replace(/\n/g, ' '),
          range: (r.min != null && r.max != null) ? r.min + '~' + r.max : '',
          value: fmtNum(r.get(), r.step),
          min: r.min, max: r.max, step: r.step,
          done: function (val) { r.set(val); render(); }
        });
      };
    }
    node.appendChild(v);
    node.appendChild(el('span', 'unit', r.unit || ''));
    return node;
  }

  function fmtNum(v, step) {
    if (step && step < 1) return Number(v).toFixed(1);
    return String(Math.round(v));
  }

  function renderParams() {
    var spec = SCREENS[view.params];
    if (!spec) return;
    $('pTitle').textContent = spec.title;
    var tabsEl = $('pTabs');
    tabsEl.innerHTML = '';
    spec.tabs.forEach(function (t, i) {
      var b = el('button', 'tab' + (i === view.tab ? ' active' : '') + (t.stub ? ' dim' : ''));
      if (t.code) b.appendChild(el('span', 'code', t.code));
      b.appendChild(el('span', null, t.label));
      b.onclick = function () { view.tab = i; render(); };
      tabsEl.appendChild(b);
    });
    if (spec.tabs.length === 1 && !spec.tabs[0].code) {
      tabsEl.firstChild.classList.add('active');
    }

    var t = spec.tabs[view.tab];
    var rowsEl = $('pRows');
    rowsEl.innerHTML = '';
    rowsEl.className = 'rows' + (t.single || t.stub ? ' single' : '');

    if (t.stub) {
      rowsEl.appendChild(el('div', 'note', t.stub));
      return;
    }
    if (t.cols) {
      rowsEl.className = 'rows';
      t.cols.forEach(function (col) {
        var stack = el('div', 'colstack');
        col.forEach(function (r) { stack.appendChild(rowNode(r)); });
        rowsEl.appendChild(stack);
      });
      return;
    }
    t.rows.forEach(function (r) { rowsEl.appendChild(rowNode(r)); });
  }

  /* ---------------- calibration screen ---------------- */

  var CAL_TABS = [
    { code: '1.1', label: 'Wt Clb' },
    { code: '1.2', label: 'Material\nClb' },
    { code: '1.3', label: 'No Wt Clb' }
  ];

  function renderCal() {
    var tabsEl = $('calTabs');
    tabsEl.innerHTML = '';
    CAL_TABS.forEach(function (t, i) {
      var b = el('button', 'tab' + (i === view.calTab ? ' active' : ''));
      b.appendChild(el('span', 'code', t.code));
      var s = el('span');
      t.label.split('\n').forEach(function (line, k) {
        if (k) s.appendChild(document.createElement('br'));
        s.appendChild(document.createTextNode(line));
      });
      b.appendChild(s);
      b.onclick = function () { view.calTab = i; render(); };
      tabsEl.appendChild(b);
    });

    var main = $('calMain');
    main.innerHTML = '';

    if (view.calTab === 2) {
      main.appendChild(el('div', 'note',
        'No-weight calibration is a factory procedure and is not implemented. Use 1.2 Material Clb, which is the procedure in the manual.'));
      return;
    }

    if (view.calTab === 0) {
      // 1.1 Wt Clb — scale settings beside the live weight card
      var wrap = el('div', 'cal-wt');
      var rows = el('div', 'rows single');
      [
        { code: '1.1.1', label: 'Unit', type: 'enum',
          get: function () { return M.unit; },
          next: function () { var o = ['g', 'kg', 'oz', 'lb']; M.unit = o[(o.indexOf(M.unit) + 1) % 4]; } },
        { code: '1.1.2', label: 'Accuracy', type: 'enum',
          get: function () { return String(M.accuracy); },
          next: function () { M.accuracy = (M.accuracy + 1) % 3; } },
        { code: '1.1.3', label: 'Division Value', type: 'enum',
          get: function () { return String(M.division); },
          next: function () { var o = [1, 2, 5, 10]; M.division = o[(o.indexOf(M.division) + 1) % 4]; } },
        numRow('1.1.4', 'Capacity', 'g', function () { return M.capacity; },
          function (v) { M.capacity = v; say('Capacity changed — the manual says do not edit this.'); }, 100, 5000)
      ].forEach(function (r) { rows.appendChild(rowNode(r)); });
      wrap.appendChild(rows);

      var card = el('div', 'cal-card');
      card.appendChild(el('div', 'cal-title', 'Weight'));
      card.appendChild(calLcd());
      card.appendChild(volt('calV1', 'Sensor Voltage:'));
      card.appendChild(volt('calV2', 'Gain Voltage:'));
      var z = el('button', 'obtn', 'Zero Clb');
      z.onclick = function () {
        say(M.zeroClb() ? 'Zero calibration stored.' : 'Wait for the STAB lamp before zeroing.');
      };
      card.appendChild(z);
      var gn = el('button', 'obtn', 'Gain Clb');
      gn.onclick = function () { say('Gain Clb is a factory function — use 1.2 Material Clb.'); };
      card.appendChild(gn);

      wrap.appendChild(card);
      main.appendChild(wrap);
      return;
    }

    // 1.2 Material Clb — the procedure from the manual
    var grid = el('div', 'cal-mat');
    var card2 = el('div', 'cal-card');
    card2.appendChild(calLcd());
    card2.appendChild(volt('calV1', 'Sensor Voltage:'));
    card2.appendChild(volt('calV2', 'Gain Voltage:'));

    var btns = el('div', 'cal-btns');

    var zc = el('button', 'obtn', 'Zero Clb');
    zc.onclick = function () {
      if (M.zeroClb()) say('Zero stored. Now load a known weight and press Record Wt.');
      else say('Wait for the reading to settle (STAB) before Zero Clb.');
    };
    var rw = el('button', 'obtn', 'Record Wt');
    rw.onclick = function () {
      if (!M.stable()) { say('Wait for the reading to settle before Record Wt.'); return; }
      M.recordWt();
      say('Raw span captured. Type the true weight into Clb Wt, then press Wt Clb.');
    };

    var clbRow = el('div', 'cal-clbwt');
    clbRow.appendChild(el('span', null, 'Clb Wt'));
    var cw = el('button', 'pval', String(M.clbWt));
    cw.onclick = function () {
      keypad({ title: 'Clb Wt', range: '0~5000', value: M.clbWt, min: 0, max: 5000,
        done: function (v) { M.clbWt = v; render(); } });
    };
    clbRow.appendChild(cw);

    var wc = el('button', 'obtn', 'Wt Clb');
    wc.onclick = function () {
      if (M.recordedRaw == null) { say('Press Record Wt first.'); return; }
      if (!(M.clbWt > 0)) { say('Enter the true weight in Clb Wt first.'); return; }
      if (M.wtClb()) say('Span calibrated. The readout should now show ' + M.clbWt + ' g.');
      else say('Calibration rejected — check the Clb Wt value.');
      render();
    };

    btns.appendChild(zc);
    btns.appendChild(rw);
    btns.appendChild(clbRow);
    btns.appendChild(wc);
    card2.appendChild(btns);
    grid.appendChild(card2);

    // the Fast / Med / Slow / Discharge column, as on the real screen
    var side = el('div', 'cal-side');
    [['fast', 'Fast'], ['med', 'Med'], ['slow', 'Slow']].forEach(function (p) {
      var b = el('button', 'obtn' + (M.man[p[0]] ? ' on' : ''), p[1]);
      b.onclick = function () { M.man[p[0]] = !M.man[p[0]]; render(); };
      side.appendChild(b);
    });
    side.appendChild(el('div', 'gap'));
    var db = el('button', 'obtn' + (M.man.disc ? ' on' : ''), 'Discharge');
    db.onclick = function () { M.man.disc = !M.man.disc; render(); };
    side.appendChild(db);

    grid.appendChild(side);
    main.appendChild(grid);
  }

  function calLcd() {
    var d = el('div', 'cal-lcd');
    d.id = 'calLcd';
    var w = el('span'); w.id = 'calW'; w.textContent = '0';
    d.appendChild(w);
    d.appendChild(el('span', 'u', 'g'));
    return d;
  }


  function volt(id, label) {
    var d = el('div', 'cal-v');
    d.appendChild(el('span', null, label));
    var b = el('b'); b.id = id; b.textContent = '—';
    d.appendChild(b);
    return d;
  }

  /* ---------------- IO squares ---------------- */

  function ioSquares() {
    [['ioIn1', 4], ['ioIn2', 3], ['ioOut1', 4], ['ioOut2', 4], ['ioOut3', 4]].forEach(function (g) {
      var host = $(g[0]);
      if (!host || host.childElementCount) return;
      for (var i = 0; i < g[1]; i++) host.appendChild(el('i'));
    });
  }

  /* ---------------- live render ---------------- */

  function render() {
    var r = M.recipe();

    // readout, on every screen that has one
    var disp = M.display();
    all('.js-w').forEach(function (n) { n.textContent = disp; });
    all('.js-u').forEach(function (n) { n.textContent = M.isOverload() ? '' : M.unit; });
    all('.js-lcd').forEach(function (n) { n.classList.toggle('ofl', disp === 'OFL'); });
    all('.js-op').forEach(function (n) { n.textContent = M.operationText(); });

    var lampState = {
      run: M.running, fast: M.fastOn, med: M.medOn, slow: M.slowOn,
      ou: M.ouLamp, hold: M.holdOn, disc: M.discOn, clamp: M.clampOn
    };
    all('.js-lamps span').forEach(function (n) {
      n.classList.toggle('on', !!lampState[n.getAttribute('data-lamp')]);
    });
    var st = { stab: M.stable(), zero: M.atZero(), net: false, sstop: false };
    all('.js-status div').forEach(function (n) {
      n.classList.toggle('on', !!st[n.getAttribute('data-st')]);
    });

    renderHome();
    if (view.screen === 'params') renderParams();
    if (view.screen === 'cal') renderCal();
    if (view.screen === 'manual') {
      all('[data-man]').forEach(function (b) {
        var k = b.getAttribute('data-man');
        var lit = k === 'slowstop' ? false
          : k === 'clamp' ? !!M.mdState
          : !!M.man[k];
        b.classList.toggle('on', lit);
      });
    }
    $('bezelState').textContent = 'AMC501-U · ' + M.operationText();
  }

  // Cheap text updates, safe to run every frame.
  function renderHome() {
    var r = M.recipe();
    var pad = ('0' + r.n).slice(-2);
    $('fRecipe').textContent = '(' + pad + ')' + (r.name || r.target + 'g');
    $('fTarget').textContent = r.target;
    $('fBatch').textContent = M.batchSet;
    $('fComplete').textContent = M.complete;
    var warnEl = $('fWarn');
    warnEl.textContent = M.alarm ? M.alarm.text : 'No warning';
    warnEl.classList.toggle('alarm', !!M.alarm);
    $('fAccN').textContent = M.accNums;
    $('fAccW').textContent = Math.round(M.accWt);
    $('fComb').textContent = M.combine;
    $('fMode').textContent = '②Hopper';
    document.querySelector('[data-act="clralarm"]').classList.toggle('alarmkey', !!M.alarm);
    $('fStart').textContent = M.running ? 'Stop' : 'Start';
    var sk = document.querySelector('[data-act="startstop"]');
    sk.classList.toggle('grey', !M.running);
    sk.classList.toggle('armed', M.running);
    $('fClock').textContent = clock();
  }

  // Two different repaint rates, because they are two different kinds of number.
  // The weight is counting up during a fill and must look live and smooth, so it
  // repaints every frame. The mV readings barely move and only ever needed
  // slowing down, so they repaint a few times a second.
  var VOLT_MS = 220;
  var lastVolt = 0;
  var lastW = null;

  function paintWeight() {
    var disp = M.display();
    if (disp === lastW) return;          // skip DOM writes when nothing changed
    lastW = disp;
    all('.js-w').forEach(function (n) { n.textContent = disp; });
    var calW = $('calW');
    if (calW) calW.textContent = disp;
  }

  function paintVolts() {
    var v1 = $('calV1'), v2 = $('calV2');
    if (v1) v1.textContent = M.sensorVoltage().toFixed(3) + ' mV';
    if (v2) v2.textContent = M.gainVoltage().toFixed(3) + ' mV';
  }

  function renderFast(now) {
    paintWeight();
    renderHome();
    if (now - lastVolt >= VOLT_MS) { lastVolt = now; paintVolts(); }

    // lamps are booleans and now latch properly, so they can track every frame
    all('.js-op').forEach(function (n) { n.textContent = M.operationText(); });
    var lampState = {
      run: M.running, fast: M.fastOn, med: M.medOn, slow: M.slowOn,
      ou: M.ouLamp, hold: M.holdOn, disc: M.discOn, clamp: M.clampOn
    };
    all('.js-lamps span').forEach(function (n) {
      var k = n.getAttribute('data-lamp');
      n.classList.toggle('on', !!lampState[k]);
      // an alarm lamp is red, not green — it is a fault, not a state
      if (k === 'ou') n.classList.toggle('alarm', !!M.ouLamp);
    });
    var st = { stab: M.stable(), zero: M.atZero(), net: false, sstop: false };
    all('.js-status div').forEach(function (n) {
      n.classList.toggle('on', !!st[n.getAttribute('data-st')]);
    });
    document.getElementById('bezelState').classList.toggle('alarm', !!M.alarm);

    if (view.screen === 'manual') {
      all('[data-man]').forEach(function (b) {
        var k = b.getAttribute('data-man');
        var lit = k === 'slowstop' ? false
          : k === 'clamp' ? !!M.mdState
          : !!M.man[k];
        b.classList.toggle('on', lit);
      });
      var out = [M.fastOn, M.medOn, M.slowOn, M.discOn, M.clampOn, M.running, M.holdOn, M.ouLamp,
                 false, false, false, false];
      var sq = [];
      ['ioOut1', 'ioOut2', 'ioOut3'].forEach(function (id) {
        Array.prototype.push.apply(sq, Array.prototype.slice.call($(id).children));
      });
      sq.forEach(function (n, i) { n.classList.toggle('on', !!out[i]); });
      var ins = [M.pedal, M.hopper > 0, M.pressure > 0.2, M.stable(), false, false, false];
      var isq = [];
      ['ioIn1', 'ioIn2'].forEach(function (id) {
        Array.prototype.push.apply(isq, Array.prototype.slice.call($(id).children));
      });
      isq.forEach(function (n, i) { n.classList.toggle('on', !!ins[i]); });
    }
  }

  function clock() {
    var d = new Date();
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var p = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      '(' + days[d.getDay()] + ')' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------------- actions ---------------- */

  var ACT = {
    home: goHome,
    back: goBack,
    settings: function () { askPassword(function () { show('settings', true); }); },
    shortcut: function () { openParams('shortcut', 0); },
    clralarm: function () { M.clearAlarm(); render(); },
    zero: function () {
      if (M.zero()) say('Scale zeroed.');
      else say('Cannot zero — wait for the STAB lamp.');
      render();
    },
    discharge: function () {
      if (M.running) { say('Stop the machine before using Discharge.'); return; }
      M.man.disc = !M.man.disc;
      say(M.man.disc ? 'Discharge gate open — press again to close.' : 'Discharge gate closed.');
      render();
    },
    manual: function () { show('manual', true); },
    startstop: function () {
      if (M.running) M.stop();
      else {
        if (M.alarm) { say('Clear the alarm first (Clr Alarm).'); return; }
        if (M.hopper <= 0) { say('Hopper is empty — refill before starting.'); return; }
        M.man.disc = false;
        M.start();
      }
      render();
    }
  };

  hmi.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (t && ACT[t.getAttribute('data-act')]) { ACT[t.getAttribute('data-act')](); return; }
    var mb = e.target.closest('[data-man]');
    if (mb) {
      var k = mb.getAttribute('data-man');
      if (k === 'slowstop') { M.man.slow = false; render(); return; }
      // Clamp simulates the foot pedal, so it fires the discharge sequence
      if (k === 'clamp') { M.pressPedal(); render(); return; }
      M.man[k] = !M.man[k];
      render();
      return;
    }
  });

  pop.addEventListener('click', function (e) { if (e.target === pop) closePop(); });
  $('fRecipe').onclick = recipeList;
  $('fWarn').onclick = function () { M.clearAlarm(); render(); };

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'Escape') { closePop(); return; }

    if (e.code === 'Space') {
      e.preventDefault();
      if (e.repeat) return;              // holding the key is one press, not many
      M.pressPedal();
      $('pedal').classList.add('down');
      return;
    }
    // letter shortcuts must not fire while a keypad or list is open, or they
    // start the machine while someone is typing a value
    if (pop.classList.contains('on') || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;

    var k = e.key.toLowerCase();
    if (k === 's') ACT.startstop();
    else if (k === 'h') goHome();
    else if (k === 'c') ACT.clralarm();
  });
  document.addEventListener('keyup', function (e) {
    if (e.code === 'Space') $('pedal').classList.remove('down');
  });

  /* ---------------- loop ---------------- */

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // Re-arm unconditionally: a throw in here used to kill the loop for good,
    // which looks exactly like the machine seizing up.
    try {
      M.tick(dt);
      renderFast(now);
      if (window.PFRig) window.PFRig.tick();
    } catch (err) {
      if (!frame.warned) { frame.warned = true; console.error('render/tick error', err); }
    }
    requestAnimationFrame(frame);
  }

  buildMenu();
  ioSquares();
  render();
  requestAnimationFrame(frame);

  window.PFUI = {
    M: M,
    render: render,
    say: say,
    notice: function () { return Date.now() < noticeUntil ? notice : ''; },
    goHome: goHome
  };
})();
