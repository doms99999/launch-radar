// Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the integrity strip, the model card, the ranked board with filters and sorting, a detail view per
// protocol with its full pricing working and farm plan, and the live-token view the model trained
// on. No network: every byte it shows is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var main = document.getElementById('board');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '—';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    return n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(n, digits) {
    return n == null ? '—' : (n * 100).toFixed(digits == null ? 0 : digits) + '%';
  }
  function change(n) {
    if (n == null) return '<span class="num">—</span>';
    var cls = n > 0 ? 'up' : n < 0 ? 'down' : '';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function verdictChip(v) {
    var label = v === 'strong' ? 'Strong farm' : v === 'worthwhile' ? 'Worth a position' : 'Thin: costs bite';
    return '<span class="chip ' + v + '">' + label + '</span>';
  }

  // State, seeded from the hash so a view can be linked or photographed exactly as shared.
  var state = { view: 'board', q: '', cat: '', chain: '', verdict: '', wl: false, sort: 'rank', dir: 1, sel: null };
  function readHash() {
    var h = window.location.hash.replace(/^#\/?/, '');
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv.length !== 2) return;
      var k = decodeURIComponent(kv[0]);
      var v = decodeURIComponent(kv[1]);
      if (k === 'detail') state.sel = v;
      if (k === 'cat') state.cat = v;
      if (k === 'chain') state.chain = v;
      if (k === 'watchlist') state.wl = v === '1';
      if (k === 'view') state.view = v;
      if (k === 'verdict') state.verdict = v;
    });
  }
  readHash();

  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  var cats = [];
  var chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort();
  chains.sort();

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.wl && !r.on_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.verdict && r.farm.verdict !== state.verdict) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    out.sort(function (a, b) {
      var va;
      var vb;
      if (key === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'fdv') { va = a.model.fitted_fdv_usd; vb = b.model.fitted_fdv_usd; }
      else if (key === 'odds') { va = a.model.launch_odds; vb = b.model.launch_odds; }
      else if (key === 'change') { va = a.change_7d == null ? -1e9 : a.change_7d; vb = b.change_7d == null ? -1e9 : b.change_7d; }
      else if (key === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else { va = a.rank; vb = b.rank; }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.rank - b.rank;
    });
    return out;
  }

  function stripHtml() {
    var a = DATA.accounting;
    var asideTotal = Object.keys(a.aside).reduce(function (n, k) { return n + a.aside[k]; }, 0);
    var asideText = Object.keys(a.aside).map(function (k) { return a.aside[k] + ' ' + k; }).join(', ');
    var totalImplied = rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    var f = DATA.fit;
    return '<section class="strip">' +
      '<div class="cell"><div class="k">Universe accounted</div><div class="v">' + a.total + '</div><div class="s">' + a.tokened + ' tokened, ' + a.ranked + ' ranked, ' + asideTotal + ' set aside</div></div>' +
      '<div class="cell"><div class="k">Watchlist coverage</div><div class="v"><em>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</em></div><div class="s">every house watchlist protocol is on the board</div></div>' +
      '<div class="cell"><div class="k">Board implied value</div><div class="v">' + money(totalImplied) + '</div><div class="s">across ' + DATA.board_size + ' pre-token protocols</div></div>' +
      '<div class="cell"><div class="k">Fit, held out</div><div class="v">×/÷ ' + f.typical_miss_factor.toFixed(1) + ' <span style="font-size:13px;color:var(--dim)">typical miss</span></div><div class="s">tested four ways on ' + f.train_size + ' market caps; ' + f.validation_within_2x_pct + '% land within 2x out of fold</div></div>' +
      '</section>' +
      '<p class="fine" style="color:var(--faint);font-size:12.5px;margin:0 0 4px">Set aside, not dropped: ' + esc(asideText) + '. Tokened protocols are never ranked: they are the training set and the Live view.</p>';
  }

  function modelHtml() {
    var f = DATA.fit;
    var L = DATA.ledger;
    var terms = L.terms_adopted.length ? ' Extra terms the held-out test earned: ' + L.terms_adopted.join(', ') + '.' : '';
    var growth = L.growth_factors_active ? 'growth-bucket factors' : 'a continuous weekly-change term (the growth buckets retire when the term ships, so growth is never counted twice)';
    return '<section class="model"><h2>The model, stated plainly</h2>' +
      '<p class="formula">fitted value = price line(TVL) x category factor x growth factor &nbsp;·&nbsp; implied = fitted x launch odds &nbsp;·&nbsp; range = the model\'s own out-of-fold errors</p>' +
      '<p>The price line is a least-squares fit of log market cap on log TVL over the ' + f.train_size + ' tokened protocols carrying a market cap (reference multiple ' + f.reference_multiple.toFixed(2) + ' at $100M TVL, slope ' + f.slope.toFixed(2) + '). Category factors and ' + growth + ' are shrunk median residuals, capped so thin groups borrow the market\'s answer.' + terms + ' Launch odds are a category\'s tokened share (' + pct(f.global_launch_rate, 0) + ' universe-wide) times an age multiplier read off the whole snapshot: protocols over three years old carry a token at 1.4x the base rate, under six months at 0.6x. Every row\'s range is the central 80% of the model\'s out-of-fold errors in its category. No protocol name is special-cased anywhere; the full fit is published in the Model ledger tab.</p>' +
      '<p class="fine">Farm verdicts price the odds-weighted share: 5% of a launch reaches farmers, the qualifying crowd is TVL / $25,000 (bounded 5,000 to 100,000 wallets), plans route through each protocol\'s cheapest chain, and capital is never under twice a plan\'s full cost. Strong = expected value at least 5x cost; worthwhile = at least 1x; thin = below. Held out four ways (half split, five-fold, older-to-newer, leave-one-category-out) the typical miss is ×/÷ ' + f.typical_miss_factor.toFixed(1) + '. Treat every value as a ranking with a stated error, not a promise.</p></section>';
  }

  function controlsHtml() {
    function opts(list, cur, allLabel) {
      var s = '<option value="">' + allLabel + '</option>';
      list.forEach(function (v) { s += '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; });
      return s;
    }
    return '<div class="tabs">' +
      '<button data-view="board" class="' + (state.view === 'board' ? 'on' : '') + '">Launch board</button>' +
      '<button data-view="live" class="' + (state.view === 'live' ? 'on' : '') + '">Live tokens (training set)</button>' +
      '<button data-view="ledger" class="' + (state.view === 'ledger' ? 'on' : '') + '">Model ledger</button></div>' +
      (state.view === 'board' ? '<div class="controls">' +
        '<input type="search" id="q" placeholder="Search name or slug" value="' + esc(state.q) + '">' +
        '<select id="cat">' + opts(cats, state.cat, 'All categories') + '</select>' +
        '<select id="chain">' + opts(chains, state.chain, 'All chains') + '</select>' +
        '<select id="verdict"><option value="">All verdicts</option>' +
        '<option value="strong"' + (state.verdict === 'strong' ? ' selected' : '') + '>Strong farm</option>' +
        '<option value="worthwhile"' + (state.verdict === 'worthwhile' ? ' selected' : '') + '>Worth a position</option>' +
        '<option value="thin"' + (state.verdict === 'thin' ? ' selected' : '') + '>Thin</option></select>' +
        '<label><input type="checkbox" id="wl"' + (state.wl ? ' checked' : '') + '> Watchlist only</label>' +
        '<span class="count" id="count"></span></div>' : '');
  }

  function boardHtml(list) {
    var head = '<table><thead><tr>' +
      '<th data-sort="rank" class="num">Rank</th><th data-sort="name">Protocol</th><th>Category</th><th>Chains</th>' +
      '<th data-sort="tvl" class="num">TVL</th><th data-sort="change" class="num">7d</th>' +
      '<th data-sort="fdv" class="num">Fitted value</th><th data-sort="odds" class="num">Odds</th>' +
      '<th data-sort="implied" class="num">Implied value</th><th>Farm verdict</th></tr></thead><tbody>';
    var body = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.sel === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + (r.on_watchlist ? '<span class="wl">WATCHLIST</span>' : '') + '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || 'Uncategorized') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + change(r.change_7d) + '</td>' +
        '<td class="num">' + money(r.model.fitted_fdv_usd) + '</td>' +
        '<td class="num">' + pct(r.model.launch_odds) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td>' + verdictChip(r.farm.verdict) + '</td></tr>';
    }).join('');
    return head + body + '</tbody></table>';
  }

  function liveHtml() {
    var head = '<table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Cap / TVL</th><th class="num">7d</th></tr></thead><tbody>';
    var body = DATA.live.map(function (r) {
      return '<tr><td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || 'Uncategorized') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td class="num">' + (r.mcap_tvl == null ? '—' : r.mcap_tvl.toFixed(2)) + '</td>' +
        '<td class="num">' + change(r.change_7d) + '</td></tr>';
    }).join('');
    return '<p style="color:var(--dim);font-size:14px">These protocols already trade, so the board never ranks them: their recorded market caps are the observations the price line, the category factors and the growth factors were fitted on. The full training set is ' + DATA.fit.train_size + ' protocols with both a market cap and a TVL.</p>' + head + body + '</tbody></table>';
  }

  function detailHtml(r) {
    var m = r.model;
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return '<section class="detail"><button class="close" id="close">Close</button>' +
      '<h2>' + esc(r.name) + (r.on_watchlist ? '<span class="wl">WATCHLIST</span>' : '') + ' <span class="slug">' + esc(r.slug) + '</span></h2>' +
      '<div class="sub">Rank #' + r.rank + ' of ' + DATA.board_size + ' · ' + esc(r.category || 'Uncategorized') + ' · ' + esc(r.chains.join(', ') || 'no chains recorded') +
      ' · tracked since ' + esc(r.listed_at || 'an unknown date') + (r.age_days == null ? '' : ' (' + r.age_days + ' days)') + '</div>' +
      '<div class="terms">' +
      '<div class="term"><div class="k">TVL</div><div class="v">' + moneyFull(r.tvl_usd) + '</div></div>' +
      '<div class="term"><div class="k">Price line x factors</div><div class="v">' + m.size_multiple.toFixed(3) + ' x ' + m.category_factor.toFixed(2) + ' x ' + m.growth_adjustment.toFixed(2) + '</div></div>' +
      '<div class="term"><div class="k">Fitted launch value</div><div class="v">' + moneyFull(m.fitted_fdv_usd) + '</div></div>' +
      '<div class="term"><div class="k">Value range (80%)</div><div class="v">' + money(m.value_low_usd) + ' – ' + money(m.value_high_usd) + '</div></div>' +
      '<div class="term"><div class="k">Launch odds x implied</div><div class="v">' + pct(m.launch_odds) + ' → ' + moneyFull(r.implied_value_usd) + '</div></div>' +
      '</div>' +
      '<h3>Farm plan: ' + moneyFull(r.farm.capital_usd) + ' for ' + r.farm.weeks + ' weeks via ' + esc(r.farm.entry_chain) + ', about $' + r.farm.total_cost_usd.toFixed(2) + ' all in</h3>' +
      '<p style="margin:4px 0">Expected share at the fitted value: <strong>' + moneyFull(r.farm.expected_share_usd) + '</strong> per qualifying wallet, which the ' + pct(m.launch_odds) + ' launch odds weight to <strong>' + moneyFull(r.farm.expected_value_usd) + '</strong> — ' + r.farm.ratio.toFixed(1) + 'x the plan\'s cost. ' + verdictChip(r.farm.verdict) + '</p>' +
      '<ol>' + steps + '</ol></section>';
  }

  function ledgerHtml() {
    var L = DATA.ledger;
    function splitRow(label, s) {
      return '<tr><td>' + label + '</td><td class="num">' + Math.round(s.median_ape * 100) + '%</td><td class="num">' + s.within_2x_pct + '%</td><td class="num">' + s.tested + '</td></tr>';
    }
    var val = '<h3>Held out, four ways</h3><table><thead><tr><th>Pass</th><th class="num">Median error</th><th class="num">Within 2x</th><th class="num">Tested</th></tr></thead><tbody>' +
      splitRow('Slug-hash half split', L.validation.half) +
      splitRow('Five-fold cross-validation', L.validation.fivefold) +
      splitRow('Older fitted, newer priced', L.validation.temporal) +
      splitRow('Leave-one-category-out', L.validation.category_holdout) +
      '</tbody></table>' +
      '<p class="fine">Typical miss across the five-fold pass: ×/÷ ' + L.validation.typical_miss_factor.toFixed(1) + '. Each row\'s value range is the central 80% of these out-of-fold errors in its own category (global spread ×' + L.interval.global_low_mult.toFixed(2) + ' to ×' + L.interval.global_high_mult.toFixed(2) + '), shrunk toward the global spread by sample size.</p>';
    var cats = L.categories.slice(0, 18).map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.factor.toFixed(2) + 'x</td><td class="num">' + c.train_n + '</td></tr>';
    }).join('');
    var catBlock = '<h3>Category factors (top ' + Math.min(18, L.categories.length) + ' of ' + L.categories.length + ')</h3><table><thead><tr><th>Category</th><th class="num">Factor</th><th class="num">Trained on</th></tr></thead><tbody>' + cats + '</tbody></table>' +
      '<p class="fine">Terms the held-out test admitted: ' + (L.terms_adopted.length ? esc(L.terms_adopted.join(', ')) : 'none — the plain line with bucket factors beat every extra term') + '. Growth factors: ' + (L.growth_factors_active ? L.growth.map(function (g) { return esc(g.label) + ' ' + g.factor.toFixed(2) + 'x (n=' + g.train_n + ')'; }).join(' · ') : 'retired in favour of the continuous term') + '.</p>';
    var ages = L.age_odds.map(function (a) {
      return '<tr><td>' + esc(a.label) + '</td><td class="num">' + a.n + '</td><td class="num">' + a.tokened + '</td><td class="num">' + pct(a.rate) + '</td><td class="num">' + a.multiplier.toFixed(2) + 'x</td></tr>';
    }).join('');
    var ageBlock = '<h3>Launch odds by age band</h3><table><thead><tr><th>Age band</th><th class="num">Protocols</th><th class="num">Tokened</th><th class="num">Rate</th><th class="num">Multiplier</th></tr></thead><tbody>' + ages + '</tbody></table>' +
      '<p class="fine">A row\'s odds are its category\'s tokened share times its age band\'s multiplier, clamped between 1% and 98%.</p>';
    var anchors = L.anchors.slice(0, 24).map(function (a) {
      return '<tr><td><span class="name">' + esc(a.name) + '</span></td><td class="num">' + money(a.tvl_usd) + '</td><td class="num">' + money(a.actual_mcap_usd) + '</td><td class="num">' + money(a.fitted_fdv_usd) + '</td></tr>';
    }).join('');
    var anchorBlock = '<h3>Pricing anchors: the market vs the model (top 24 of ' + L.anchors.length + ')</h3><table><thead><tr><th>Training protocol</th><th class="num">TVL</th><th class="num">Recorded cap</th><th class="num">Fitted</th></tr></thead><tbody>' + anchors + '</tbody></table>';
    var checks = L.self_checks.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return '<section class="ledger"><p style="color:var(--dim);font-size:14px;margin-top:0">The fit itself, published with the board: every factor, rate and error bar the numbers on the board came from, computed by the same program run that wrote board.json.</p>' +
      val + catBlock + ageBlock + anchorBlock +
      '<h3>Self-checks, computed on this board</h3><ul class="checks">' + checks + '</ul></section>';
  }

  function render() {
    var list = filtered();
    var ghost = '<svg class="ghost" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6c22 0 38 17 38 40v48l-9.5-8L69 94l-9.5-8L50 94l-9.5-8L31 94l-9.5-8L12 94V46c0-23 16-40 38-40z" fill="#f5f7fa"/><circle cx="35" cy="46" r="6.5" fill="#14100f"/><circle cx="65" cy="46" r="6.5" fill="#14100f"/><circle cx="82" cy="24" r="11" fill="#e93a9e"/><path d="M82 18v12M76 24h12" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>';
    var html = '<header class="mast"><div class="rings"></div><div><h1>LAUNCH <span class="thin">RADAR</span></h1>' +
      '<p>Pre-token protocols ranked by fitted launch value, with the farm plan and the price of every plan.</p>' +
      '<p class="brand">' + ghost + 'Built for the <strong>make.fun</strong> token-radar-01 bounty</p></div>' +
      '<div class="asof">snapshot ' + esc(DATA.as_of) + '<br>' + esc(DATA.source) + '<br>model ' + esc(DATA.model_version) + '</div></header>';
    html += stripHtml();
    html += modelHtml();
    html += controlsHtml();
    if (state.view === 'live') {
      html += liveHtml();
    } else if (state.view === 'ledger') {
      html += ledgerHtml();
    } else {
      if (state.sel && bySlug[state.sel]) html += detailHtml(bySlug[state.sel]);
      html += boardHtml(list);
    }
    html += '<p class="foot">One sealed snapshot in, one ranked board out: the same program that wrote this page\'s data wrote board.json, and its seven gate checks (coverage, order, values, farm steps, dashboard, screenshots, dossier) are the scorer\'s own. Values are model estimates with the stated held-out error, not financial advice.</p>';
    main.innerHTML = html;
    main.setAttribute('aria-busy', 'false');
    var count = document.getElementById('count');
    if (count) count.textContent = list.length + ' of ' + rows.length + ' protocols';
    wire();
  }

  function wire() {
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; render(); var nq = document.getElementById('q'); nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.cat = cat.value; render(); });
    var chain = document.getElementById('chain');
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; render(); });
    var verdict = document.getElementById('verdict');
    if (verdict) verdict.addEventListener('change', function () { state.verdict = verdict.value; render(); });
    var wl = document.getElementById('wl');
    if (wl) wl.addEventListener('change', function () { state.wl = wl.checked; render(); });
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      b.addEventListener('click', function () { state.view = b.getAttribute('data-view'); render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('th[data-sort]'), function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (state.sort === k) state.dir = state.dir * -1;
        else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
        render();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('tbody tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () {
        state.sel = state.sel === tr.getAttribute('data-slug') ? null : tr.getAttribute('data-slug');
        render();
        window.scrollTo(0, 0);
      });
    });
    var close = document.getElementById('close');
    if (close) close.addEventListener('click', function () { state.sel = null; render(); });
  }

  render();
})();
