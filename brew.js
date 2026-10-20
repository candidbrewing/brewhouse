// Candid Brewhouse — brew day, additions, readings, planned steps and stock on hand.
// A brew draws its malt, hops, additions and any new yeast brick out of stock; the month-end
// count then only has to explain waste. Planned steps (dry hop, crop, transfer) go on the
// Brewhouse Google Calendar (done by the Sheet's script).

window.CBBrew = function (api) {
  'use strict';
  var screens = api.screens, esc = api.esc, go = api.go, $ = api.$, $$ = api.$$;

  var SECTIONS = {
    malts: { title: 'Malt & adjuncts', spots: ['Grain room'] },
    hops: { title: 'Hops & kettle additions', spots: ['Hop freezer', 'Brewing supplies'], at: true },
    others: { title: 'Salts, acids, fruit & other additions', spots: ['Brewing supplies', 'Grain room', 'Hop freezer'], stage: true },
  };
  var STAGES = ['Mash', 'Kettle', 'Whirlpool', 'Fermenter'];
  var NEW_UNITS = ['kg', 'g', 'L', 'mL', 'bricks', 'packs', 'tablets', 'units'];
  var STEP_DAYS = { 'Dry hop': 3, 'Crop yeast': 5, 'Transfer to brite': 10, 'Package': 14, 'Other': 1 };

  function n(v) { var x = parseFloat(v); return isFinite(x) ? x : 0; }
  function show(q) { return (Math.round(q * 100) / 100).toLocaleString(); }
  function brewery() { return api.items().filter(function (it) { return it.area === 'brewery'; }); }
  function byId(id) { return api.items().filter(function (it) { return it.id === id; })[0]; }
  function levels() { return CB.stockLevels(api.state(), brewery()); }
  function prettyDate(iso) {
    var p = String(iso || '').split('-');
    var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1];
    return m ? m + ' ' + (+p[2]) : String(iso || '');
  }

  // Units an amount can be typed in for an item: its own unit, its g/kg or mL/L partner, and its pack (bags).
  function unitsFor(it) {
    var u = CB.entryUnits(it.unit).slice();
    if (it.pack && it.packName && u.indexOf(it.packName) < 0) u.push(it.packName);
    return u;
  }
  function defaultUnit(it) {
    if (it.spot === 'Brewing supplies' && it.unit === 'kg') return 'g';
    if (it.spot === 'Brewing supplies' && it.unit === 'L') return 'mL';
    return it.unit;
  }
  function stockQtyOf(it, qty, unit) {
    if (it.pack && unit === it.packName) return Math.round(n(qty) * it.pack * 1e6) / 1e6;
    return CB.toStockUnit(qty, unit, it.unit);
  }
  function onHandText(lv) {
    if (!lv) return '';
    var it = lv.item;
    if (!lv.counted && !lv.received && !lv.used) return 'not counted yet';
    var s = show(lv.onHand) + ' ' + it.unit;
    if (it.pack && it.packName) s += ' (' + show(lv.onHand / it.pack) + ' ' + it.packName + ')';
    return s;
  }

  // <option>s for an item picker: the section's spots first, each item with what's on hand.
  function itemOptions(sel, spots, lv) {
    var items = brewery(), seen = {};
    var groups = spots.concat(items.map(function (it) { return it.spot; })).filter(function (s) {
      if (seen[s]) return false; seen[s] = 1; return true;
    });
    return '<option value="">Choose…</option>' + groups.map(function (g) {
      var list = items.filter(function (it) { return it.spot === g; }).sort(function (a, b) { return a.order - b.order; });
      if (!list.length) return '';
      return '<optgroup label="' + esc(g) + '">' + list.map(function (it) {
        return '<option value="' + esc(it.id) + '"' + (it.id === sel ? ' selected' : '') + '>' + esc(it.name) +
          (lv[it.id] ? ' · ' + esc(onHandText(lv[it.id])) : '') + '</option>';
      }).join('') + '</optgroup>';
    }).join('') + '<option value="__new"' + (sel === '__new' ? ' selected' : '') + '>+ New item (not on the list)…</option>';
  }

  // One ingredient line: item, amount, unit, and the extras its section needs.
  function lineHtml(sec, i, l, cfg, lv) {
    var it = l.item && l.item !== '__new' ? byId(l.item) : null;
    var units = it ? unitsFor(it) : [];
    var h = '<div class="bline" data-sec="' + sec + '" data-i="' + i + '">' +
      '<select data-k="item">' + itemOptions(l.item, cfg.spots, lv) + '</select>';
    if (l.item === '__new') {
      h += '<div class="newitem"><input data-new="name" placeholder="Name, e.g. Nelson Sauvin">' +
        '<select data-new="unit">' + NEW_UNITS.map(function (u) { return '<option>' + u + '</option>'; }).join('') + '</select>' +
        (cfg.spots.length > 1 ? '<select data-new="spot" style="grid-column:1/-1">' + cfg.spots.map(function (sp) { return '<option>' + esc(sp) + '</option>'; }).join('') + '</select>' : '') +
        '<button type="button" class="small-btn" data-new="add">Add item</button></div>';
    }
    h += '<div class="brow"><input data-k="qty" inputmode="decimal" placeholder="amount" value="' + esc(l.qty == null ? '' : l.qty) + '">' +
      '<select data-k="unit"' + (it ? '' : ' disabled') + '>' + units.map(function (u) {
        return '<option' + (u === l.unit ? ' selected' : '') + '>' + esc(u) + '</option>';
      }).join('') + '</select>';
    if (cfg.at) {
      h += '<input data-k="at" placeholder="at: 60, WP" value="' + esc(l.at || '') + '">' +
        '<input data-k="time" placeholder="clock" value="' + esc(l.time || '') + '">';
    }
    if (cfg.stage) {
      h += '<select data-k="stage">' + STAGES.map(function (s) { return '<option' + (s === l.stage ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>';
    }
    h += '<button type="button" class="x" data-del aria-label="Remove">×</button></div></div>';
    return h;
  }

  // Wires the ingredient lines on the screen; "lists" maps section -> array of lines in the form state.
  function wireLines(lists, cfgs, save, redraw) {
    $$('.bline').forEach(function (row) {
      var sec = row.getAttribute('data-sec'), i = +row.getAttribute('data-i'), l = lists[sec][i];
      row.querySelector('[data-k="item"]').addEventListener('change', function (e) {
        l.item = e.target.value;
        var it = byId(l.item);
        l.unit = it ? defaultUnit(it) : '';
        save(); redraw();
      });
      ['qty', 'at', 'time'].forEach(function (k) {
        var inp = row.querySelector('[data-k="' + k + '"]');
        if (inp) inp.addEventListener('input', function () {
          if (k === 'qty') inp.value = inp.value.replace(/[^0-9.]/g, '');
          l[k] = inp.value; save();
        });
      });
      ['unit', 'stage'].forEach(function (k) {
        var s = row.querySelector('[data-k="' + k + '"]');
        if (s) s.addEventListener('change', function () { l[k] = s.value; save(); });
      });
      row.querySelector('[data-del]').addEventListener('click', function () { lists[sec].splice(i, 1); save(); redraw(); });
      var add = row.querySelector('[data-new="add"]');
      if (add) add.addEventListener('click', function () {
        var name = row.querySelector('[data-new="name"]').value.trim();
        var unit = row.querySelector('[data-new="unit"]').value;
        if (!name) { alert('Type the name of the new item.'); return; }
        var sp = row.querySelector('[data-new="spot"]'), spot = sp ? sp.value : cfgs[sec].spots[0];
        var id = 'bre:new-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + Date.now().toString(36).slice(-4);
        api.addEvent('item_new', { date: api.today(), item: { id: id, area: 'brewery', spot: spot, name: name, unit: unit, pack: 0,
          packName: '', kind: 'raw', valued: 'Y', order: 999, notes: 'Added from the phone' } });
        l.item = id; l.unit = unit; save(); redraw();
      });
    });
  }

  // Lines ready to save: each with its item name and the amount in the item's stock unit.
  function finishLines(list, errs, label) {
    var out = [];
    (list || []).forEach(function (l) {
      if (!l.item) return;
      if (l.item === '__new') { errs.push(label + ': finish adding the new item, or remove the line.'); return; }
      var it = byId(l.item);
      if (!it) { errs.push(label + ': an item is no longer on the list.'); return; }
      if (!(n(l.qty) > 0)) { errs.push(label + ': enter the amount of ' + it.name + '.'); return; }
      var line = { item: it.id, name: it.name, qty: n(l.qty), unit: l.unit || it.unit,
        stockQty: stockQtyOf(it, l.qty, l.unit || it.unit), stockUnit: it.unit };
      ['at', 'time', 'stage'].forEach(function (k) { if (l[k]) line[k] = l[k]; });
      out.push(line);
    });
    return out;
  }

  // ---------- brew home ----------
  screens.brew = function () {
    api.setHeader('Brew day', true);
    var s = api.state();
    var recent = CB.openBatches(s).filter(function (b) { return b.brews.length; });
    var draft = api.LS.get('cb.draft.brew', null);
    api.app.innerHTML =
      (draft && draft.beer ? '<button class="big" data-go="#brewform/' + (draft.mode === 'more' ? esc(draft.batch) : 'new') + '">Continue brew in progress<div style="font-size:15px;font-weight:400;opacity:.85">' +
        esc(draft.batch + ' ' + draft.beer) + ' · saved on this phone</div></button>' : '') +
      '<button class="big' + (draft && draft.beer ? ' alt' : '') + '" data-go="#brewform/new">Start a new brew</button>' +
      (recent.length ? '<h2>Second brew day on a batch</h2><p class="muted">For a double brew, or a sour finished on day 2.</p><div class="tiles">' +
        recent.map(function (b) {
          return '<button class="tile" data-go="#brewform/' + b.batch + '"><div class="tank">' + esc(b.tank) + ' · ' + b.batch +
            '</div><div class="beer">' + esc(b.beer) + '</div><div class="meta">' + b.brews.length + ' brew day' + (b.brews.length > 1 ? 's' : '') + ' so far</div></button>';
        }).join('') + '</div>' : '') +
      '<div style="height:14px"></div>' + dueHtml(s, 30) +
      '<div class="row-btns"><button class="big alt" data-go="#receive">Add to stock</button>' +
      '<button class="big alt" data-go="#stocknow">Stock on hand</button></div>';
    api.wireGo(); wireDue();
    return { refreshOnSync: true };
  };

  // ---------- the brew sheet ----------
  function blank() {
    return { mode: 'new', batch: '', beer: '', date: api.today(), fermenter: '', intoHL: '', kettleHL: '',
      foundationL: '', strikeL: '', strikeTemp: '', mashIn: '', initialTemp: '', restTemp: '', rest: '', recirc: '', runoff: '',
      mashPH: '', kettleGravity: '', kettlePH: '', boilMin: '', waterAddL: '', og: '', notes: '',
      malts: [], hops: [], others: [], yeast: { item: '', source: 'new', qty: '1', unit: '', fromBatch: '', use: '' },
      plans: [], from: '' };
  }

  // A new brew starts from the last brew of the same beer: same ingredients and set points, fresh readings.
  function prefill(f, s) {
    var last = CB.lastBrewOf(s, f.beer);
    if (!last) return;
    var d = last.data;
    function copy(list) {
      return (list || []).map(function (l) { return { item: l.item, qty: String(l.qty), unit: l.unit, at: l.at || '', time: '', stage: l.stage || '' }; });
    }
    f.malts = copy(d.malts); f.hops = copy(d.hops); f.others = copy(d.others);
    if (d.yeast && d.yeast.item) f.yeast = { item: d.yeast.item, source: 'new', qty: String(d.yeast.source === 'new' ? d.yeast.qty || 1 : 1), unit: d.yeast.unit || '', fromBatch: '', use: '' };
    ['foundationL', 'strikeL', 'strikeTemp', 'restTemp', 'boilMin', 'waterAddL', 'kettleHL'].forEach(function (k) { if (d[k]) f[k] = String(d[k]); });
    f.plans = Object.keys(s.plans).map(function (k) { return s.plans[k]; })
      .filter(function (p) { return p.batch === last.batch; })
      .map(function (p) { return { step: p.step, days: CB.daysBetween(d.date, p.due), note: p.note || '' }; })
      .filter(function (p) { return p.days >= 0; })
      .map(function (p) { return { step: p.step, due: CB.addDays(f.date, p.days), note: p.note }; });
    f.from = last.batch + ' (' + prettyDate(d.date) + ')';
  }

  screens.brewform = function (arg) {
    var s = api.state();
    var more = arg && arg !== 'new';
    var b = more ? s.batches[arg] : null;
    if (more && !b) { go('#brew'); return {}; }
    var f = api.LS.get('cb.draft.brew', null);
    if (!f || (more ? f.batch !== arg || f.mode !== 'more' : f.mode !== 'new')) {
      f = blank();
      if (more) { f.mode = 'more'; f.batch = b.batch; f.beer = b.beer; f.fermenter = b.tank; }
      else f.batch = CB.nextBatchNumber(s, api.today());
    }
    var day = more ? b.brews.length + 1 : 1;
    function save() { api.LS.set('cb.draft.brew', f); }
    api.setHeader(more ? 'Brew day ' + day + ' · ' + b.batch : 'New brew', true);

    if (!f.beer) { // pick the beer first; the sheet then fills in from its last brew
      api.app.innerHTML = '<p><b>Which beer?</b></p><div class="tiles">' + CB.BEERS.map(function (x) {
        return '<button class="tile" data-beer="' + esc(x.name) + '"><div class="beer">' + esc(x.name) + '</div></button>';
      }).join('') + '<button class="tile" data-beer="__other"><div class="beer">Other…</div></button></div>';
      $$('[data-beer]').forEach(function (t) {
        t.addEventListener('click', function () {
          var name = t.getAttribute('data-beer');
          if (name === '__other') { name = (prompt('Name of the beer?') || '').trim(); if (!name) return; }
          f.beer = name; prefill(f, s); save(); draw();
        });
      });
      return {};
    }

    function field(k, label, mode, ph) {
      return '<div><label class="f">' + label + '</label><input data-f="' + k + '"' + (mode ? ' inputmode="' + mode + '"' : '') +
        ' placeholder="' + esc(ph || '') + '" value="' + esc(f[k] || '') + '"></div>';
    }
    function draw() {
      var y = window.scrollY, lv = levels(), busy = {};
      CB.openBatches(s).forEach(function (x) { if (x.batch !== f.batch) busy[x.tank] = x.batch; });
      var yeastIt = f.yeast.item ? byId(f.yeast.item) : null;
      api.app.innerHTML =
        (f.from ? '<div class="warn" style="border-color:var(--line);background:#fff">Filled in from <b>' + esc(f.from) + '</b>. Change what’s different.</div>' : '') +
        '<div class="card"><div class="g2">' +
          (more ? '<div><label class="f">Batch</label><div class="big-val">' + esc(f.batch) + ' ' + esc(f.beer) + '</div></div>'
            : field('batch', 'Batch number', 'numeric', '26037') + '<div><label class="f">Beer</label><div class="big-val" style="padding:6px 0">' + esc(f.beer) +
              ' <a href="#" id="chbeer" class="muted" style="font-size:15px">change</a></div></div>') +
          '<div><label class="f">Date</label><input type="date" data-f="date" value="' + esc(f.date) + '" max="' + api.today() + '"></div>' +
          '<div><label class="f">Fermenter</label><select data-f="fermenter"><option value="">Choose…</option>' + CB.TANKS.filter(function (t) { return t.indexOf('FV') === 0; }).map(function (t) {
            return '<option value="' + t + '"' + (t === f.fermenter ? ' selected' : '') + '>' + t + ' · ' + CB.TANK_HL[t] + ' hL' + (busy[t] ? ' · has ' + busy[t] : '') + '</option>';
          }).join('') + '</select></div>' +
          field('kettleHL', 'Kettle volume (hL)', 'decimal', '12.5') +
          field('intoHL', 'Into FV (hL)', 'decimal', 'optional') +
        '</div></div>' +
        '<h2>Mash</h2><div class="card"><div class="g2">' +
          field('foundationL', 'Foundation (L)', 'decimal', '100') + field('strikeL', 'Strike (L)', 'decimal', '400') +
          field('strikeTemp', 'Strike temp (°C)', 'decimal', '76') + field('mashIn', 'Mash in', '', '9:15–9:53') +
          field('initialTemp', 'Initial temp (°C)', 'decimal') + field('restTemp', 'Rest temp (°C)', 'decimal') +
          field('rest', 'Rest', '', '9:55–10:25') + field('recirc', 'Recirc', '', '10:25–10:40') +
          field('runoff', 'Run-off', '', '10:40–12:45') + field('mashPH', 'Mash pH', 'decimal', '5.25') +
        '</div></div>' +
        sectionHtml('malts', lv) + sectionHtml('hops', lv) +
        '<h2>Kettle</h2><div class="card"><div class="g2">' +
          field('kettleGravity', 'Kettle gravity', 'decimal', '1.051') + field('kettlePH', 'Kettle pH', 'decimal', '5.25') +
          field('boilMin', 'Time in boil (min)', 'numeric', '60') + field('waterAddL', 'Water added (L)', 'decimal', '500') +
          field('og', 'O.G.', 'decimal', '1.050') +
        '</div></div>' +
        sectionHtml('others', lv) +
        '<h2>Yeast</h2><div class="card">' +
          '<select id="ysel">' + itemOptions(f.yeast.item, ['Yeast fridge'], lv).replace('<option value="__new"', '<option disabled value="x"') + '</select>' +
          '<div style="height:10px"></div>' + api.seg('ysrc', [['new', 'New brick'], ['repitch', 'Repitch']], f.yeast.source) +
          (f.yeast.source === 'new'
            ? '<div class="brow" style="margin-top:10px"><input id="yqty" inputmode="decimal" value="' + esc(f.yeast.qty) + '" placeholder="how many">' +
              '<span class="muted" style="align-self:center">' + esc(yeastIt ? yeastIt.unit : 'bricks') + ' from stock</span></div>'
            : '<div class="g2" style="margin-top:6px"><div><label class="f">Cropped from batch</label><input id="yfrom" inputmode="numeric" value="' + esc(f.yeast.fromBatch) + '" placeholder="26033"></div>' +
              '<div><label class="f">Which use</label><input id="yuse" inputmode="numeric" value="' + esc(f.yeast.use) + '" placeholder="2"></div></div>' +
              '<p class="muted">A repitch takes nothing out of stock.</p>') +
        '</div>' +
        '<h2>Next steps</h2><p class="muted">These go on the Brewhouse calendar and show on the home screen when due.</p>' +
        '<div class="card">' + (f.plans.length ? f.plans.map(function (p, i) {
          return '<div class="brow" data-plan="' + i + '"><select data-p="step">' + CB.STEPS.map(function (x) {
            return '<option' + (x === p.step ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>' +
            '<input type="date" data-p="due" value="' + esc(p.due) + '"><button type="button" class="x" data-pdel>×</button></div>' +
            '<input data-p="note" data-pi="' + i + '" placeholder="note, e.g. Galaxy 4 kg" value="' + esc(p.note || '') + '" style="margin:6px 0 12px">';
        }).join('') : '<p class="muted">None yet.</p>') +
        '<div class="chips">' + CB.STEPS.map(function (x) { return '<a href="#" data-addplan="' + esc(x) + '">+ ' + esc(x) + '</a>'; }).join('') + '</div></div>' +
        '<h2>Notes</h2><textarea data-f="notes" rows="3" placeholder="Anything else from the sheet">' + esc(f.notes) + '</textarea>' +
        '<div id="msg"></div><button class="big" id="save" style="margin-top:18px">Save brew day' + (more ? ' ' + day : '') + '</button>' +
        '<button class="big alt" id="discard">Start over</button>';
      window.scrollTo(0, y);
      wireForm();
    }
    function sectionHtml(sec, lv) {
      var cfg = SECTIONS[sec];
      return '<h2>' + cfg.title + '</h2><div class="card">' +
        (f[sec].length ? f[sec].map(function (l, i) { return lineHtml(sec, i, l, cfg, lv); }).join('') : '<p class="muted">Nothing added.</p>') +
        '<button type="button" class="small-btn" data-addline="' + sec + '" style="margin-top:8px">+ Add a line</button></div>';
    }
    function wireForm() {
      $$('[data-f]').forEach(function (inp) {
        inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', function () { f[inp.getAttribute('data-f')] = inp.value; save(); });
      });
      wireLines(f, SECTIONS, save, draw);
      $$('[data-addline]').forEach(function (bt) {
        bt.addEventListener('click', function () {
          f[bt.getAttribute('data-addline')].push({ item: '', qty: '', unit: '', at: '', time: '', stage: 'Mash' }); save(); draw();
        });
      });
      var ch = $('#chbeer');
      if (ch) ch.addEventListener('click', function (e) { e.preventDefault(); if (confirm('Pick a different beer? This clears the sheet.')) { api.LS.set('cb.draft.brew', null); api.render(); } });
      $('#ysel').addEventListener('change', function (e) { f.yeast.item = e.target.value; var it = byId(f.yeast.item); f.yeast.unit = it ? it.unit : ''; save(); draw(); });
      api.wireSegs(function (k, v) { if (k === 'ysrc') { f.yeast.source = v; save(); draw(); } });
      [['#yqty', 'qty'], ['#yfrom', 'fromBatch'], ['#yuse', 'use']].forEach(function (p) {
        var el = $(p[0]); if (el) el.addEventListener('input', function () { f.yeast[p[1]] = el.value; save(); });
      });
      $$('[data-plan]').forEach(function (row) {
        var i = +row.getAttribute('data-plan');
        row.querySelector('[data-p="step"]').addEventListener('change', function (e) { f.plans[i].step = e.target.value; save(); });
        row.querySelector('[data-p="due"]').addEventListener('change', function (e) { f.plans[i].due = e.target.value; save(); });
        row.querySelector('[data-pdel]').addEventListener('click', function () { f.plans.splice(i, 1); save(); draw(); });
      });
      $$('[data-pi]').forEach(function (inp) { inp.addEventListener('input', function () { f.plans[+inp.getAttribute('data-pi')].note = inp.value; save(); }); });
      $$('[data-addplan]').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault(); var st = a.getAttribute('data-addplan');
          f.plans.push({ step: st, due: CB.addDays(f.date || api.today(), STEP_DAYS[st] || 1), note: '' }); save(); draw();
        });
      });
      $('#discard').addEventListener('click', function () { if (confirm('Clear this brew sheet?')) { api.LS.set('cb.draft.brew', null); go('#brew'); } });
      $('#save').addEventListener('click', submit);
    }
    function submit() {
      var errs = [], st = api.state();
      f.batch = String(f.batch || '').trim();
      if (!more) {
        if (!CB.validBatch(f.batch)) errs.push('Batch number is 5 digits, like 26037.');
        else if (st.batches[f.batch]) errs.push('Batch ' + f.batch + ' already exists. To add a second brew day, use "Second brew day on a batch".');
      }
      if (!f.date || f.date > api.today()) errs.push('Pick the brew date.');
      if (!f.fermenter) errs.push('Choose the fermenter.');
      else CB.openBatches(st).forEach(function (x) { if (x.tank === f.fermenter && x.batch !== f.batch) errs.push(f.fermenter + ' already holds batch ' + x.batch + '.'); });
      if (f.intoHL && f.fermenter && n(f.intoHL) > CB.TANK_HL[f.fermenter]) errs.push(f.fermenter + ' only holds ' + CB.TANK_HL[f.fermenter] + ' hL.');
      var malts = finishLines(f.malts, errs, 'Malt'), hops = finishLines(f.hops, errs, 'Hops'), others = finishLines(f.others, errs, 'Other additions');
      var y = null;
      if (f.yeast.item) {
        var yi = byId(f.yeast.item);
        if (f.yeast.source === 'new') {
          if (!(n(f.yeast.qty) > 0)) errs.push('Enter how many ' + (yi ? yi.unit : 'bricks') + ' of yeast.');
          else if (yi) y = { item: yi.id, name: yi.name, source: 'new', qty: n(f.yeast.qty), unit: yi.unit, stockQty: n(f.yeast.qty), stockUnit: yi.unit };
        } else {
          if (!CB.validBatch(f.yeast.fromBatch)) errs.push('Enter the batch the yeast was cropped from.');
          else if (yi) y = { item: yi.id, name: yi.name, source: 'repitch', fromBatch: f.yeast.fromBatch, use: f.yeast.use || '' };
        }
      }
      f.plans.forEach(function (p) { if (!p.due) errs.push('Pick a date for "' + p.step + '".'); });
      if (errs.length) { $('#msg').innerHTML = '<div class="err">' + errs.map(esc).join('<br>') + '</div>'; $('#msg').scrollIntoView(); return; }

      var data = { batch: f.batch, beer: f.beer, day: day, date: f.date, fermenter: f.fermenter, malts: malts, hops: hops, others: others, yeast: y };
      ['intoHL', 'kettleHL', 'foundationL', 'strikeL', 'strikeTemp', 'mashIn', 'initialTemp', 'restTemp', 'rest', 'recirc', 'runoff',
        'mashPH', 'kettleGravity', 'kettlePH', 'boilMin', 'waterAddL', 'og', 'notes'].forEach(function (k) { data[k] = String(f[k] || '').trim(); });
      // The batch and steps made with this brew are linked to it, so one Undo takes them all back.
      var linked = [];
      if (!more) linked.push(api.addEvent('batch_new', { batch: f.batch, beer: f.beer, tank: f.fermenter, volumeHL: f.intoHL === '' ? '' : n(f.intoHL), date: f.date }).id);
      f.plans.forEach(function (p) { linked.push(api.addEvent('plan', { batch: f.batch, step: p.step, due: p.due, note: (p.note || '').trim() }).id); });
      data.linked = linked;
      var e = api.addEvent('brew', data);
      api.LS.set('cb.draft.brew', null);
      go('#saved/' + e.id);
    }
    draw();
    return {};
  };

  // ---------- planned steps ----------
  function actionFor(p) {
    return { 'Dry hop': '#addition/', 'Crop yeast': '#crop/', 'Transfer to brite': '#move/', 'Package': '#package/' }[p.step];
  }
  function dueHtml(s, days) {
    var limit = CB.addDays(api.today(), days), list = CB.openPlans(s).filter(function (p) { return p.due <= limit; });
    if (!list.length) return '';
    return '<h2>Due</h2><div class="card">' + list.map(function (p) {
      var late = p.due < api.today(), now = p.due === api.today();
      var href = actionFor(p);
      return '<div class="list-item"><div' + (href ? ' data-go="' + href + p.batch + '/' + p.id + '" style="cursor:pointer;flex:1"' : ' style="flex:1"') + '>' +
        '<b>' + esc(p.step) + '</b> · ' + esc(p.batch + ' ' + p.beer) + (p.note ? '<br><span class="muted">' + esc(p.note) + '</span>' : '') +
        '<br><span style="color:' + (late ? 'var(--bad)' : now ? 'var(--warn)' : 'var(--muted)') + ';font-size:15px">' +
        (late ? 'overdue · was ' : now ? 'today · ' : '') + prettyDate(p.due) + '</span></div>' +
        '<button class="small-btn" data-done="' + p.id + '">Done</button></div>';
    }).join('') + '</div>';
  }
  function wireDue() {
    $$('[data-done]').forEach(function (bt) {
      bt.addEventListener('click', function (ev) {
        ev.stopPropagation();
        api.addEvent('plan_done', { plan: bt.getAttribute('data-done'), date: api.today() }); api.render();
      });
    });
  }
  api.dueHtml = dueHtml; api.wireDue = wireDue;

  screens.plan = function (batch, planId) {
    var s = api.state(), b = s.batches[batch];
    if (!b) { go('#home'); return {}; }
    var old = planId ? s.plans[planId] : null;
    api.setHeader((old ? 'Change step · ' : 'Plan a step · ') + b.batch, true);
    var step = old ? old.step : 'Dry hop';
    api.app.innerHTML = '<p><b>' + esc(b.batch + ' ' + b.beer) + '</b> · ' + esc(b.tank) + '</p>' +
      '<label class="f">Step</label><select id="step">' + CB.STEPS.map(function (x) { return '<option' + (x === step ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>' +
      '<label class="f">Date</label><input type="date" id="due" value="' + esc(old ? old.due : CB.addDays(api.today(), 1)) + '">' +
      '<label class="f">Note</label><input id="note" value="' + esc(old ? old.note : '') + '" placeholder="e.g. Galaxy 4 kg">' +
      '<div id="msg"></div><button class="big" id="save" style="margin-top:18px">Save</button>' +
      (old ? '<button class="big alt" id="skip">Not needed — remove it</button>' : '');
    $('#save').addEventListener('click', function () {
      if (!$('#due').value) { $('#msg').innerHTML = '<div class="err">Pick the date.</div>'; return; }
      var d = { batch: b.batch, step: $('#step').value, due: $('#due').value, note: $('#note').value.trim() };
      if (old) d.replaces = old.id;
      api.addEvent('plan', d); go('#batch/' + b.batch);
    });
    var sk = $('#skip');
    if (sk) sk.addEventListener('click', function () { api.addEvent('void', { target: old.id }); go('#batch/' + b.batch); });
    return {};
  };

  // ---------- after brew day: additions, readings, cropping ----------
  screens.addition = function (batch, planId) {
    var s = api.state(), b = s.batches[batch];
    if (!b) { go('#home'); return {}; }
    var plan = planId ? s.plans[planId] : null;
    api.setHeader('Add to ' + b.batch, true);
    var f = { kind: plan && plan.step !== 'Dry hop' ? 'Other' : 'Dry hop', lines: [{ item: '', qty: '', unit: '' }], date: api.today(), note: plan ? plan.note : '' };
    var cfgs = { lines: { spots: ['Hop freezer', 'Brewing supplies', 'Grain room'] } };
    function draw() {
      var lv = levels();
      cfgs.lines.spots = f.kind === 'Dry hop' ? ['Hop freezer'] : ['Brewing supplies', 'Hop freezer', 'Grain room'];
      api.app.innerHTML = '<p><b>' + esc(b.batch + ' ' + b.beer) + '</b> · ' + esc(b.tank) + (plan ? '<br><span class="muted">Planned: ' + esc(plan.step) + (plan.note ? ' — ' + esc(plan.note) : '') + '</span>' : '') + '</p>' +
        api.seg('kind', [['Dry hop', 'Dry hop'], ['Fruit', 'Fruit'], ['Other', 'Other']], f.kind) +
        '<div class="card" style="margin-top:14px">' + f.lines.map(function (l, i) { return lineHtml('lines', i, l, cfgs.lines, lv); }).join('') +
        '<button type="button" class="small-btn" id="addl" style="margin-top:8px">+ Add a line</button></div>' +
        '<label class="f">Date</label><input type="date" id="date" value="' + esc(f.date) + '" max="' + api.today() + '">' +
        '<label class="f">Note</label><input id="note" value="' + esc(f.note) + '">' +
        '<div id="msg"></div><button class="big" id="save" style="margin-top:18px">Save</button>';
      wireLines(f, cfgs, function () {}, draw);
      api.wireSegs(function (k, v) { f.kind = v; draw(); });
      $('#addl').addEventListener('click', function () { f.lines.push({ item: '', qty: '', unit: '' }); draw(); });
      $('#date').addEventListener('change', function (e) { f.date = e.target.value; });
      $('#note').addEventListener('input', function (e) { f.note = e.target.value; });
      $('#save').addEventListener('click', function () {
        var errs = [], lines = finishLines(f.lines, errs, 'Additions');
        if (!lines.length && !errs.length) errs.push('Add at least one item.');
        if (errs.length) { $('#msg').innerHTML = '<div class="err">' + errs.map(esc).join('<br>') + '</div>'; return; }
        var e = api.addEvent('addition', { batch: b.batch, kind: f.kind, lines: lines, date: f.date, note: f.note.trim(), plan: planId || '' });
        go('#saved/' + e.id);
      });
    }
    draw();
    return {};
  };

  screens.reading = function (batch) {
    var b = api.state().batches[batch];
    if (!b) { go('#home'); return {}; }
    api.setHeader('Reading · ' + b.batch, true);
    api.app.innerHTML = '<p><b>' + esc(b.batch + ' ' + b.beer) + '</b> · ' + esc(b.tank) + '</p><div class="g2">' +
      '<div><label class="f">Gravity</label><input id="g" inputmode="decimal" placeholder="1.012"></div>' +
      '<div><label class="f">Temp (°C)</label><input id="t" inputmode="decimal" placeholder="15"></div>' +
      '<div><label class="f">pH</label><input id="ph" inputmode="decimal"></div>' +
      '<div><label class="f">Date</label><input type="date" id="date" value="' + api.today() + '" max="' + api.today() + '"></div></div>' +
      '<label class="f">Comment</label><input id="note" placeholder="e.g. dropped to 15°C">' +
      '<div id="msg"></div><button class="big" id="save" style="margin-top:18px">Save reading</button>';
    $('#save').addEventListener('click', function () {
      var d = { batch: b.batch, gravity: $('#g').value.trim(), temp: $('#t').value.trim(), ph: $('#ph').value.trim(), note: $('#note').value.trim(), date: $('#date').value };
      if (!d.gravity && !d.temp && !d.ph && !d.note) { $('#msg').innerHTML = '<div class="err">Enter at least one reading or a comment.</div>'; return; }
      var e = api.addEvent('reading', d); go('#saved/' + e.id);
    });
    return {};
  };

  screens.crop = function (batch, planId) {
    var b = api.state().batches[batch];
    if (!b) { go('#home'); return {}; }
    api.setHeader('Crop yeast · ' + b.batch, true);
    var first = b.brews[0] && b.brews[0].data.yeast;
    var useNo = first ? (first.source === 'new' ? 1 : n(first.use) || '') : '';
    api.app.innerHTML = '<p><b>' + esc(b.batch + ' ' + b.beer) + '</b> · ' + esc(b.tank) + '</p>' +
      '<label class="f">Yeast</label><input id="y" value="' + esc(first ? first.name + (useNo ? ', from use ' + useNo : '') : '') + '">' +
      '<label class="f">Amount (optional)</label><input id="amt" placeholder="e.g. 20 L slurry">' +
      '<label class="f">Date</label><input type="date" id="date" value="' + api.today() + '" max="' + api.today() + '">' +
      '<label class="f">Note</label><input id="note">' +
      '<button class="big" id="save" style="margin-top:18px">Save</button>';
    $('#save').addEventListener('click', function () {
      var e = api.addEvent('crop', { batch: b.batch, yeast: $('#y').value.trim(), amount: $('#amt').value.trim(), date: $('#date').value, note: $('#note').value.trim(), plan: planId || '' });
      go('#saved/' + e.id);
    });
    return {};
  };

  // ---------- stock: deliveries, new items, on hand ----------
  screens.receive = function () {
    api.setHeader('Add to stock', true);
    var f = { lines: [{ item: '', qty: '', unit: '' }] };
    var cfgs = { lines: { spots: ['Grain room', 'Hop freezer', 'Yeast fridge', 'Brewing supplies', 'Packaging storage'] } };
    function draw() {
      api.app.innerHTML = '<p class="muted">A delivery that just came in, or something new for the list. The invoice still sets the price.</p>' +
        '<div class="card">' + f.lines.map(function (l, i) { return lineHtml('lines', i, l, cfgs.lines, levels()); }).join('') +
        '<button type="button" class="small-btn" id="addl" style="margin-top:8px">+ Add a line</button></div>' +
        '<label class="f">Supplier</label><input id="sup" placeholder="e.g. Country Malt">' +
        '<label class="f">Date</label><input type="date" id="date" value="' + api.today() + '" max="' + api.today() + '">' +
        '<label class="f">Note</label><input id="note" placeholder="e.g. invoice number">' +
        '<div id="msg"></div><button class="big" id="save" style="margin-top:18px">Add to stock</button>';
      wireLines(f, cfgs, function () {}, draw);
      $('#addl').addEventListener('click', function () { f.lines.push({ item: '', qty: '', unit: '' }); draw(); });
      $('#save').addEventListener('click', function () {
        var errs = [], lines = finishLines(f.lines, errs, 'Stock');
        if (!lines.length && !errs.length) errs.push('Add at least one item.');
        if (errs.length) { $('#msg').innerHTML = '<div class="err">' + errs.map(esc).join('<br>') + '</div>'; return; }
        var last;
        lines.forEach(function (l) {
          last = api.addEvent('receive', { item: l.item, name: l.name, qty: l.qty, unit: l.unit, stockQty: l.stockQty, stockUnit: l.stockUnit,
            supplier: $('#sup').value.trim(), date: $('#date').value, note: $('#note').value.trim() });
        });
        go('#saved/' + last.id);
      });
    }
    draw();
    return {};
  };

  screens.stocknow = function () {
    api.setHeader('Stock on hand', true);
    var lv = levels(), spots = [];
    brewery().forEach(function (it) { if (spots.indexOf(it.spot) < 0) spots.push(it.spot); });
    api.app.innerHTML = '<p class="muted">Last count, plus what came in, minus what brew days, additions and packaging used. The month-end count shows the difference as waste.</p>' +
      spots.map(function (sp) {
        var list = brewery().filter(function (it) { return it.spot === sp; }).sort(function (a, b) { return a.order - b.order; });
        return '<h2>' + esc(sp) + '</h2><div class="card">' + list.map(function (it) {
          var o = lv[it.id];
          var moved = o.received || o.used || o.adjusted;
          return '<div class="list-item"><div>' + esc(it.name) + '<br><span class="muted" style="font-size:14px">' +
            (o.counted ? 'counted ' + prettyDate(o.counted.date) + ': ' + show(o.base) + ' ' + esc(it.unit) : 'not counted yet') +
            (moved ? ' · since: ' + (o.received ? '+' + show(o.received) + ' in ' : '') + (o.used ? '−' + show(o.used) + ' used ' : '') + (o.adjusted ? '−' + show(o.adjusted) + ' written off' : '') : '') +
            (o.unconverted ? ' · ' + o.unconverted + ' entries in other units not taken off' : '') +
            '</span></div><div style="text-align:right;font-weight:700;white-space:nowrap">' + esc(onHandText(o)) + '</div></div>';
        }).join('') + '</div>';
      }).join('');
    return { refreshOnSync: true };
  };
};
