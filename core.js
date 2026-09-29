// Candid Brewhouse — shared rules. Used by the phone app AND by the Google Apps Script
// that writes the Sheet, so both sides always compute the same numbers.
//
// Everything Bryan does is saved as an "event" (new batch, packaging run, dump, ...).
// The current state of every tank is worked out by replaying the events in order.

var CB = (function () {
  // Package sizes. A "20 L" keg is filled to 19.5 L — do not change without asking Louise.
  var SIZES = [
    { key: 'c355', label: '355 mL cans', litres: 0.355, step: 24 },
    { key: 'c473', label: '473 mL cans', litres: 0.473, step: 24 },
    { key: 'k20', label: '20 L kegs', litres: 19.5, step: 1 },
    { key: 'k50', label: '50 L kegs', litres: 50, step: 1 },
    { key: 'k58', label: '58.6 L kegs', litres: 58.6, step: 1 },
  ];

  // excise: false = logged but kept off the CRA excise list (Louise, 2026-09-28).
  var BEERS = [
    { name: 'Big League', excise: true },
    { name: 'Bella', excise: true },
    { name: 'Golden Pig', excise: true },
    { name: 'Town Crier', excise: true },
    { name: 'Rusty', excise: true },
    { name: 'Big Poppa', excise: true },
    { name: 'Little Rippa', excise: true },
    { name: 'Party Line', excise: true },
    { name: 'Humdinger', excise: true },
    { name: 'Lemonade Wave', excise: false },
    { name: 'Sparkling Water', excise: false },
  ];

  // Any FV can condition; brites never ferment.
  var TANKS = ['FV1', 'FV2', 'FV3', 'FV4', 'FV5', 'FV6', 'BBT#1', 'BBT#2', 'BBT#3'];

  // Tank size in hL (Louise: 3 x 20 and 3 x 10 FVs; 2 x 10 and 1 x 20 brites).
  // The 20s: FV4, FV5, FV6 (Louise, 2026-09-28) and BBT#1.
  var TANK_HL = { FV1: 10, FV2: 10, FV3: 10, FV4: 20, FV5: 20, FV6: 20, 'BBT#1': 20, 'BBT#2': 10, 'BBT#3': 10 };

  function round(n, dp) {
    var f = Math.pow(10, dp);
    return Math.round((n + Number.EPSILON) * f) / f;
  }

  // A volume Bryan didn't measure is null ("not recorded"), never a guessed number.
  function vol(v) { return v === '' || v == null ? null : num(v); }

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  // hL = (cans355 x 0.355 + cans473 x 0.473 + kegs20 x 19.5 + kegs50 x 50 + kegs58 x 58.6) / 100
  function hlOf(counts) {
    var litres = 0;
    SIZES.forEach(function (s) { litres += num(counts[s.key]) * s.litres; });
    return round(litres / 100, 4);
  }

  function beerIsExcise(name) {
    for (var i = 0; i < BEERS.length; i++) if (BEERS[i].name === name) return BEERS[i].excise;
    return true; // an unknown beer counts until Louise says otherwise
  }

  function validBatch(b) { return /^\d{5}$/.test(String(b)); }

  // Replay events -> { batches, packaging, dumps, events }
  function reduce(events) {
    var voided = {};
    events.forEach(function (e) { if (e.type === 'void') voided[e.data.target] = true; });

    var batches = {};
    var packaging = [];
    var dumps = [];
    var live = [];

    function get(id) {
      return batches[id] || (batches[id] = {
        batch: String(id), beer: '', tank: '', startHL: 0, level: 0,
        packagedHL: 0, lossHL: 0, status: 'open', runs: [], notes: [],
        combinedInto: '', receivedFrom: [],
      });
    }

    events.forEach(function (e) {
      if (e.type === 'void' || voided[e.id]) return;
      live.push(e);
      var d = e.data || {};
      var b;
      switch (e.type) {
        case 'batch_new':
          b = get(d.batch);
          b.beer = d.beer; b.tank = d.tank; b.date = d.date;
          b.startHL = vol(d.volumeHL); b.level = vol(d.volumeHL); b.status = 'open';
          break;

        case 'transfer': // moved to another tank; level re-measured there
          b = get(d.batch);
          b.tank = d.tank;
          if (vol(d.volumeHL) != null) {
            if (b.level != null) b.lossHL = round(b.lossHL + (b.level - num(d.volumeHL)), 4);
            b.level = num(d.volumeHL);
          }
          break;

        case 'package':
          b = get(d.batch);
          var hl = hlOf(d.counts || {});
          var left = num(d.leftHL);
          // spillage: no excise on it. Unknown if the tank volume was never recorded.
          var loss = b.level == null ? null : round(b.level - hl - left, 4);
          b.level = left; b.packagedHL = round(b.packagedHL + hl, 4);
          if (loss != null) b.lossHL = round(b.lossHL + loss, 4);
          if (left <= 0) b.status = 'empty';
          var row = {
            id: e.id, date: d.date, month: String(d.date).slice(0, 7),
            batch: b.batch, beer: b.beer,
            c355: num(d.counts.c355), c473: num(d.counts.c473), k20: num(d.counts.k20),
            k50: num(d.counts.k50), k58: num(d.counts.k58),
            hL: hl, excise: beerIsExcise(b.beer) ? 'Y' : 'N',
            leftHL: left, lossHL: loss, note: d.note || '', at: e.at, by: e.by || '',
          };
          b.runs.push(row);
          packaging.push(row);
          break;

        case 'dump':
          b = get(d.batch);
          var dv = num(d.volumeHL);
          if (b.level != null) b.level = round(Math.max(0, b.level - dv), 4);
          if (d.emptied || b.level === 0) { b.level = 0; b.status = 'dumped'; }
          dumps.push({ id: e.id, date: d.date, batch: b.batch, beer: b.beer, volumeHL: dv,
            where: d.where || 'tank', reason: d.reason || '', at: e.at });
          break;

        case 'combine': // d.from poured into d.into
          var from = get(d.from), into = get(d.into);
          var moved = num(d.volumeHL);
          if (from.level != null) from.level = round(Math.max(0, from.level - moved), 4);
          if (into.level != null) into.level = round(into.level + moved, 4);
          into.receivedFrom.push({ batch: from.batch, volumeHL: moved, date: d.date });
          if (d.fromEmpty || from.level === 0) {
            from.level = 0; from.status = 'combined'; from.combinedInto = into.batch;
          }
          break;
      }
    });

    packaging.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return { batches: batches, packaging: packaging, dumps: dumps, events: live, voided: voided };
  }

  function openBatches(state) {
    return Object.keys(state.batches).map(function (k) { return state.batches[k]; })
      .filter(function (b) { return b.status === 'open'; })
      .sort(function (a, b) { return a.tank < b.tank ? -1 : 1; });
  }

  function nextBatchNumber(state, date) {
    var yy = String(date || new Date().toISOString()).slice(2, 4);
    var max = 0;
    Object.keys(state.batches).forEach(function (k) {
      if (k.slice(0, 2) === yy) max = Math.max(max, parseInt(k, 10));
    });
    return max ? String(max + 1) : ''; // no guess if we have nothing for this year
  }

  function monthSummary(state, month) {
    var rows = state.packaging.filter(function (r) { return r.month === month; });
    var tot = { c355: 0, c473: 0, k20: 0, k50: 0, k58: 0, hL: 0 };
    rows.forEach(function (r) {
      if (r.excise !== 'Y') return;
      SIZES.forEach(function (s) { tot[s.key] += r[s.key]; });
      tot.hL = round(tot.hL + r.hL, 4);
    });
    tot.hL = hlOf(tot);
    return { rows: rows, exciseTotals: tot };
  }

  return {
    SIZES: SIZES, BEERS: BEERS, TANKS: TANKS, TANK_HL: TANK_HL,
    hlOf: hlOf, round: round, beerIsExcise: beerIsExcise, validBatch: validBatch,
    reduce: reduce, openBatches: openBatches, nextBatchNumber: nextBatchNumber,
    monthSummary: monthSummary,
  };
})();

if (typeof module !== 'undefined') module.exports = CB;
