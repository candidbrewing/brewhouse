// Candid Brewhouse — stock counts, give-aways and moves.
// Count lists come from the Items tab of the Sheet; beer is counted by beer and format.
// A count in progress is kept on the phone until "Submit count".

window.CBStock = function (api) {
  'use strict';
  var screens = api.screens, esc = api.esc, go = api.go, $ = api.$, $$ = api.$$;

  var PLACES = {
    'Walk-in cooler': 'brewery',
    'Retail fridge': 'taproom',
    'Market': 'market',
    'On tap (taproom)': 'taproom', // a full keg put on the taproom taps (Louise, Oct 20: try it and see)
  };
  // Where beer is counted in each area, and which formats.
  var BEER_SPOTS = {
    brewery: { spot: 'Walk-in cooler', formats: ['c473', 'c355', 'k20', 'k50', 'k58'], last: true },
    taproom: { spot: 'Retail fridge', formats: ['c473', 'c355'], last: false },
    market: { spot: 'Market', formats: ['c473', 'c355'], last: false },
  };

  function areasFor(role) {
    return { brewer: ['brewery', 'taproom', 'market'], taproom: ['taproom', 'market'], market: ['market'] }[role] || [];
  }
  function fmt(key) { return CB.BEER_FORMATS.filter(function (f) { return f.key === key; })[0]; }
  function n(v) { var x = parseFloat(v); return isFinite(x) ? x : 0; }
  function show(q) { return (Math.round(q * 100) / 100).toLocaleString(); }

  // Every countable line for an area, grouped by spot, in walking order.
  function countList(area) {
    var s = api.state(), groups = [], bySpot = {};
    function group(name) {
      if (!bySpot[name]) { bySpot[name] = { spot: name, lines: [] }; groups.push(bySpot[name]); }
      return bySpot[name];
    }
    var bs = BEER_SPOTS[area];
    function addBeers() {
      var g = group(bs.spot);
      CB.beerNames(s).forEach(function (beer) {
        (area === 'brewery' ? bs.formats : CB.retailFormats(beer)).forEach(function (fk) {
          var f = fmt(fk);
          g.lines.push({ id: CB.beerItemId(beer, fk), name: beer + ' — ' + f.label, beer: beer, fmt: fk,
            unit: f.unit, pack: f.pack || 0, packName: f.packName || '', spot: bs.spot });
        });
      });
    }
    if (bs && !bs.last) addBeers();
    api.items().filter(function (it) { return it.area === area; })
      .sort(function (a, b) { return a.order - b.order; })
      .forEach(function (it) {
        group(it.spot).lines.push({ id: it.id, name: it.name, unit: it.unit, pack: it.pack, packName: it.packName,
          notes: it.notes, spot: it.spot, weigh: weighable(it) ? it : null });
      });
    if (area === 'brewery') {
      var g = group('Beer in tanks');
      CB.openBatches(s).forEach(function (b) {
        g.lines.push({ id: 'tank:' + b.batch, name: b.tank + ' · ' + b.batch + ' ' + b.beer, unit: 'hL',
          spot: 'Beer in tanks', hint: b.level == null ? 'volume not recorded in the app' : 'app says ' + show(b.level) + ' hL' });
      });
    }
    if (bs && bs.last) addBeers();
    return groups;
  }

  // Spirits are counted as full bottles plus each open bottle's weight (Louise, Oct 20: weekly, from end of October).
  var WEIGH_SPOTS = ['Spirits shelf'];
  function weighable(it) { return WEIGH_SPOTS.indexOf(it.spot) >= 0; }

  function draftKey(area) { return 'cb.draft.' + area; }
  function loadDraft(area) { return api.LS.get(draftKey(area), { date: api.today(), v: {} }); }
  function saveDraft(area, d) { api.LS.set(draftKey(area), d); }
  function lineQty(line, v) {
    if (!v) return null;
    if (line.weigh) {
      var g = (v.g || []).filter(function (x) { return x !== '' && x != null; });
      if ((v.f == null || v.f === '') && !g.length) return null;
      return CB.bottleQty(v.f, g, CB.bottleWeights(api.state(), line.weigh)); // null = weights missing
    }
    if (line.pack) {
      if (v.p === '' && v.l === '') return null;
      return n(v.p) * line.pack + n(v.l);
    }
    return v.q === '' || v.q == null ? null : n(v.q);
  }

  // ---------- stock home ----------
  screens.stock = function () {
    api.setHeader('Stock', api.role() === 'brewer');
    var areas = areasFor(api.role());
    var s = api.state();
    if (!areas.length) {
      api.app.innerHTML = '<div class="warn"><b>Not connected yet.</b> Open <b>Settings</b> and enter your access code.</div>' +
        '<button class="big" data-go="#settings">Settings</button>';
      api.wireGo(); return { refreshOnSync: true };
    }
    api.app.innerHTML = areas.map(function (a) {
      var d = loadDraft(a), started = Object.keys(d.v).length;
      var last = s.counts.filter(function (c) { return c.area === a; }).map(function (c) { return c.date; }).sort().pop();
      return '<button class="big' + (a === areas[0] ? '' : ' alt') + '" data-go="#count/' + a + '">' + esc(CB.AREAS[a].label) +
        '<div style="font-size:15px;font-weight:400;opacity:.85">' +
        (started ? 'Count in progress — ' + started + ' entered' : (last ? 'Last count ' + last : 'Not counted yet')) + '</div></button>';
    }).join('') +
      '<div class="row-btns"><button class="big alt" data-go="#giveaway">Give away / write off</button>' +
      '<button class="big alt" data-go="#movestock">Move stock</button></div>' +
      (areas.indexOf('taproom') >= 0 ? '<button class="big alt" data-go="#movestock/tap">Keg on tap</button>' : '') +
      (api.role() === 'brewer' ? '<div class="row-btns"><button class="big alt" data-go="#stocknow">Stock on hand</button>' +
        '<button class="big alt" data-go="#receive">Add to stock</button></div>' : '') +
      (areas.indexOf('taproom') >= 0 ? '<button class="big alt" data-go="#bottles">Bottle weights (spirits)</button>' : '') +
      (api.role() === 'brewer' ? '<button class="big alt" data-go="#kegs">Kegs out at customers</button>' : '') +
      '<button class="big alt" data-go="#stockrecent">Recent stock entries</button>' +
      (api.role() === 'brewer' ? '' : '<button class="big alt" data-go="#settings">Settings</button>');
    api.wireGo();
    return { refreshOnSync: true };
  };

  // ---------- the count ----------
  screens.count = function (area) {
    if (areasFor(api.role()).indexOf(area) < 0) { go('#stock'); return {}; }
    api.setHeader(CB.AREAS[area].label, true);
    var groups = countList(area), d = loadDraft(area);
    var last = CB.lastCounts(api.state(), area);
    var total = 0;
    groups.forEach(function (g) { total += g.lines.length; });

    function weighHtml(l, v, prevTxt) {
      var w = CB.bottleWeights(api.state(), l.weigh), g = (v.g && v.g.length ? v.g : ['']);
      var q = lineQty(l, v);
      return '<div class="sline" data-line="' + esc(l.id) + '" style="grid-template-columns:1fr 170px"><div class="sname">' + esc(l.name) +
        '<small>' + [prevTxt, w ? 'empty ' + w.emptyG + ' g, full ' + w.fullG + ' g' : '<a href="#bottles">set bottle weights</a>'].filter(Boolean).join(' · ') +
        '</small><small data-calc="' + esc(l.id) + '" style="color:var(--ink);font-weight:600">' + (q != null ? '= ' + show(q) + ' bottles' : (v.g || []).some(function (x) { return x !== '' && x != null; }) ? 'needs bottle weights' : '') + '</small></div>' +
        '<div class="sin two"><input inputmode="decimal" data-id="' + esc(l.id) + '" data-part="f" value="' + esc(v.f == null ? '' : v.f) + '" placeholder="full">' +
        g.map(function (x, i) {
          return '<input inputmode="decimal" data-id="' + esc(l.id) + '" data-part="g" data-i="' + i + '" value="' + esc(x) + '" placeholder="open g"' +
            (i ? ' style="grid-column:2"' : '') + '>';
        }).join('') +
        '<a href="#" data-more="' + esc(l.id) + '" style="grid-column:1 / -1;font-size:14px;text-align:right">+ another open bottle</a></div></div>';
    }

    function lineHtml(l) {
      var v = d.v[l.id] || {}, prev = last[l.id];
      var prevTxt = prev ? 'last: ' + show(prev.qty) + ' ' + esc(l.unit) : (l.hint ? esc(l.hint) : '');
      if (l.weigh) return weighHtml(l, v, prevTxt);
      var inputs = l.pack
        ? '<input inputmode="decimal" data-id="' + esc(l.id) + '" data-part="p" value="' + esc(v.p == null ? '' : v.p) + '" placeholder="' + esc(l.packName) + '">' +
          '<input inputmode="decimal" data-id="' + esc(l.id) + '" data-part="l" value="' + esc(v.l == null ? '' : v.l) + '" placeholder="loose">'
        : '<input inputmode="decimal" data-id="' + esc(l.id) + '" data-part="q" value="' + esc(v.q == null ? '' : v.q) + '" placeholder="' + esc(l.unit) + '">';
      return '<div class="sline" data-line="' + esc(l.id) + '"><div class="sname">' + esc(l.name) +
        '<small>' + prevTxt + (l.pack ? ' · ' + l.pack + ' per ' + esc(l.packName.replace(/s$/, '')) : '') + '</small></div>' +
        '<div class="sin' + (l.pack ? ' two' : '') + '">' + inputs + '</div></div>';
    }

    api.app.innerHTML =
      '<div class="sum" id="prog"></div>' +
      '<label class="f">Count date</label><input type="date" id="cdate" value="' + esc(d.date) + '" max="' + api.today() + '">' +
      '<p class="muted">Leave a line blank if you didn’t count it. Type 0 if there’s none.</p>' +
      '<div class="chips">' + groups.map(function (g, i) { return '<a href="#" data-jump="' + i + '">' + esc(g.spot) + '</a>'; }).join('') + '</div>' +
      groups.map(function (g, i) {
        return '<h2 id="spot' + i + '">' + esc(g.spot) + '</h2>' +
          (g.lines.length ? '<div class="card">' + g.lines.map(lineHtml).join('') + '</div>' : '<p class="muted">Nothing listed here yet.</p>');
      }).join('') +
      '<div id="msg"></div><button class="big" id="submit" style="margin-top:18px">Submit count</button>' +
      '<button class="big alt" id="discard">Start over</button>';

    function progress() {
      var done = 0;
      groups.forEach(function (g) { g.lines.forEach(function (l) { if (lineQty(l, d.v[l.id]) != null) done++; }); });
      $('#prog').innerHTML = '<div class="grid"><div><div class="n">' + done + ' / ' + total + '</div><div class="l">lines counted · saved on this phone</div></div></div>';
      return done;
    }
    $$('[data-id]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        inp.value = inp.value.replace(/[^0-9.]/g, '');
        var id = inp.getAttribute('data-id'), part = inp.getAttribute('data-part');
        var v = d.v[id] || {};
        if (part === 'g') { v.g = v.g || []; v.g[+inp.getAttribute('data-i')] = inp.value; }
        else v[part] = inp.value;
        var gs = (v.g || []).filter(function (x) { return x !== '' && x != null; });
        if ((v.q == null || v.q === '') && (v.p == null || v.p === '') && (v.l == null || v.l === '') &&
          (v.f == null || v.f === '') && !gs.length) delete d.v[id];
        else d.v[id] = v;
        saveDraft(area, d); progress();
        var calc = $('[data-calc="' + id + '"]');
        if (calc) {
          var line = null;
          groups.forEach(function (g) { g.lines.forEach(function (l) { if (l.id === id) line = l; }); });
          var q = line && d.v[id] ? lineQty(line, d.v[id]) : null;
          calc.textContent = q != null ? '= ' + show(q) + ' bottles' : (d.v[id] ? 'needs bottle weights' : '');
        }
      });
    });
    $$('[data-more]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.preventDefault();
        var id = b.getAttribute('data-more'), v = d.v[id] || (d.v[id] = {});
        v.g = (v.g && v.g.length ? v.g : ['']).concat(['']);
        saveDraft(area, d); api.render();
      });
    });
    $('#cdate').addEventListener('change', function (e) { d.date = e.target.value; saveDraft(area, d); });
    $$('[data-jump]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var el = document.getElementById('spot' + a.getAttribute('data-jump'));
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      });
    });
    $('#discard').addEventListener('click', function () {
      if (confirm('Clear everything typed in this count?')) { api.LS.set(draftKey(area), null); api.render(); }
    });
    $('#submit').addEventListener('click', function () {
      var lines = [], noWeights = [];
      groups.forEach(function (g) {
        g.lines.forEach(function (l) {
          var v = d.v[l.id], q = lineQty(l, v);
          if (q == null && l.weigh && v) { noWeights.push(l.name); return; }
          if (q == null) return;
          var line = { item: l.id, name: l.name, spot: g.spot, qty: q, unit: l.unit };
          if (l.weigh) { // keep what was typed, so the weighing can be checked later
            line.full = n(v.f); line.openG = (v.g || []).filter(function (x) { return x !== '' && x != null; }).map(n);
            var w = CB.bottleWeights(api.state(), l.weigh); if (w) { line.emptyG = w.emptyG; line.fullG = w.fullG; }
          }
          lines.push(line);
        });
      });
      if (noWeights.length) {
        $('#msg').innerHTML = '<div class="err">Open bottles were weighed but these have no bottle weights yet: ' + noWeights.map(esc).join(', ') +
          '. Tap <a href="#bottles">Bottle weights</a> first (your count is kept).</div>';
        return;
      }
      if (!lines.length) { $('#msg').innerHTML = '<div class="err">Nothing has been counted yet.</div>'; return; }
      if (!d.date || d.date > api.today()) { $('#msg').innerHTML = '<div class="err">Pick the count date.</div>'; return; }
      var missing = total - lines.length;
      if (missing && !confirm(missing + ' lines are blank and will show as “not counted”. Submit anyway?')) return;
      var e = api.addEvent('count', { area: area, date: d.date, lines: lines });
      api.LS.set(draftKey(area), null);
      go('#stocksaved/' + e.id);
    });
    progress();
    return {};
  };

  // ---------- item picker shared by give-away and move ----------
  function pickable(areas) {
    var out = [];
    areas.forEach(function (a) {
      countList(a).forEach(function (g) {
        g.lines.forEach(function (l) {
          if (l.id.indexOf('tank:') === 0) return;
          out.push({ id: l.id, name: l.name, unit: l.unit, area: a, spot: g.spot, beer: l.beer, fmt: l.fmt });
        });
      });
    });
    var seen = {};
    return out.filter(function (o) { var k = o.id; if (seen[k]) return false; seen[k] = 1; return true; });
  }
  function pickerHtml() {
    return '<label class="f">What</label><input id="find" placeholder="Type to search, e.g. Party Line 473" autocapitalize="off">' +
      '<div class="card" id="picks" style="max-height:260px;overflow:auto"></div><div id="picked"></div>';
  }
  function wirePicker(list, onPick) {
    function draw(q) {
      q = (q || '').toLowerCase();
      var hits = list.filter(function (o) { return !q || o.name.toLowerCase().indexOf(q) >= 0; }).slice(0, 40);
      $('#picks').innerHTML = hits.map(function (o, i) {
        return '<div class="list-item" data-pick="' + list.indexOf(o) + '"><div>' + esc(o.name) +
          '<br><span class="muted">' + esc(CB.AREAS[o.area].label) + ' · ' + esc(o.spot) + '</span></div></div>';
      }).join('') || '<p class="muted">No match.</p>';
      $$('[data-pick]').forEach(function (el) {
        el.addEventListener('click', function () {
          var o = list[+el.getAttribute('data-pick')];
          $('#picked').innerHTML = '<div class="warn" style="border-color:var(--ok);background:#eef7ef"><b>' + esc(o.name) + '</b> (' + esc(o.unit) + ')</div>';
          onPick(o);
        });
      });
    }
    $('#find').addEventListener('input', function (e) { draw(e.target.value); });
    draw('');
  }

  // ---------- give away / write off ----------
  screens.giveaway = function () {
    api.setHeader('Give away / write off', true);
    var areas = areasFor(api.role());
    var f = { item: null, reason: '' };
    api.app.innerHTML = pickerHtml() +
      '<label class="f">How many</label><input id="qty" inputmode="decimal" placeholder="e.g. 4">' +
      '<label class="f">Why</label><div class="chips" id="reasons">' + CB.ADJUST_REASONS.map(function (r) {
        return '<a href="#" data-r="' + esc(r) + '">' + esc(r) + '</a>';
      }).join('') + '</div>' +
      '<label class="f">Okayed by</label><input id="ok" placeholder="e.g. Louise">' +
      '<label class="f">Note (who it went to, what happened)</label><input id="note">' +
      '<label class="f">Date</label><input type="date" id="date" value="' + api.today() + '" max="' + api.today() + '">' +
      '<div id="msg"></div><button class="big" id="save" style="margin-top:18px">Save</button>';
    wirePicker(pickable(areas), function (o) { f.item = o; });
    $$('[data-r]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault(); f.reason = a.getAttribute('data-r');
        $$('[data-r]').forEach(function (x) { x.classList.toggle('on', x === a); });
      });
    });
    $('#save').addEventListener('click', function () {
      var q = parseFloat($('#qty').value), errs = [];
      if (!f.item) errs.push('Pick what was given away or written off.');
      if (!(q > 0)) errs.push('Enter how many.');
      if (!f.reason) errs.push('Pick a reason.');
      if (f.reason === 'Other' && !$('#note').value.trim()) errs.push('Say what happened in the note.');
      if (errs.length) { $('#msg').innerHTML = '<div class="err">' + errs.map(esc).join('<br>') + '</div>'; return; }
      var e = api.addEvent('adjust', { area: f.item.area, item: f.item.id, name: f.item.name, unit: f.item.unit, qty: q,
        reason: f.reason, approvedBy: $('#ok').value.trim(), note: $('#note').value.trim(), date: $('#date').value });
      go('#stocksaved/' + e.id);
    });
    return {};
  };

  // ---------- move stock (beer between walk-in, retail fridge, market) ----------
  // "#movestock/tap" = a full keg from the walk-in onto the taproom taps.
  screens.movestock = function (preset) {
    var tap = preset === 'tap';
    api.setHeader(tap ? 'Keg on tap' : 'Move stock', true);
    var roleAreas = areasFor(api.role());
    var places = Object.keys(PLACES);
    var f = { item: null, from: 'Walk-in cooler', to: tap ? 'On tap (taproom)' : 'Retail fridge' };
    var beers = [];
    CB.beerNames(api.state()).forEach(function (beer) {
      (tap ? ['k20', 'k50', 'k58'] : ['c473', 'c355', 'k20', 'k50', 'k58']).forEach(function (fk) {
        var fm = fmt(fk);
        beers.push({ id: CB.beerItemId(beer, fk), name: beer + ' — ' + fm.label, unit: fm.unit, area: 'brewery', spot: 'beer', pack: fm.pack });
      });
    });
    function sel(id, val) {
      return '<select id="' + id + '">' + places.map(function (p) { return '<option' + (p === val ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select>';
    }
    api.app.innerHTML = pickerHtml() +
      (tap ? '<label class="f">How many kegs</label><input id="loose" inputmode="numeric" value="1"><input id="packs" type="hidden" value="">'
        : '<label class="f">How many</label><div class="row-btns"><input id="packs" inputmode="decimal" placeholder="flats" style="flex:1 1 40%">' +
          '<input id="loose" inputmode="decimal" placeholder="loose cans / kegs" style="flex:1 1 40%"></div>') +
      '<label class="f">From</label>' + sel('from', f.from) + '<label class="f">To</label>' + sel('to', f.to) +
      '<label class="f">Date</label><input type="date" id="date" value="' + api.today() + '" max="' + api.today() + '">' +
      '<div id="msg"></div><button class="big" id="save" style="margin-top:18px">Save move</button>';
    wirePicker(beers, function (o) { f.item = o; });
    $('#save').addEventListener('click', function () {
      var from = $('#from').value, to = $('#to').value, errs = [];
      var q = (f.item && f.item.pack ? n($('#packs').value) * f.item.pack : 0) + n($('#loose').value);
      if (!f.item) errs.push('Pick the beer and format.');
      if (!(q > 0)) errs.push('Enter how many.');
      if (from === to) errs.push('From and To are the same place.');
      if (roleAreas.indexOf(PLACES[from]) < 0 && roleAreas.indexOf(PLACES[to]) < 0) errs.push('Your code can’t record moves between those places.');
      if (errs.length) { $('#msg').innerHTML = '<div class="err">' + errs.map(esc).join('<br>') + '</div>'; return; }
      var e = api.addEvent('move', { item: f.item.id, name: f.item.name, unit: f.item.unit, qty: q, from: from, to: to,
        fromArea: PLACES[from], toArea: PLACES[to], date: $('#date').value });
      go('#stocksaved/' + e.id);
    });
    return {};
  };

  function describe(e) {
    var d = e.data || {};
    if (e.type === 'count') return CB.AREAS[d.area].label + ' count, ' + (d.lines || []).length + ' lines';
    if (e.type === 'adjust') return d.reason + ': ' + show(d.qty) + ' ' + d.unit + ' ' + d.name;
    if (e.type === 'move') return 'Moved ' + show(d.qty) + ' ' + d.unit + ' ' + d.name + ', ' + d.from + ' → ' + d.to;
    if (e.type === 'bottle') return 'Bottle weights: ' + d.name + ', empty ' + d.emptyG + ' g, full ' + d.fullG + ' g';
    if (e.type === 'keg_out' || e.type === 'keg_back') return (e.type === 'keg_out' ? 'Kegs delivered to ' : 'Kegs picked up from ') + d.customer + ': ' + kegText(d);
    return e.type;
  }

  screens.stocksaved = function (eid) {
    api.setHeader('Saved', false);
    var e = api.allEvents().filter(function (x) { return x.id === eid; })[0];
    if (!e) { go('#stock'); return {}; }
    var undone = !!api.state().voided[eid];
    api.app.innerHTML = undone
      ? '<div class="done"><div class="tick" style="color:var(--bad)">↺</div><h2>Undone</h2></div><button class="big" data-go="#stock">Back to stock</button>'
      : '<div class="done"><div class="tick">✓</div><h2>Saved</h2><p>' + esc(describe(e)) + '</p><p class="muted">' +
        (api.isPending(eid) ? 'Saved on this phone. It will send when there is wifi.' : 'Sent to the Sheet.') + '</p></div>' +
        '<button class="big" data-go="#stock">Done</button><button class="big alt" id="undo">Undo — I made a mistake</button>';
    api.wireGo();
    var u = $('#undo');
    if (u) u.addEventListener('click', function () { api.addEvent('void', { target: eid }); api.render(); });
    return { refreshOnSync: true };
  };

  var STOCK_LIST = { count: 1, adjust: 1, move: 1, bottle: 1, keg_out: 1, keg_back: 1 };
  var KEG_LABEL = { k20: '20 L', k50: '50 L', k58: '58.6 L' };
  function kegText(d) {
    var parts = CB.KEG_KEYS.filter(function (k) { return n(d[k]); }).map(function (k) { return n(d[k]) + ' × ' + KEG_LABEL[k]; });
    return parts.join(', ') || 'none';
  }

  // ---------- bottle weights (spirits) ----------
  screens.bottles = function () {
    api.setHeader('Bottle weights', true);
    var s = api.state();
    var list = api.items().filter(function (it) { return it.area === 'taproom' && weighable(it); })
      .sort(function (a, b) { return a.order - b.order; });
    api.app.innerHTML =
      '<div class="card"><b>Do this once for each spirit</b>, and again if the brand or bottle changes.' +
      '<ol style="margin:8px 0 0 20px;padding:0"><li>Weigh a <b>full, sealed</b> bottle.</li>' +
      '<li>Weigh an <b>empty</b> one, rinsed and dry, with the same pourer on it.</li>' +
      '<li>On the count, weigh each open bottle <b>with its pourer on</b>.</li></ol>' +
      '<p class="muted" style="margin-bottom:0">Grams, from the bar scale.</p></div>' +
      (list.length ? list.map(function (it) {
        var w = CB.bottleWeights(s, it) || {};
        return '<div class="card"><div class="sname">' + esc(it.name) + '</div><div class="g2">' +
          '<div><label class="f">Empty g</label><input inputmode="decimal" data-w="' + esc(it.id) + '" data-k="emptyG" value="' + esc(w.emptyG || '') + '"></div>' +
          '<div><label class="f">Full g</label><input inputmode="decimal" data-w="' + esc(it.id) + '" data-k="fullG" value="' + esc(w.fullG || '') + '"></div>' +
          '</div></div>';
      }).join('') : '<p class="muted">No spirits on the taproom list.</p>') +
      '<div id="msg"></div><button class="big" id="save">Save weights</button>';
    $('#save').addEventListener('click', function () {
      var errs = [], saves = [];
      list.forEach(function (it) {
        var e = $('[data-w="' + it.id + '"][data-k="emptyG"]').value.trim(), f = $('[data-w="' + it.id + '"][data-k="fullG"]').value.trim();
        if (e === '' && f === '') return;
        var old = CB.bottleWeights(s, it) || {};
        if (n(e) === old.emptyG && n(f) === old.fullG) return;
        if (!(n(e) > 0) || !(n(f) > n(e))) { errs.push(it.name + ': full must be heavier than empty.'); return; }
        saves.push({ area: 'taproom', item: it.id, name: it.name, emptyG: n(e), fullG: n(f), date: api.today() });
      });
      if (errs.length) { $('#msg').innerHTML = '<div class="err">' + errs.map(esc).join('<br>') + '</div>'; return; }
      if (!saves.length) { $('#msg').innerHTML = '<div class="warn">Nothing changed.</div>'; return; }
      var last;
      saves.forEach(function (x) { last = api.addEvent('bottle', x); });
      go('#stocksaved/' + last.id);
    });
    return {};
  };

  // ---------- kegs out at customers ----------
  // Deliveries come from the invoices (Material Flows' weekly pass); Bryan logs pickups, and any delivery with no invoice.
  screens.kegs = function () {
    api.setHeader('Kegs out', true);
    var s = api.state(), bal = CB.kegBalances(s), tot = { k20: 0, k50: 0, k58: 0 };
    bal.forEach(function (c) { CB.KEG_KEYS.forEach(function (k) { tot[k] += c[k]; }); });
    api.app.innerHTML =
      '<div class="sum"><div class="grid">' + CB.KEG_KEYS.map(function (k) {
        return '<div><div class="n">' + tot[k] + '</div><div class="l">' + KEG_LABEL[k] + ' out</div></div>';
      }).join('') + '</div></div>' +
      '<div class="row-btns"><button class="big" data-go="#kegmove/back">Picked up empties</button>' +
      '<button class="big alt" data-go="#kegmove/out">Delivered</button></div>' +
      (bal.length ? '<div class="card">' + bal.map(function (c) {
        var days = c.since ? CB.daysBetween(c.since, api.today()) : null;
        return '<div class="list-item"><div><b>' + esc(c.customer) + '</b><br><span class="muted">' + kegText(c) +
          (days != null ? ' · out since ' + esc(c.since) + ' (' + days + ' days)' : '') + '</span></div>' +
          '<button class="small-btn" data-go="#kegmove/back/' + encodeURIComponent(c.customer) + '">Pickup</button></div>';
      }).join('') + '</div>' : '<p class="muted">No kegs out on record.</p>') +
      '<p class="muted">Deliveries are added from the invoices each week. Log a delivery here only if there’s no invoice (a loaner, an event).</p>';
    api.wireGo();
    return { refreshOnSync: true };
  };

  screens.kegmove = function (kind, who) {
    var out = kind === 'out';
    api.setHeader(out ? 'Kegs delivered' : 'Empties picked up', true);
    var s = api.state(), names = Object.keys(s.kegsOut).map(function (k) { return s.kegsOut[k].customer; }).sort();
    api.app.innerHTML =
      '<label class="f">Customer</label><input id="cust" list="custs" value="' + esc(who || '') + '" autocomplete="off">' +
      '<datalist id="custs">' + names.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
      CB.KEG_KEYS.map(function (k) {
        return '<div class="count"><div class="lbl">' + KEG_LABEL[k] + '</div><button data-dn="' + k + '">−</button>' +
          '<input inputmode="numeric" id="' + k + '" value="0"><button data-up="' + k + '">+</button></div>';
      }).join('') +
      (out ? '<label class="f">Why no invoice? (loaner, event…)</label><input id="note">'
        : '<label class="f">Note (optional)</label><input id="note">') +
      '<label class="f">Date</label><input type="date" id="date" value="' + api.today() + '" max="' + api.today() + '">' +
      '<div id="msg"></div><button class="big" id="save" style="margin-top:18px">Save</button>';
    CB.KEG_KEYS.forEach(function (k) {
      $('[data-up="' + k + '"]').addEventListener('click', function () { $('#' + k).value = n($('#' + k).value) + 1; });
      $('[data-dn="' + k + '"]').addEventListener('click', function () { $('#' + k).value = Math.max(0, n($('#' + k).value) - 1); });
    });
    $('#save').addEventListener('click', function () {
      var d = { customer: $('#cust').value.trim(), note: $('#note').value.trim(), date: $('#date').value }, errs = [];
      CB.KEG_KEYS.forEach(function (k) { d[k] = Math.max(0, Math.round(n($('#' + k).value))); });
      if (!d.customer) errs.push('Who is it?');
      if (!(d.k20 + d.k50 + d.k58)) errs.push('Enter how many kegs.');
      if (out && !d.note) errs.push('Say why there’s no invoice.');
      if (!out) {
        var c = s.kegsOut[d.customer.toLowerCase()];
        CB.KEG_KEYS.forEach(function (k) {
          if (d[k] > (c ? c[k] : 0)) errs.push('The app shows ' + (c ? c[k] : 0) + ' × ' + KEG_LABEL[k] + ' at ' + d.customer + '. Saving anyway will show a minus until the delivery is added.');
        });
        if (errs.length && errs.every(function (x) { return x.indexOf('The app shows') === 0; }) && !$('#msg').dataset.warned) {
          $('#msg').dataset.warned = '1';
          $('#msg').innerHTML = '<div class="warn">' + errs.map(esc).join('<br>') + '<br>Tap Save again to keep it.</div>'; return;
        }
        errs = errs.filter(function (x) { return x.indexOf('The app shows') !== 0; });
      }
      if (errs.length) { $('#msg').innerHTML = '<div class="err">' + errs.map(esc).join('<br>') + '</div>'; return; }
      var e = api.addEvent(out ? 'keg_out' : 'keg_back', d);
      go('#stocksaved/' + e.id);
    });
    return {};
  };

  screens.stockrecent = function () {
    api.setHeader('Recent stock entries', true);
    var list = api.state().events.filter(function (e) { return STOCK_LIST[e.type]; }).slice(-30).reverse();
    api.app.innerHTML = list.length ? '<div class="card">' + list.map(function (e) {
      return '<div class="list-item"><div>' + esc(describe(e)) + '<br><span class="muted">' + esc((e.data && e.data.date) || '') +
        (e.by ? ' · ' + esc(e.by) : '') + (api.isPending(e.id) ? ' · <b>waiting to send</b>' : '') +
        '</span></div><button class="small-btn" data-undo="' + e.id + '">Undo</button></div>';
    }).join('') + '</div>' : '<p class="muted">Nothing yet.</p>';
    $$('[data-undo]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (confirm('Cancel this entry? It stays in the log, marked as undone.')) { api.addEvent('void', { target: b.getAttribute('data-undo') }); api.render(); }
      });
    });
    return { refreshOnSync: true };
  };
};
