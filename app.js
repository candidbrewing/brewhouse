// Candid Brewhouse — phone app. Screens, local storage and syncing to the Google Sheet.
// Every entry is saved on the phone first, then sent when there is a connection.

(function () {
  'use strict';

  // ---------- storage (phone) ----------
  var LS = {
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  var settings = LS.get('cb.settings', { url: '', key: '', by: 'Bryan' });
  var serverEvents = LS.get('cb.server', []);   // last copy received from the Sheet
  var pending = LS.get('cb.pending', []);       // saved on the phone, not yet sent
  var syncState = { busy: false, error: '', last: LS.get('cb.lastSync', '') };

  function saveLocal() { LS.set('cb.server', serverEvents); LS.set('cb.pending', pending); }

  function state() {
    var seen = {};
    serverEvents.forEach(function (e) { seen[e.id] = true; });
    return CB.reduce(serverEvents.concat(pending.filter(function (e) { return !seen[e.id]; })));
  }

  function newId() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function addEvent(type, data) {
    var e = { id: newId(), type: type, at: new Date().toISOString(), by: settings.by || '', data: data };
    pending.push(e);
    saveLocal();
    sync();
    return e;
  }

  // ---------- sync ----------
  function apiUrl() {
    if (settings.url) return settings.url;
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return '/api'; // test server
    return '';
  }

  function sync() {
    var url = apiUrl();
    if (!url || syncState.busy) { paintSync(); return; }
    syncState.busy = true; paintSync();
    var sending = pending.slice();
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
    // text/plain avoids a CORS pre-check, which Google Apps Script cannot answer
    fetch(url, { method: 'POST', body: JSON.stringify({ key: settings.key, events: sending }),
      signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('Server said ' + r.status); return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || 'Server refused the entries');
        serverEvents = res.events || [];
        var have = {};
        serverEvents.forEach(function (e) { have[e.id] = true; });
        pending = pending.filter(function (e) { return !have[e.id]; });
        syncState.error = ''; syncState.last = new Date().toISOString();
        LS.set('cb.lastSync', syncState.last);
        saveLocal();
      })
      .catch(function (err) {
        syncState.error = navigator.onLine === false ? 'No connection' : (err.name === 'AbortError' ? 'Timed out' : err.message);
      })
      .then(function () {
        clearTimeout(timer);
        syncState.busy = false; paintSync();
        if (current.refreshOnSync) render();
      });
  }

  function paintSync() {
    var el = document.getElementById('sync');
    var n = pending.length;
    if (!apiUrl()) { el.className = 'pill bad'; el.textContent = 'Not connected'; return; }
    if (syncState.busy) { el.className = 'pill'; el.textContent = 'Sending…'; return; }
    if (n) { el.className = 'pill wait'; el.textContent = n + ' waiting to send'; return; }
    if (syncState.error) { el.className = 'pill bad'; el.textContent = syncState.error; return; }
    el.className = 'pill ok'; el.textContent = '✓ All sent';
  }

  window.addEventListener('online', sync);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
  setInterval(function () { if (pending.length) sync(); }, 30000);

  // ---------- helpers ----------
  var app = document.getElementById('app');
  var current = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hl(n) { return n == null ? '?' : CB.round(n, 2).toFixed(2); }
  function inTank(b) { return b.level == null ? 'volume not recorded' : hl(b.level) + (CB.TANK_HL[b.tank] ? ' of ' + CB.TANK_HL[b.tank] : '') + ' hL in tank'; }
  function today() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function go(hash) { location.hash = hash; }
  function $(sel) { return app.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(app.querySelectorAll(sel)); }
  function prettyDate(iso) {
    var p = String(iso).split('-');
    var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1];
    return m ? m + ' ' + (+p[2]) : iso;
  }
  function countsText(c) {
    return CB.SIZES.filter(function (s) { return +c[s.key] > 0; })
      .map(function (s) { return c[s.key] + ' × ' + s.label.replace(' kegs', '').replace(' cans', ''); }).join(', ');
  }
  function beerOptions(sel) {
    return '<option value="">Choose…</option>' + CB.BEERS.map(function (b) {
      return '<option' + (b.name === sel ? ' selected' : '') + '>' + esc(b.name) + '</option>';
    }).join('') + '<option value="__other">Other (type the name)…</option>';
  }
  function tankOptions(sel) {
    return '<option value="">Choose…</option>' + CB.TANKS.map(function (t) {
      return '<option value="' + t + '"' + (t === sel ? ' selected' : '') + '>' + t + (CB.TANK_HL[t] ? ' (' + CB.TANK_HL[t] + ' hL)' : '') + '</option>';
    }).join('');
  }
  function seg(name, opts, on) {
    return '<div class="seg" data-seg="' + name + '">' + opts.map(function (o) {
      return '<button type="button" data-v="' + esc(o[0]) + '" class="' + (o[0] === on ? 'on' : '') + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function wireSegs(onChange) {
    $$('[data-seg]').forEach(function (g) {
      g.addEventListener('click', function (ev) {
        var b = ev.target.closest('button'); if (!b) return;
        g.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        onChange(g.getAttribute('data-seg'), b.getAttribute('data-v'));
      });
    });
  }
  function batchTile(b, href) {
    return '<button class="tile" data-go="' + href + '"><div class="tank">' + esc(b.tank || '—') + ' · ' + esc(b.batch) +
      '</div><div class="beer">' + esc(b.beer || '?') + '</div><div class="meta">' + inTank(b) + '</div></button>';
  }
  function wireGo() {
    $$('[data-go]').forEach(function (el) {
      el.addEventListener('click', function () { go(el.getAttribute('data-go')); });
    });
  }
  function setHeader(title, back) {
    document.getElementById('title').textContent = title;
    document.getElementById('back').hidden = !back;
  }
  document.getElementById('back').addEventListener('click', function () { history.back(); });

  // ---------- screens ----------
  var screens = {};

  screens.home = function () {
    setHeader('Candid Brewhouse', false);
    var s = state();
    var open = CB.openBatches(s);
    app.innerHTML =
      '<button class="big" data-go="#pack">Packaging day</button>' +
      '<button class="big alt" disabled>Brew day <span class="chip">coming next</span></button>' +
      '<h2>In the tanks</h2>' +
      (open.length ? '<div class="tiles">' + open.map(function (b) { return batchTile(b, '#batch/' + b.batch); }).join('') + '</div>'
        : '<p class="muted">No batches yet. Add the ones in the tanks now.</p>') +
      '<div style="height:14px"></div><button class="big alt" data-go="#new">+ New batch</button>' +
      '<div class="row-btns"><button class="big alt" data-go="#recent">Recent entries</button>' +
      '<button class="big alt" data-go="#report">Month report</button></div>' +
      '<button class="big alt" data-go="#settings">Settings</button>';
    wireGo();
    return { refreshOnSync: true };
  };

  screens.pack = function () {
    setHeader('Start a packaging run', true);
    var open = CB.openBatches(state());
    app.innerHTML = (open.length
      ? '<p><b>Tap the tank you’re packaging from.</b><br><span class="muted">Next you’ll enter the cans and kegs filled.</span></p><div class="tiles">' +
        open.map(function (b) { return batchTile(b, '#package/' + b.batch); }).join('') + '</div>'
      : '<p><b>No tanks are loaded yet.</b><br><span class="muted">They appear here once the app is connected to the Sheet.</span></p>') +
      '<div style="height:18px"></div><button class="big alt" data-go="#new/pack" style="min-height:64px;font-size:19px">Tank missing? Add it</button>';
    wireGo();
    return { refreshOnSync: true };
  };

  screens.package = function (id) {
    var b = state().batches[id];
    if (!b) return screens.missing(id);
    setHeader('Packaging run · ' + b.beer, true);
    var f = { counts: {}, leftHL: '', date: today(), note: '' };
    CB.SIZES.forEach(function (sz) { f.counts[sz.key] = ''; });

    app.innerHTML =
      '<div class="card"><b>' + esc(b.beer) + '</b> · ' + esc(b.batch) + ' · ' + esc(b.tank) +
      '<br><span class="muted">' + (b.level == null ? 'Tank volume not recorded' : hl(b.level) + ' hL in the tank before this run') +
      (CB.beerIsExcise(b.beer) ? '' : ' · not on the excise list') + '</span></div>' +
      CB.SIZES.map(function (sz) {
        return '<div class="count"><div class="lbl">' + sz.label + (sz.key === 'k20' ? '<small>filled to 19.5 L</small>' : '') +
          '</div><button type="button" data-minus="' + sz.key + '">−</button>' +
          '<input inputmode="numeric" pattern="[0-9]*" data-count="' + sz.key + '" placeholder="0" aria-label="' + sz.label + '">' +
          '<button type="button" data-plus="' + sz.key + '">+</button></div>';
      }).join('') +
      '<label class="f">Left in tank after this run (hL)</label>' +
      '<div class="row-btns"><input inputmode="decimal" id="left" placeholder="e.g. 9" style="flex:1 1 50%">' +
      '<button type="button" class="small-btn" id="empty" style="flex:1 1 40%;min-height:56px;font-size:19px">Tank empty (0)</button></div>' +
      '<div id="live"></div>' +
      '<label class="f">Date packaged</label><input type="date" id="date" value="' + f.date + '" max="' + today() + '">' +
      '<label class="f">Note (optional)</label><input id="note" placeholder="e.g. 2 cases seconds">' +
      '<div id="msg"></div>' +
      '<button class="big" id="save" style="margin-top:18px">Save</button>';

    function live() {
      var packed = CB.hlOf(f.counts);
      var expected = b.level == null ? null : CB.round(b.level - packed, 4);
      var h = '<div class="sum"><div class="grid"><div><div class="n">' + hl(packed) + '</div><div class="l">hL packaged</div></div>';
      if (expected == null) {
        h += '';
      } else if (f.leftHL !== '') {
        var loss = CB.round(expected - parseFloat(f.leftHL), 4);
        h += '<div><div class="n">' + hl(Math.max(loss, 0)) + '</div><div class="l">hL spillage (no excise)</div></div>';
      } else {
        h += '<div><div class="n">' + hl(Math.max(expected, 0)) + '</div><div class="l">hL should be left</div></div>';
      }
      h += '</div></div>';
      if (expected != null && f.leftHL !== '' && parseFloat(f.leftHL) > expected + 0.05) {
        h += '<div class="warn">More left in the tank than should be possible. Check the counts, or the tank volume was higher than recorded.</div>';
      }
      if (b.level != null && packed > b.level + 0.05) {
        h += '<div class="warn">This is more than the ' + hl(b.level) + ' hL recorded in the tank. Check the counts.</div>';
      }
      $('#live').innerHTML = h;
    }

    $$('[data-count]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        inp.value = inp.value.replace(/[^0-9]/g, '');
        f.counts[inp.getAttribute('data-count')] = inp.value; live();
      });
    });
    function bump(key, dir) {
      var sz = CB.SIZES.filter(function (x) { return x.key === key; })[0];
      var v = Math.max(0, (parseInt(f.counts[key], 10) || 0) + dir * sz.step);
      f.counts[key] = v ? String(v) : '';
      $('[data-count="' + key + '"]').value = f.counts[key]; live();
    }
    $$('[data-plus]').forEach(function (bt) { bt.addEventListener('click', function () { bump(bt.getAttribute('data-plus'), 1); }); });
    $$('[data-minus]').forEach(function (bt) { bt.addEventListener('click', function () { bump(bt.getAttribute('data-minus'), -1); }); });
    $('#left').addEventListener('input', function (e) { e.target.value = e.target.value.replace(/[^0-9.]/g, ''); f.leftHL = e.target.value; live(); });
    $('#empty').addEventListener('click', function () { f.leftHL = '0'; $('#left').value = '0'; live(); });
    live();

    $('#save').addEventListener('click', function () {
      f.date = $('#date').value; f.note = $('#note').value.trim();
      var errs = [];
      var counts = {};
      CB.SIZES.forEach(function (sz) { counts[sz.key] = parseInt(f.counts[sz.key], 10) || 0; });
      if (!CB.hlOf(counts)) errs.push('Enter at least one can or keg count.');
      if (f.leftHL === '' || isNaN(parseFloat(f.leftHL))) errs.push('Enter what is left in the tank (tap “Tank empty” if nothing).');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) errs.push('Pick the date packaged.');
      else if (f.date > today()) errs.push('The date can’t be in the future.');
      if (errs.length) { $('#msg').innerHTML = '<div class="err">' + errs.map(esc).join('<br>') + '</div>'; return; }
      var e = addEvent('package', { batch: b.batch, date: f.date, counts: counts, leftHL: parseFloat(f.leftHL), note: f.note });
      go('#saved/' + e.id);
    });
    return {};
  };

  screens.saved = function (eid) {
    setHeader('Saved', false);
    var all = serverEvents.concat(pending);
    var e = all.filter(function (x) { return x.id === eid; })[0];
    var s = state();
    if (!e) { go('#home'); return {}; }
    var undone = !!s.voided[eid];
    var d = e.data;
    var what = '';
    if (e.type === 'package') {
      var b = s.batches[d.batch] || {};
      what = '<b>' + esc(d.batch) + ' ' + esc(b.beer) + '</b><br>' + esc(countsText(d.counts)) +
        '<br><b>' + hl(CB.hlOf(d.counts)) + ' hL</b> · ' + hl(d.leftHL) + ' hL left · ' + prettyDate(d.date);
    } else {
      what = esc(describe(e, s));
    }
    app.innerHTML = undone
      ? '<div class="done"><div class="tick" style="color:var(--bad)">↺</div><h2>Undone</h2><p>That entry has been cancelled.</p></div>' +
        '<button class="big" data-go="#home">Home</button>'
      : '<div class="done"><div class="tick">✓</div><h2>Saved</h2><p>' + what + '</p>' +
        '<p class="muted">' + (pending.some(function (p) { return p.id === eid; }) ? 'Saved on this phone. It will send when there is wifi.' : 'Sent to the Sheet.') + '</p></div>' +
        '<button class="big" data-go="#home">Done</button>' +
        (e.type === 'package' ? '<button class="big alt" data-go="#pack">Start another packaging run</button>' : '') +
        '<button class="big alt" id="undo">Undo — I made a mistake</button>';
    wireGo();
    var u = $('#undo');
    if (u) u.addEventListener('click', function () { addEvent('void', { target: eid }); render(); });
    return { refreshOnSync: true };
  };

  screens.batch = function (id) {
    var s = state();
    var b = s.batches[id];
    if (!b) return screens.missing(id);
    setHeader(b.batch + ' ' + b.beer, true);
    app.innerHTML =
      '<div class="card"><div class="tank muted">' + esc(b.tank) + ' · ' + esc(b.status) + '</div>' +
      '<div style="font-size:30px;font-weight:800">' + (b.level == null ? 'Volume not recorded' : hl(b.level) + ' hL') + '</div><div class="muted">in tank now' + (b.startHL != null ? ' · started at ' + hl(b.startHL) + ' hL' : '') +
      (b.date ? ' · brewed ' + prettyDate(b.date) : '') + '</div>' +
      (b.receivedFrom.length ? '<div class="muted">Received: ' + b.receivedFrom.map(function (r) { return hl(r.volumeHL) + ' hL from ' + r.batch; }).join(', ') + '</div>' : '') +
      '</div>' +
      (b.status === 'open' ? '<button class="big" data-go="#package/' + b.batch + '">New packaging run</button>' +
        '<div class="row-btns"><button class="big alt" data-go="#move/' + b.batch + '">Moved tank</button>' +
        '<button class="big alt" data-go="#combine/' + b.batch + '">Combine into…</button></div>' +
        '<button class="big alt" data-go="#dump/' + b.batch + '">Dump</button>' : '') +
      '<h2>Packaging runs</h2>' +
      (b.runs.length ? '<div class="card">' + b.runs.map(function (r) {
        return '<div class="list-item"><div><b>' + prettyDate(r.date) + '</b> · ' + esc(countsText(r)) + '<br><span class="muted">' +
          hl(r.hL) + ' hL · left ' + hl(r.leftHL) + ' hL</span></div></div>';
      }).join('') + '</div>' : '<p class="muted">None yet.</p>') +
      '<p class="muted">Packaged in total: ' + hl(b.packagedHL) + ' hL · spillage/loss: ' + hl(b.lossHL) + ' hL</p>';
    wireGo();
    return { refreshOnSync: true };
  };

  screens['new'] = function (from) {
    var forPack = from === 'pack';
    setHeader(forPack ? 'Add the tank you’re packaging from' : 'New batch', true);
    var s = state();
    var f = { batch: CB.nextBatchNumber(s, today()), beer: '', tank: '', volumeHL: '', date: today() };
    var busyTanks = {};
    CB.openBatches(s).forEach(function (b) { busyTanks[b.tank] = b.batch; });
    app.innerHTML =
      '<label class="f">Batch number</label><input id="batch" inputmode="numeric" pattern="[0-9]*" maxlength="5" placeholder="26035" value="' + esc(f.batch) + '">' +
      '<label class="f">Beer</label><select id="beer">' + beerOptions('') + '</select>' +
      '<input id="beerOther" placeholder="Beer name" style="margin-top:8px" hidden>' +
      '<label class="f">Tank it is in now</label><select id="tank">' + tankOptions('') + '</select>' +
      '<label class="f">' + (forPack ? 'Volume in the tank before packaging (hL)' : 'Volume in that tank now (hL)') + '</label><input id="vol" inputmode="decimal" placeholder="e.g. 10">' +
      '<p class="muted">Leave blank if you haven’t measured it.</p>' +
      '<label class="f">Brew date</label><input type="date" id="date" value="' + f.date + '" max="' + today() + '">' +
      '<div id="msg"></div><button class="big" id="save" style="margin-top:18px">' + (forPack ? 'Next: cans and kegs' : 'Save batch') + '</button>';
    $('#beer').addEventListener('change', function (e) { $('#beerOther').hidden = e.target.value !== '__other'; });
    $('#save').addEventListener('click', function () {
      f.batch = $('#batch').value.trim(); f.beer = $('#beer').value; f.tank = $('#tank').value;
      if (f.beer === '__other') f.beer = $('#beerOther').value.trim();
      f.volumeHL = $('#vol').value.trim(); f.date = $('#date').value;
      var errs = [];
      if (!CB.validBatch(f.batch)) errs.push('Batch number is 5 digits, like 26035.');
      else if (s.batches[f.batch]) errs.push('Batch ' + f.batch + ' already exists.');
      if (!f.beer) errs.push('Choose the beer.');
      if (!f.tank) errs.push('Choose the tank.');
      else if (busyTanks[f.tank]) errs.push(f.tank + ' already holds batch ' + busyTanks[f.tank] + '. Package, move or empty that first.');
      if (f.volumeHL !== '' && !(parseFloat(f.volumeHL) > 0)) errs.push('Volume must be a number of hL.');
      else if (f.volumeHL !== '' && CB.TANK_HL[f.tank] && parseFloat(f.volumeHL) > CB.TANK_HL[f.tank]) errs.push(f.tank + ' only holds ' + CB.TANK_HL[f.tank] + ' hL.');
      if (!f.date) errs.push('Pick the brew date.');
      if (errs.length) { $('#msg').innerHTML = '<div class="err">' + errs.map(esc).join('<br>') + '</div>'; return; }
      var e = addEvent('batch_new', { batch: f.batch, beer: f.beer, tank: f.tank, volumeHL: f.volumeHL === '' ? '' : parseFloat(f.volumeHL), date: f.date });
      if (forPack) location.replace('#package/' + f.batch); else go('#saved/' + e.id);
    });
    return {};
  };

  screens.move = function (id) {
    var s = state(); var b = s.batches[id];
    if (!b) return screens.missing(id);
    setHeader('Move ' + b.batch, true);
    var busy = {};
    CB.openBatches(s).forEach(function (x) { if (x.batch !== b.batch) busy[x.tank] = x.batch; });
    app.innerHTML = '<p>Now in <b>' + esc(b.tank) + '</b> (' + inTank(b) + ').</p>' +
      '<label class="f">Moved to</label><select id="tank">' + tankOptions('') + '</select>' +
      '<label class="f">Volume in the new tank (hL)</label><input id="vol" inputmode="decimal" placeholder="' + (b.level == null ? 'e.g. 10' : hl(b.level)) + '">' +
      '<p class="muted">Leave blank if you didn’t measure it.</p>' +
      '<div id="msg"></div><button class="big" id="save">Save move</button>';
    $('#save').addEventListener('click', function () {
      var tank = $('#tank').value, vol = $('#vol').value.trim(), errs = [];
      if (!tank) errs.push('Choose the tank.');
      else if (tank === b.tank) errs.push('That’s the tank it is already in.');
      else if (busy[tank]) errs.push(tank + ' already holds batch ' + busy[tank] + '.');
      if (vol !== '' && !(parseFloat(vol) > 0)) errs.push('Volume must be a number of hL.');
      else if (tank && CB.TANK_HL[tank] && vol !== '' && parseFloat(vol) > CB.TANK_HL[tank]) errs.push(tank + ' only holds ' + CB.TANK_HL[tank] + ' hL.');
      if (errs.length) { $('#msg').innerHTML = '<div class="err">' + errs.map(esc).join('<br>') + '</div>'; return; }
      var e = addEvent('transfer', { batch: b.batch, tank: tank, volumeHL: vol === '' ? '' : parseFloat(vol), date: today() });
      go('#saved/' + e.id);
    });
    return {};
  };

  screens.combine = function (id) {
    var s = state(); var b = s.batches[id];
    if (!b) return screens.missing(id);
    setHeader('Combine ' + b.batch, true);
    var others = CB.openBatches(s).filter(function (x) { return x.batch !== b.batch; });
    var f = { into: '', empty: 'yes' };
    app.innerHTML = '<p>Pour <b>' + esc(b.batch) + ' ' + esc(b.beer) + '</b> (' + inTank(b) + ') into which batch?</p>' +
      (others.length ? '<div class="tiles">' + others.map(function (x) {
        return '<button class="tile" data-into="' + x.batch + '"><div class="tank">' + esc(x.tank) + ' · ' + x.batch + '</div><div class="beer">' + esc(x.beer) + '</div></button>';
      }).join('') + '</div>' : '<p class="muted">No other open batches.</p>') +
      '<label class="f">Volume poured in (hL)</label><input id="vol" inputmode="decimal" value="' + (b.level == null ? '' : hl(b.level)) + '">' +
      '<label class="f">Is ' + esc(b.batch) + '’s tank empty now?</label>' + seg('empty', [['yes', 'Yes, empty'], ['no', 'No, some left']], 'yes') +
      '<div id="msg"></div><button class="big" id="save" style="margin-top:18px">Save</button>';
    $$('[data-into]').forEach(function (t) {
      t.addEventListener('click', function () {
        f.into = t.getAttribute('data-into');
        $$('[data-into]').forEach(function (x) { x.style.borderColor = x === t ? 'var(--accent)' : ''; });
      });
    });
    wireSegs(function (k, v) { f[k] = v; });
    $('#save').addEventListener('click', function () {
      var vol = parseFloat($('#vol').value), errs = [];
      if (!f.into) errs.push('Tap the batch it went into.');
      else {
        var dest = s.batches[f.into], cap = CB.TANK_HL[dest.tank];
        if (cap && dest.level != null && dest.level + vol > cap) errs.push(dest.tank + ' only holds ' + cap + ' hL; it would have ' + hl(dest.level + vol) + ' hL.');
      }
      if (!(vol > 0)) errs.push('Enter the volume in hL.');
      if (errs.length) { $('#msg').innerHTML = '<div class="err">' + errs.map(esc).join('<br>') + '</div>'; return; }
      var e = addEvent('combine', { from: b.batch, into: f.into, volumeHL: vol, fromEmpty: f.empty === 'yes', date: today() });
      go('#saved/' + e.id);
    });
    return {};
  };

  screens.dump = function (id) {
    var s = state(); var b = s.batches[id];
    if (!b) return screens.missing(id);
    setHeader('Dump ' + b.batch, true);
    var f = { where: 'tank', emptied: 'yes' };
    app.innerHTML = '<p><b>' + esc(b.batch) + ' ' + esc(b.beer) + '</b> · ' + esc(b.tank) + ' · ' + inTank(b) + '</p>' +
      '<label class="f">Dumped from</label>' + seg('where', [['tank', 'The tank'], ['packaged', 'Cans / kegs']], 'tank') +
      '<label class="f">Volume dumped (hL)</label><input id="vol" inputmode="decimal" value="' + (b.level == null ? '' : hl(b.level)) + '">' +
      '<label class="f">Why?</label><input id="reason" placeholder="e.g. infected, off flavour">' +
      '<label class="f">Is the tank empty now?</label>' + seg('emptied', [['yes', 'Yes'], ['no', 'No']], 'yes') +
      '<div id="msg"></div><button class="big" id="save" style="margin-top:18px">Save dump</button>';
    wireSegs(function (k, v) { f[k] = v; });
    $('#save').addEventListener('click', function () {
      var vol = parseFloat($('#vol').value), reason = $('#reason').value.trim(), errs = [];
      if (!(vol > 0)) errs.push('Enter the volume in hL.');
      if (!reason) errs.push('Say why — it goes on the record.');
      if (errs.length) { $('#msg').innerHTML = '<div class="err">' + errs.map(esc).join('<br>') + '</div>'; return; }
      var e = addEvent('dump', { batch: b.batch, where: f.where, volumeHL: vol, reason: reason, emptied: f.emptied === 'yes', date: today() });
      go('#saved/' + e.id);
    });
    return {};
  };

  function describe(e, s) {
    var d = e.data || {}, beer = (s.batches[d.batch] || {}).beer || '';
    switch (e.type) {
      case 'batch_new': return 'New batch ' + d.batch + ' ' + d.beer + ' in ' + d.tank + ', ' + hl(d.volumeHL) + ' hL';
      case 'package': return 'Packaging run ' + d.batch + ' ' + beer + ': ' + countsText(d.counts) + ' = ' + hl(CB.hlOf(d.counts)) + ' hL, ' + hl(d.leftHL) + ' hL left';
      case 'transfer': return 'Moved ' + d.batch + ' ' + beer + ' to ' + d.tank + (d.volumeHL !== '' ? ', ' + hl(d.volumeHL) + ' hL' : '');
      case 'combine': return 'Combined ' + hl(d.volumeHL) + ' hL of ' + d.from + ' into ' + d.into;
      case 'dump': return 'Dumped ' + hl(d.volumeHL) + ' hL of ' + d.batch + ' ' + beer + ' from the ' + (d.where === 'packaged' ? 'packages' : 'tank') + ': ' + d.reason;
      default: return e.type;
    }
  }

  screens.recent = function () {
    setHeader('Recent entries', true);
    var s = state();
    var waiting = {};
    pending.forEach(function (p) { waiting[p.id] = true; });
    var list = s.events.slice(-30).reverse();
    app.innerHTML = list.length ? '<div class="card">' + list.map(function (e) {
      return '<div class="list-item"><div>' + esc(describe(e, s)) + '<br><span class="muted">' +
        prettyDate((e.data && e.data.date) || e.at.slice(0, 10)) + (waiting[e.id] ? ' · <b>waiting to send</b>' : '') +
        '</span></div><button class="small-btn" data-undo="' + e.id + '">Undo</button></div>';
    }).join('') + '</div>' : '<p class="muted">Nothing yet.</p>';
    $$('[data-undo]').forEach(function (bt) {
      bt.addEventListener('click', function () {
        if (confirm('Cancel this entry? It stays in the log, marked as undone.')) {
          addEvent('void', { target: bt.getAttribute('data-undo') }); render();
        }
      });
    });
    return { refreshOnSync: true };
  };

  screens.report = function () {
    setHeader('Month report', true);
    var month = current.month || today().slice(0, 7);
    function draw() {
      var s = state(), m = CB.monthSummary(s, month), t = m.exciseTotals;
      var dumps = s.dumps.filter(function (d) { return String(d.date).slice(0, 7) === month; });
      var cols = ['c355', 'c473', 'k20', 'k50', 'k58'];
      $('#out').innerHTML =
        (m.rows.length ? '<div class="scroll"><table><tr><th>Date</th><th>Batch</th><th>Beer</th><th>355</th><th>473</th><th>20L</th><th>50L</th><th>58.6L</th><th>hL</th><th>Excise</th></tr>' +
          m.rows.map(function (r) {
            return '<tr><td>' + prettyDate(r.date) + '</td><td>' + r.batch + '</td><td>' + esc(r.beer) + '</td>' +
              cols.map(function (c) { return '<td>' + (r[c] || '') + '</td>'; }).join('') + '<td>' + hl(r.hL) + '</td><td>' + r.excise + '</td></tr>';
          }).join('') +
          '<tr style="font-weight:700"><td colspan="3">Excise total</td>' + cols.map(function (c) { return '<td>' + t[c] + '</td>'; }).join('') +
          '<td>' + CB.round(t.hL, 4) + '</td><td></td></tr></table></div>'
          : '<p class="muted">No packaging recorded this month.</p>') +
        (dumps.length ? '<h2>Dumps</h2><div class="card">' + dumps.map(function (d) {
          return '<div class="list-item"><div>' + prettyDate(d.date) + ' · ' + d.batch + ' ' + esc(d.beer) + ' · ' + hl(d.volumeHL) + ' hL from the ' + d.where + '<br><span class="muted">' + esc(d.reason) + '</span></div></div>';
        }).join('') + '</div>' : '');
    }
    app.innerHTML = '<label class="f">Month</label><input type="month" id="month" value="' + month + '"><div style="height:14px"></div><div id="out"></div>';
    $('#month').addEventListener('change', function (e) { month = current.month = e.target.value; draw(); });
    draw();
    return { refreshOnSync: false, month: month };
  };

  screens.settings = function () {
    setHeader('Settings', true);
    app.innerHTML =
      '<label class="f">Your name</label><input id="by" value="' + esc(settings.by) + '">' +
      '<label class="f">Sheet link (from Louise)</label><input id="url" value="' + esc(settings.url) + '" placeholder="https://script.google.com/…" autocapitalize="off" autocorrect="off">' +
      '<label class="f">Access code (from Louise)</label><input id="key" value="' + esc(settings.key) + '" autocapitalize="off" autocorrect="off">' +
      '<div style="height:18px"></div><button class="big" id="save">Save and send now</button>' +
      '<p class="muted">' + pending.length + ' entries waiting on this phone. Last sent: ' + (syncState.last ? new Date(syncState.last).toLocaleString() : 'never') + '</p>';
    $('#save').addEventListener('click', function () {
      settings = { by: $('#by').value.trim(), url: $('#url').value.trim(), key: $('#key').value.trim() };
      LS.set('cb.settings', settings); sync(); go('#home');
    });
    return {};
  };

  screens.missing = function (id) {
    setHeader('Not found', true);
    app.innerHTML = '<p>Batch ' + esc(id) + ' isn’t in the app.</p><button class="big" data-go="#home">Home</button>';
    wireGo();
    return {};
  };

  // ---------- router ----------
  function render() {
    var h = (location.hash || '#home').slice(1).split('/');
    var fn = screens[h[0]] || screens.home;
    var keepMonth = current.month;
    current = fn(h[1] ? decodeURIComponent(h[1]) : undefined) || {};
    if (keepMonth && !current.month) current.month = keepMonth;
    window.scrollTo(0, 0);
    paintSync();
  }
  window.addEventListener('hashchange', render);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  render();
  sync();
})();
