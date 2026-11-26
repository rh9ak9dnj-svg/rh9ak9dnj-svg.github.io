/*
 * WonBack — Korea tax refund calculation core
 * Pure functions only: no DOM, no network. Safe to unit test in Node.
 *
 * Rule sources (checked 27 Nov 2026):
 *  - VAT included in a Korean retail price = 10/110 = 1/11 of the price (VAT Act art. 30)
 *  - Minimum purchase per receipt: KRW 15,000
 *  - Immediate (in-store) refund: each purchase under KRW 1,000,000;
 *    all immediate refunds in one trip KRW 5,000,000 or less
 *  - Refund through an agent (downtown counter): KRW 6,000,000 or less per receipt
 *  - Goods must leave Korea within 3 months of purchase
 *  - Refund amounts per price tier: Global Tax Free (GTF) published table, checked Oct 2026.
 *    Other operators (Global Blue, CubeRefund, Easy Tax Refund, NICE) publish their own
 *    tables, so the paid amount can differ by a few percent.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WonBackCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MIN_PURCHASE = 15000;
  var INSTANT_MAX_PER_PURCHASE = 1000000;
  var INSTANT_MAX_PER_TRIP = 5000000;
  var AGENT_MAX_PER_RECEIPT = 6000000;

  // [from, to, refund] in KRW — Global Tax Free published table
  var GTF_TIERS = [
    [15000, 29999, 1000],
    [30000, 49999, 2000],
    [50000, 74999, 3000],
    [75000, 99999, 5000],
    [100000, 124999, 7000],
    [125000, 149999, 8000],
    [150000, 174999, 9000],
    [175000, 199999, 10000],
    [200000, 224999, 12000],
    [225000, 249999, 13000],
    [250000, 274999, 15000],
    [275000, 299999, 17000],
    [300000, 324999, 19000],
    [325000, 349999, 21000],
    [350000, 374999, 23000],
    [375000, 399999, 25000],
    [400000, 424999, 27000],
    [425000, 449999, 28000],
    [450000, 474999, 30000],
    [475000, 499999, 32000],
    [500000, 549999, 35000],
    [550000, 599999, 37000],
    [600000, 649999, 41000],
    [650000, 699999, 45000],
    [700000, 749999, 50000],
    [750000, 799999, 53000],
    [800000, 849999, 57000],
    [850000, 899999, 60000],
    [900000, 949999, 65000],
    [950000, 999999, 68000],
    [1000000, 1099999, 75000],
    [1100000, 1199999, 80000],
    [1200000, 1299999, 90000],
    [1300000, 1399999, 95000],
    [1400000, 1499999, 105000],
    [1500000, 1599999, 110000],
    [1600000, 1699999, 115000],
    [1700000, 1799999, 127000],
    [1800000, 1899999, 135000],
    [1900000, 1999999, 140000],
    [2000000, 2099999, 150000],
    [2100000, 2199999, 155000],
    [2200000, 2299999, 160000],
    [2300000, 2399999, 170000],
    [2400000, 2499999, 177000],
    [2500000, 2599999, 185000],
    [2600000, 2699999, 190000],
    [2700000, 2799999, 200000],
    [2800000, 2899999, 210000],
    [2900000, 2999999, 215000],
    [3000000, 3099999, 225000],
    [3100000, 3199999, 230000],
    [3200000, 3299999, 235000],
    [3300000, 3399999, 240000],
    [3400000, 3499999, 250000],
    [3500000, 3599999, 260000],
    [3600000, 3699999, 270000],
    [3700000, 3799999, 280000],
    [3800000, 3899999, 285000],
    [3900000, 3999999, 290000],
    [4000000, 4099999, 300000],
    [4100000, 4199999, 310000],
    [4200000, 4299999, 315000],
    [4300000, 4399999, 320000],
    [4400000, 4499999, 333000],
    [4500000, 4599999, 340000],
    [4600000, 4699999, 350000],
    [4700000, 4799999, 360000],
    [4800000, 4899999, 370000],
    [4900000, 4999999, 380000],
    [5000000, 5099999, 390000],
    [5100000, 5199999, 400000],
    [5200000, 5299999, 410000],
    [5300000, 5399999, 420000],
    [5400000, 5499999, 430000],
    [5500000, 5599999, 440000],
    [5600000, 5699999, 450000],
    [5700000, 5799999, 460000],
    [5800000, 5899999, 470000],
    [5900000, 5999999, 480000]
  ];

  var VAT_RATE_INCLUDED = 10 / 110; // 1/11
  var BIG_PURCHASE_SHARE = 0.9;     // 6,000,000 and up: 90% of the VAT

  function toWon(value) {
    var s = String(value == null ? '' : value).trim();
    if (s.charAt(0) === '-') return 0;
    var n = Number(s.replace(/[^0-9.]/g, ''));
    if (!isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }

  function vatOf(amount) {
    return Math.floor(toWon(amount) * VAT_RATE_INCLUDED);
  }

  /** Refund estimate for one receipt, from the GTF tier table. 0 below the minimum. */
  function estimateRefund(amount) {
    var won = toWon(amount);
    if (won < MIN_PURCHASE) return 0;
    if (won >= 6000000) return Math.floor(vatOf(won) * BIG_PURCHASE_SHARE);
    for (var i = 0; i < GTF_TIERS.length; i++) {
      var t = GTF_TIERS[i];
      if (won >= t[0] && won <= t[1]) return t[2];
    }
    return 0;
  }

  /** The next tier that pays more, or null. */
  function nextTier(amount) {
    var won = toWon(amount);
    if (won < MIN_PURCHASE) {
      return { from: MIN_PURCHASE, refund: estimateRefund(MIN_PURCHASE), gap: MIN_PURCHASE - won, gain: estimateRefund(MIN_PURCHASE) };
    }
    if (won >= 6000000) return null;
    var current = estimateRefund(won);
    for (var i = 0; i < GTF_TIERS.length; i++) {
      var t = GTF_TIERS[i];
      if (won >= t[0] && won <= t[1]) {
        var next = GTF_TIERS[i + 1];
        if (!next) return null;
        if (next[2] <= current) return null;
        return { from: next[0], refund: next[2], gap: next[0] - won, gain: next[2] - current };
      }
    }
    return null;
  }

  /**
   * Evaluate a whole trip.
   * receipts: [{ amount: number, method: 'instant'|'later' }]
   * options:  { instantUsed: number }
   */
  function evaluate(receipts, options) {
    options = options || {};
    var instantUsed = toWon(options.instantUsed || 0);
    var running = instantUsed;
    var out = [];
    var totals = { paid: 0, vat: 0, refund: 0 };

    (receipts || []).forEach(function (r, index) {
      var amount = toWon(r.amount);
      var wantsInstant = r.method === 'instant';
      var eligible = amount >= MIN_PURCHASE;
      var refund = estimateRefund(amount);
      var vat = vatOf(amount);
      var instantAllowed = false;
      var reason = '';

      if (!eligible) {
        reason = 'Below the KRW 15,000 minimum for one receipt.';
      } else if (wantsInstant) {
        if (amount >= INSTANT_MAX_PER_PURCHASE) {
          reason = 'KRW 1,000,000 or more cannot be refunded in store. Claim it at a refund counter or the airport kiosk.';
        } else if (running + amount > INSTANT_MAX_PER_TRIP) {
          reason = 'This would push your instant refunds past the KRW 5,000,000 trip limit. Claim it later instead.';
        } else {
          instantAllowed = true;
        }
      } else if (amount > AGENT_MAX_PER_RECEIPT) {
        reason = 'Over KRW 6,000,000 is above the per-receipt agent limit. Use the airport kiosk and customs desk.';
      }

      if (eligible && wantsInstant && instantAllowed) running += amount;

      var tier = eligible ? nextTier(amount) : null;

      totals.paid += amount;
      totals.vat += vat;
      totals.refund += refund;

      out.push({
        index: index,
        amount: amount,
        method: wantsInstant ? 'instant' : 'later',
        eligible: eligible,
        vat: vat,
        refund: refund,
        effectiveRate: amount > 0 ? (refund / amount) * 100 : 0,
        instantAllowed: instantAllowed,
        needsCounter: eligible && !instantAllowed,
        note: reason,
        nextTier: tier
      });
    });

    totals.effectiveRate = totals.paid > 0 ? (totals.refund / totals.paid) * 100 : 0;
    totals.instantCommitted = running;
    totals.instantRemaining = Math.max(0, INSTANT_MAX_PER_TRIP - running);

    return { receipts: out, totals: totals, limits: {
      minPurchase: MIN_PURCHASE,
      instantMaxPerPurchase: INSTANT_MAX_PER_PURCHASE,
      instantMaxPerTrip: INSTANT_MAX_PER_TRIP,
      agentMaxPerReceipt: AGENT_MAX_PER_RECEIPT
    } };
  }

  return {
    MIN_PURCHASE: MIN_PURCHASE,
    INSTANT_MAX_PER_PURCHASE: INSTANT_MAX_PER_PURCHASE,
    INSTANT_MAX_PER_TRIP: INSTANT_MAX_PER_TRIP,
    AGENT_MAX_PER_RECEIPT: AGENT_MAX_PER_RECEIPT,
    GTF_TIERS: GTF_TIERS,
    toWon: toWon,
    vatOf: vatOf,
    estimateRefund: estimateRefund,
    nextTier: nextTier,
    evaluate: evaluate
  };
});
