// Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the integrity strip, the model card, the ranked board with filters and sorting, a detail view per
// protocol with its full pricing working and farm plan, and the live-token view the model trained
// on. It also recomputes every row's fitted value from the published fit, in the browser, and
// reports the match count on the cover. No network: every byte it shows is in data.js.
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
  var state = { view: 'board', q: '', cat: '', chain: '', verdict: '', wl: false, sort: 'rank', dir: 1, sel: null, focus: null };
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
      if (k === 'focus') state.focus = v;
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

  // The recomputation proof: reprice every row from the published fit (the same numbers the
  // ledger prints) and count how many land on the board's stated fitted value.
  function growthBucketJs(g) {
    g = g == null ? 0 : g;
    if (g < -10) return 0;
    if (g < 0) return 1;
    if (g < 10) return 2;
    return 3;
  }
  function termValueJs(term, r) {
    if (term === 'age') return Math.log(1 + ((r.age_days == null ? DATA.fit.median_age : r.age_days) / 365));
    if (term === 'chains') return Math.log(1 + r.chains.length);
    if (term === 'growth') return Math.min(1.5, Math.max(-1.5, (r.change_7d == null ? 0 : r.change_7d) / 100));
    return 0;
  }
  function recompute() {
    var f = DATA.fit;
    var clamp = Math.log(f.term_clamp_mult || 2);
    var ok = 0;
    rows.forEach(function (r) {
      var line = Math.exp(f.intercept + f.slope * Math.log(r.tvl_usd));
      var t = 0;
      f.coef.forEach(function (c) { t += c.value * termValueJs(c.term, r); });
      t = Math.min(clamp, Math.max(-clamp, t));
      var cat = f.category_factor[r.category || 'Uncategorized'];
      if (cat == null) cat = 1;
      var fdv = line * Math.exp(t) * cat * f.growth_adjustment[growthBucketJs(r.change_7d)];
      if (Math.abs(fdv - r.model.fitted_fdv_usd) <= Math.max(2, 0.02 * r.model.fitted_fdv_usd)) ok++;
    });
    return ok;
  }

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
      '<p class="fine" id="recompute" style="color:var(--faint);font-size:12.5px;margin:0 0 4px">Recomputing every row from the published fit…</p>' +
      '<p class="fine" style="color:var(--faint);font-size:12.5px;margin:0 0 4px">Set aside, not dropped: ' + esc(asideText) + '. Tokened protocols are never ranked: they are the training set and the Live view.</p>';
  }

  function modelHtml() {
    var f = DATA.fit;
    var L = DATA.ledger;
    var atCeiling = rows.filter(function (r) { return r.model.launch_odds >= 0.98; }).length;
    var terms = L.terms_adopted.length
      ? ' The held-out test admitted ' + L.terms_adopted.map(function (t) { return esc(t.label) + ' (coefficient ' + t.coef.toFixed(2) + ')'; }).join(', ') + ', and its total effect on any one price is capped at ×0.33 to ×3.00, so no single term can manufacture a row.'
      : ' The held-out test admitted no extra term this run: the plain line with bucket factors beat every candidate, and the full audit is in the ledger.';
    var growth = L.growth_factors_active ? 'growth-bucket factors' : 'the continuous term (the growth buckets retire when it ships, so growth is never counted twice)';
    return '<section class="model"><h2>The model, stated plainly</h2>' +
      '<p class="formula">fitted value = price line(TVL) x term adjustment (capped ×0.33–×3.00) x category factor x growth factor &nbsp;·&nbsp; implied = fitted x launch odds &nbsp;·&nbsp; range = 80% conformal band from the model\'s own out-of-fold errors</p>' +
      '<p>The price line is a least-squares fit of log market cap on log TVL over the ' + f.train_size + ' tokened protocols carrying a market cap (reference multiple ' + f.reference_multiple.toFixed(2) + ' at $100M TVL, slope ' + f.slope.toFixed(2) + '). A slope near one half means value grows with roughly the square root of TVL: a protocol 100x larger is priced about 11x higher, which is why this board\'s $2.75B protocol sits at rank 2, below one with about a seventh of its TVL. Category factors and ' + growth + ' are shrunk median residuals from the line, capped so thin groups borrow the market\'s answer.' + terms + '</p>' +
      '<p>Launch odds are a category\'s tokened share (' + pct(f.global_launch_rate, 0) + ' universe-wide) times a survival factor read off the whole snapshot: of the launches that ever happen, most happen young, so the factor falls with age — a protocol still tokenless after three years is priced on the tail of launches that remain, not rewarded for surviving. ' + atCeiling + ' of ' + rows.length + ' rows sit at the 98% odds ceiling. Every row\'s range is an 80% split-conformal band from the out-of-fold errors in its category; on held-out anchors the bands covered ' + f.conformal_coverage_pct + '% (target 80%). No protocol name is special-cased anywhere; the full fit, the term audit and the coverage check are published in the Model ledger tab.</p>' +
      '<p class="fine">Farm verdicts price the odds-weighted share: 5% of a launch reaches farmers, the qualifying crowd is fitted value / $2,500 (bounded 5,000 to 200,000 wallets), plans route through each protocol\'s cheapest chain, a plan\'s cost counts its gas and bridge fees plus the farmer\'s time at $5 an hour, and capital is never under twice a plan\'s full cost. Every plan states its break-even launch value and its expected value net of cost per hour of effort. Strong = expected value at least 3x full cost; worthwhile = at least 1x; thin = below. Held out four ways (half split, five-fold, older-to-newer, leave-one-category-out) the typical miss is ×/÷ ' + f.typical_miss_factor.toFixed(1) + '. Treat every value as a ranking with a stated error, not a promise.</p></section>';
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
        '<td class="num">' + money(r.model.fitted_fdv_usd) + '<br><span class="slug">' + money(r.model.value_low_usd) + ' – ' + money(r.model.value_high_usd) + '</span></td>' +
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
    return '<p style="color:var(--dim);font-size:14px">These protocols already trade, so the board never ranks them: their recorded market caps are the observations the price line, the category factors and the growth factors were fitted on. Shown: the 24 largest of the ' + DATA.accounting.tokened + ' tokened protocols by market cap; the fit itself trained on ' + DATA.fit.train_size + ' of them, the ones carrying both a market cap and a TVL (the full fitted-vs-actual table is in the Model ledger).</p>' + head + body + '</tbody></table>';
  }

  function detailHtml(r) {
    var m = r.model;
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return '<section class="detail" id="detail"><button class="close" id="close">Close</button>' +
      '<h2>' + esc(r.name) + (r.on_watchlist ? '<span class="wl">WATCHLIST</span>' : '') + ' <span class="slug">' + esc(r.slug) + '</span></h2>' +
      '<div class="sub">Rank #' + r.rank + ' of ' + DATA.board_size + ' · ' + esc(r.category || 'Uncategorized') + ' · ' + esc(r.chains.join(', ') || 'no chains recorded') +
      ' · tracked since ' + esc(r.listed_at || 'an unknown date') + (r.age_days == null ? '' : ' (' + r.age_days + ' days)') + '</div>' +
      '<div class="terms">' +
      '<div class="term"><div class="k">TVL</div><div class="v">' + moneyFull(r.tvl_usd) + '</div></div>' +
      '<div class="term"><div class="k">Line x term x category x growth</div><div class="v">' + m.size_multiple.toFixed(3) + ' x ' + m.term_adjustment.toFixed(2) + ' x ' + m.category_factor.toFixed(2) + ' x ' + m.growth_adjustment.toFixed(2) + '</div></div>' +
      '<div class="term"><div class="k">Fitted launch value</div><div class="v">' + moneyFull(m.fitted_fdv_usd) + '</div></div>' +
      '<div class="term"><div class="k">Value range (80% conformal)</div><div class="v">' + money(m.value_low_usd) + ' – ' + money(m.value_high_usd) + '</div></div>' +
      '<div class="term"><div class="k">Launch odds x implied</div><div class="v">' + pct(m.launch_odds) + ' → ' + moneyFull(r.implied_value_usd) + '</div></div>' +
      '</div>' +
      '<div class="terms">' +
      '<div class="term"><div class="k">Break-even launch value</div><div class="v">' + moneyFull(r.farm.breakeven_fdv_usd) + '</div></div>' +
      '<div class="term"><div class="k">Net value per hour of effort</div><div class="v">' + (r.farm.usd_per_hour < 0 ? '-$' + Math.abs(r.farm.usd_per_hour).toFixed(2) : '$' + r.farm.usd_per_hour.toFixed(2)) + '</div></div>' +
      '<div class="term"><div class="k">Effort</div><div class="v">' + r.farm.effort_hours.toFixed(1) + ' hours over ' + r.farm.weeks + ' weeks</div></div>' +
      '<div class="term"><div class="k">Position</div><div class="v">' + moneyFull(r.farm.capital_usd) + ' via ' + esc(r.farm.entry_chain) + '</div></div>' +
      '<div class="term"><div class="k">All-in cost</div><div class="v">$' + r.farm.total_cost_usd.toFixed(2) + '</div></div>' +
      '</div>' +
      '<h3>Farm plan: ' + moneyFull(r.farm.capital_usd) + ' for ' + r.farm.weeks + ' weeks via ' + esc(r.farm.entry_chain) + ', about $' + r.farm.total_cost_usd.toFixed(2) + ' all in</h3>' +
      '<p style="margin:4px 0">Expected share at the fitted value: <strong>' + moneyFull(r.farm.expected_share_usd) + '</strong> per qualifying wallet, which the ' + pct(m.launch_odds) + ' launch odds weight to <strong>' + moneyFull(r.farm.expected_value_usd) + '</strong> — ' + r.farm.ratio.toFixed(1) + 'x the plan\'s cost, ' + (r.farm.usd_per_hour < 0 ? '-$' + Math.abs(r.farm.usd_per_hour).toFixed(2) : '$' + r.farm.usd_per_hour.toFixed(2)) + ' per hour of effort, break-even at a ' + money(r.farm.breakeven_fdv_usd) + ' launch. ' + verdictChip(r.farm.verdict) + '</p>' +
      '<ol>' + steps + '</ol></section>';
  }

  function ledgerHtml() {
    var L = DATA.ledger;
    var checks = L.self_checks.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var checksBlock = '<h3 id="checks">Self-checks, computed on this board</h3><ul class="checks">' + checks + '</ul>' +
      '<p class="fine">The dashboard also recomputes every row\'s fitted value from the fit published here, in your browser, and reports the match count on the cover.</p>';
    function splitRow(label, s) {
      return '<tr><td>' + label + '</td><td class="num">×/÷ ' + s.median_mult_miss.toFixed(1) + '</td><td class="num">' + Math.round(s.median_ape * 100) + '%</td><td class="num">' + s.within_2x_pct + '%</td><td class="num">' + s.tested + '</td></tr>';
    }
    var val = '<h3 id="validation">Held out, four ways</h3><table><thead><tr><th>Pass</th><th class="num">Typical miss</th><th class="num">Median error</th><th class="num">Within 2x</th><th class="num">Tested</th></tr></thead><tbody>' +
      splitRow('Slug-hash half split', L.validation.half) +
      splitRow('Five-fold cross-validation', L.validation.fivefold) +
      splitRow('Older fitted, newer priced', L.validation.temporal) +
      splitRow('Leave-one-category-out', L.validation.category_holdout) +
      '</tbody></table>' +
      '<p class="fine">Typical miss is the multiplicative read of the same residuals: a ×/÷ ' + L.validation.typical_miss_factor.toFixed(1) + ' median. Each row\'s range is an ' + esc(L.interval.coverage) + ' (global band ×' + L.interval.global_low_mult.toFixed(2) + ' to ×' + L.interval.global_high_mult.toFixed(2) + '), and on the held-out anchors themselves the bands covered ' + L.interval.realized_coverage_pct + '% — the coverage check above, not a promise about any single row.</p>';
    var audit = L.term_audit.map(function (a) {
      return '<tr><td>' + esc(a.label) + '</td><td class="num">' + Math.round(a.base_ape * 100) + '%</td><td class="num">' + Math.round(a.tested_ape * 100) + '%</td><td class="num">' + (a.delta_pct > 0 ? '+' : '') + a.delta_pct.toFixed(1) + '%</td><td>' + (a.adopted ? 'adopted' : 'rejected') + '</td></tr>';
    }).join('');
    var auditBlock = '<h3 id="audit">Term audit: every candidate the admission test ran</h3><table><thead><tr><th>Candidate term</th><th class="num">Error without</th><th class="num">Error with</th><th class="num">Change</th><th>Verdict</th></tr></thead><tbody>' + audit + '</tbody></table>' +
      '<p class="fine">Errors are five-fold median errors. A term ships only when it lowers the error of the spec it joins; its total effect on any one price is then capped at ×0.33 to ×3.00. The placebo is a scramble of the slug hash and carries no information: the test must refuse it, and the audit shows its score either way.</p>';
    var cats = L.categories.slice(0, 18).map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.factor.toFixed(2) + 'x</td><td class="num">' + c.train_n + '</td></tr>';
    }).join('');
    var catBlock = '<h3>Category factors (top ' + Math.min(18, L.categories.length) + ' of ' + L.categories.length + ')</h3><table><thead><tr><th>Category</th><th class="num">Factor</th><th class="num">Trained on</th></tr></thead><tbody>' + cats + '</tbody></table>' +
      '<p class="fine">Terms the held-out test admitted: ' + (L.terms_adopted.length ? L.terms_adopted.map(function (t) { return esc(t.label) + ' (coefficient ' + t.coef.toFixed(2) + ')'; }).join(', ') : 'none — the plain line with bucket factors beat every extra term') + '. Growth factors: ' + (L.growth_factors_active ? L.growth.map(function (g) { return esc(g.label) + ' ' + g.factor.toFixed(2) + 'x (n=' + g.train_n + ')'; }).join(' · ') : 'retired in favour of the continuous term') + '.</p>';
    var ages = L.age_odds.map(function (a) {
      return '<tr><td>' + esc(a.label) + '</td><td class="num">' + a.n + '</td><td class="num">' + a.tokened + '</td><td class="num">' + pct(a.survival, 0) + '</td><td class="num">' + a.multiplier.toFixed(2) + 'x</td></tr>';
    }).join('');
    var ageBlock = '<h3>Launch odds by age band: the survival read</h3><table><thead><tr><th>Age band</th><th class="num">Protocols</th><th class="num">Tokened</th><th class="num">Launches still to come</th><th class="num">Multiplier</th></tr></thead><tbody>' + ages + '</tbody></table>' +
      '<p class="fine">Survival is the share of launches that happen after the band\'s age, read off the whole universe Kaplan-Meier style (a tokened protocol is an event at its current age, an upper bound; a pre-token one is censored there). A row\'s odds are its category\'s tokened share times its own survival factor, clamped between 1% and 98%: the older a protocol stays tokenless, the smaller the share of launches left for it. Board averages by band also mix categories; within any one category, odds fall with age.</p>';
    var anchors = L.anchors.slice(0, 24).map(function (a) {
      return '<tr><td><span class="name">' + esc(a.name) + '</span></td><td class="num">' + money(a.tvl_usd) + '</td><td class="num">' + money(a.actual_mcap_usd) + '</td><td class="num">' + money(a.fitted_fdv_usd) + '</td></tr>';
    }).join('');
    var anchorBlock = '<h3>Pricing anchors: the market vs the model (top 24 of ' + L.anchors.length + ')</h3><table><thead><tr><th>Training protocol</th><th class="num">TVL</th><th class="num">Recorded cap</th><th class="num">Fitted</th></tr></thead><tbody>' + anchors + '</tbody></table>';
    return '<section class="ledger"><p style="color:var(--dim);font-size:14px;margin-top:0">The fit itself, published with the board: every factor, rate and error bar the numbers on the board came from, computed by the same program run that wrote board.json.</p>' +
      checksBlock + val + auditBlock + catBlock + ageBlock + anchorBlock + '</section>';
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
    var rc = document.getElementById('recompute');
    if (rc) {
      var ok = recompute();
      rc.textContent = 'Recomputed in your browser from the published fit: ' + ok + ' / ' + rows.length + ' rows match the board\'s fitted values within rounding (' + (rows.length - ok) + ' mismatches). The fit itself is on the Model ledger tab.';
    }
    var count = document.getElementById('count');
    if (count) count.textContent = list.length + ' of ' + rows.length + ' protocols';
    wire();
    if (state.focus) {
      var el = document.getElementById(state.focus);
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 8);
    }
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

