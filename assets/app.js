/* WonBack — calculator UI. Depends on assets/calc.js (window.WonBackCalc). */
(function () {
  'use strict';

  var C = window.WonBackCalc;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  var receiptsEl = $('#receipts');
  var addBtn = $('#add-receipt');
  var instantUsedEl = $('#instant-used');
  var fxEl = $('#fx-rate');
  var resultEls = {
    refund: $('#total-refund'),
    usd: $('#total-usd'),
    paid: $('#stat-paid'),
    vat: $('#stat-vat'),
    rate: $('#stat-rate'),
    capFill: $('#cap-fill'),
    capText: $('#cap-text'),
    capNote: $('#cap-note'),
    breakdown: $('#breakdown'),
    empty: $('#empty-state'),
    copy: $('#copy-summary')
  };

  var state = { receipts: [{ amount: '', method: 'instant' }], instantUsed: 0, fx: 1350 };

  // ---------- formatting ----------
  // Own grouping rather than Intl: identical output everywhere, including
  // browsers and engines built without full ICU data.
  function group(n) {
    var s = String(Math.round(Math.abs(n)));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function won(n) { return '\u20A9' + group(n); }
  function usd(n, fx) {
    if (!n || !fx || fx <= 0) return '\u2248 $0';
    var v = n / fx;
    var digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    var parts = v.toFixed(digits).split('.');
    var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '\u2248 $' + whole + (parts[1] ? '.' + parts[1] : '');
  }
  function pct(n) { return n.toFixed(1) + '%'; }

  // ---------- persistence (preferences only, no personal data) ----------
  function loadPrefs() {
    try {
      var fx = parseFloat(localStorage.getItem('wonback.fx'));
      if (isFinite(fx) && fx > 0) state.fx = fx;
    } catch (e) { /* storage blocked: keep defaults */ }
  }
  function savePrefs() {
    try { localStorage.setItem('wonback.fx', String(state.fx)); } catch (e) { /* ignore */ }
  }

  // ---------- receipt rows ----------
  function addRow(receipt, index) {
    var row = document.createElement('div');
    row.className = 'receipt';

    var head = document.createElement('div');
    head.className = 'receipt-head';

    var name = document.createElement('span');
    name.className = 'receipt-name';
    name.textContent = 'Receipt ' + (index + 1);

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'receipt-remove';
    remove.setAttribute('aria-label', 'Remove receipt ' + (index + 1));
    remove.textContent = '\u00D7';
    remove.addEventListener('click', function () {
      if (state.receipts.length === 1) {
        state.receipts[0].amount = '';
        row.querySelector('input').value = '';
      } else {
        state.receipts.splice(index, 1);
        receiptsEl.innerHTML = '';
        state.receipts.forEach(addRow);
      }
      update();
    });

    head.appendChild(name);
    head.appendChild(remove);

    var fields = document.createElement('div');
    fields.className = 'receipt-fields';

    var money = document.createElement('div');
    money.className = 'money-field';
    var cur = document.createElement('span');
    cur.textContent = '\u20A9';
    var input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.placeholder = 'Amount on the receipt';
    input.setAttribute('aria-label', 'Amount on receipt ' + (index + 1) + ' in Korean won');
    input.value = receipt.amount ? group(receipt.amount) : '';
    input.addEventListener('input', function () {
      var raw = C.toWon(input.value);
      state.receipts[index].amount = raw || '';
      update();
    });
    input.addEventListener('blur', function () {
      var raw = C.toWon(input.value);
      input.value = raw ? group(raw) : '';
    });
    money.appendChild(cur);
    money.appendChild(input);

    var select = document.createElement('select');
    select.setAttribute('aria-label', 'Refund method for receipt ' + (index + 1));
    var o1 = document.createElement('option');
    o1.value = 'instant'; o1.textContent = 'Refund at the store';
    var o2 = document.createElement('option');
    o2.value = 'later'; o2.textContent = 'Claim later (counter / airport)';
    select.appendChild(o1);
    select.appendChild(o2);
    select.value = receipt.method;
    select.addEventListener('change', function () {
      state.receipts[index].method = select.value;
      update();
    });

    fields.appendChild(money);
    fields.appendChild(select);
    row.appendChild(head);
    row.appendChild(fields);
    receiptsEl.appendChild(row);
  }

  // ---------- render ----------
  function update() {
    var fx = parseFloat(fxEl.value) || state.fx;
    var used = C.toWon(instantUsedEl.value);
    var rows = state.receipts.map(function (r) {
      return { amount: r.amount || 0, method: r.method };
    });

    var res = C.evaluate(rows, { instantUsed: used });
    var t = res.totals;
    var hasInput = rows.some(function (r) { return r.amount > 0; });

    resultEls.refund.textContent = won(t.refund);
    resultEls.usd.textContent = usd(t.refund, fx);
    resultEls.paid.textContent = won(t.paid);
    resultEls.vat.textContent = won(t.vat);
    resultEls.rate.textContent = t.paid > 0 ? pct(t.effectiveRate) : '\u2014';

    // Instant-refund cap meter
    var committed = Math.min(t.instantCommitted, C.INSTANT_MAX_PER_TRIP);
    var share = Math.max(0, Math.min(100, (committed / C.INSTANT_MAX_PER_TRIP) * 100));
    resultEls.capFill.style.width = share.toFixed(1) + '%';
    resultEls.capFill.className = 'cap-fill' + (share >= 90 ? ' high' : '');
    resultEls.capText.textContent = won(committed) + ' of ' + won(C.INSTANT_MAX_PER_TRIP);
    resultEls.capNote.textContent = used > 0
      ? 'Includes ' + won(used) + ' you had already refunded in store this trip.'
      : 'Purchases refunded at the store, out of the ' + won(C.INSTANT_MAX_PER_TRIP) + ' trip limit.';

    // Breakdown
    resultEls.breakdown.innerHTML = '';
    res.receipts.forEach(function (r, i) {
      if (!r.amount) return;
      var li = document.createElement('li');

      var who = document.createElement('span');
      who.className = 'who';
      who.textContent = 'Receipt ' + (i + 1) + ' \u00B7 ' + won(r.amount);

      var amt = document.createElement('span');
      amt.className = 'amt';
      amt.textContent = r.refund ? won(r.refund) : 'No refund';

      li.appendChild(who);
      li.appendChild(amt);

      if (r.note) {
        var note = document.createElement('span');
        note.className = 'note warn';
        note.textContent = r.note;
        li.appendChild(note);
      } else if (r.refund) {
        var ok = document.createElement('span');
        ok.className = 'note';
        ok.textContent = pct(r.effectiveRate) + ' of what you paid' + (r.instantAllowed ? ' \u00B7 refund at the store' : ' \u00B7 claim at a counter or the airport');
        li.appendChild(ok);
      }

      if (r.nextTier && r.nextTier.gap > 0 && r.nextTier.gap <= 50000) {
        var tip = document.createElement('span');
        tip.className = 'tip';
        tip.textContent = 'Spend ' + won(r.nextTier.gap) + ' more on this receipt (' + won(r.nextTier.from) +
          ') and the refund becomes ' + won(r.nextTier.refund) + ' (+' + won(r.nextTier.gain) + ').';
        li.appendChild(tip);
      }

      resultEls.breakdown.appendChild(li);
    });

    resultEls.empty.hidden = hasInput;
    resultEls.copy.disabled = !hasInput;
  }

  // ---------- copy ----------
  resultEls.copy.addEventListener('click', function () {
    var fx = parseFloat(fxEl.value) || state.fx;
    var res = C.evaluate(state.receipts.map(function (r) { return { amount: r.amount || 0, method: r.method }; }),
      { instantUsed: C.toWon(instantUsedEl.value) });
    var lines = ['Korea tax refund estimate'];
    res.receipts.forEach(function (r, i) {
      if (!r.amount) return;
      lines.push('Receipt ' + (i + 1) + ': ' + won(r.amount) + ' \u2192 ' + (r.refund ? won(r.refund) : 'no refund') +
        (r.instantAllowed ? ' (refund at the store)' : ''));
    });
    lines.push('Total paid: ' + won(res.totals.paid));
    lines.push('VAT included: ' + won(res.totals.vat));
    lines.push('Estimated refund: ' + won(res.totals.refund) + ' (' + usd(res.totals.refund, fx) + '), ' + pct(res.totals.effectiveRate) + ' of the total');
    lines.push('Estimate from Global Tax Free\u2019s published table; your operator decides the final amount.');

    var text = lines.join('\n');
    var done = function () { toast('Summary copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  });

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  // ---------- wiring ----------
  addBtn.addEventListener('click', function () {
    if (state.receipts.length >= 20) { toast('20 receipts is the limit'); return; }
    state.receipts.push({ amount: '', method: 'later' });
    addRow(state.receipts[state.receipts.length - 1], state.receipts.length - 1);
    var inputs = receiptsEl.querySelectorAll('input');
    var last = inputs[inputs.length - 1];
    if (last) last.focus();
    update();
  });

  instantUsedEl.addEventListener('input', update);
  instantUsedEl.addEventListener('blur', function () {
    var v = C.toWon(instantUsedEl.value);
    instantUsedEl.value = v ? group(v) : '';
  });

  fxEl.addEventListener('input', function () {
    var v = parseFloat(fxEl.value);
    if (isFinite(v) && v > 0) { state.fx = v; savePrefs(); }
    update();
  });

  // Start
  loadPrefs();
  fxEl.value = state.fx;
  state.receipts.forEach(addRow);
  update();
})();
