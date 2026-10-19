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
        bs.formats.forEach(function (fk) {
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
          notes: it.notes, spot: it.spot });
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

  function draftKey(area) { return 'cb.draft.' + area; }
  function loadDraft(area) { return api.LS.get(draftKey(area), { date: api.today(), v: {} }); }
  function saveDraft(area, d) { api.LS.set(draftKey(area), d); }
  function lineQty(line, v) {
    if (!v) return null;
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

    function lineHtml(l) {
      var v = d.v[l.id] || {}, prev = last[l.id];
      var prevTxt = prev ? 'last: ' + show(prev.qty) + ' ' + esc(l.unit) : (l.hint ? esc(l.hint) : '');
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
        v[part] = inp.value;
        if ((v.q == null || v.q === '') && (v.p == null || v.p === '') && (v.l == null || v.l === '')) delete d.v[id];
        else d.v[id] = v;
        saveDraft(area, d); progress();
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
      var lines = [];
      groups.forEach(function (g) {
        g.lines.forEach(function (l) {
          var q = lineQty(l, d.v[l.id]);
          if (q != null) lines.push({ item: l.id, name: l.name, spot: g.spot, qty: q, unit: l.unit });
        });
      });
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
  screens.movestock = function () {
    api.setHeader('Move stock', true);
    var roleAreas = areasFor(api.role());
    var places = Object.keys(PLACES);
    var f = { item: null, from: 'Walk-in cooler', to: 'Retail fridge' };
    var beers = [];
    CB.beerNames(api.state()).forEach(function (beer) {
      ['c473', 'c355', 'k20', 'k50', 'k58'].forEach(function (fk) {
        var fm = fmt(fk);
        beers.push({ id: CB.beerItemId(beer, fk), name: beer + ' — ' + fm.label, unit: fm.unit, area: 'brewery', spot: 'beer', pack: fm.pack });
      });
    });
    function sel(id, val) {
      return '<select id="' + id + '">' + places.map(function (p) { return '<option' + (p === val ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select>';
    }
    api.app.innerHTML = pickerHtml() +
      '<label class="f">How many</label><div class="row-btns"><input id="packs" inputmode="decimal" placeholder="flats" style="flex:1 1 40%">' +
      '<input id="loose" inputmode="decimal" placeholder="loose cans / kegs" style="flex:1 1 40%"></div>' +
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

  screens.stockrecent = function () {
    api.setHeader('Recent stock entries', true);
    var list = api.state().events.filter(function (e) { return e.type === 'count' || e.type === 'adjust' || e.type === 'move'; }).slice(-30).reverse();
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
