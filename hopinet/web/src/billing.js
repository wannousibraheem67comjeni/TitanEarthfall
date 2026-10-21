// Google Play Billing bridge (real purchases only).
//
// On Android the native layer (HopinetNative JavascriptInterface, see BillingManager.java) talks
// to Google Play Billing Library and calls back into window.__hopinetBilling. Rewards are granted
// only after Google Play reports a PURCHASED state; consumables are consumed (and one-time
// products acknowledged) only after the JS side has stored the grant, so a crash in between
// can never lose a purchase: unfinished purchases are re-delivered on the next launch and
// de-duplicated by purchase token.
//
// Prices shown in the game come only from Google Play. Outside the Android app (web ZIP,
// Artifact) there is no Google Play, so nothing can be bought there and nothing is granted.
import { PRODUCTS } from './config.js';

const native = () => (typeof window !== 'undefined' ? window.HopinetNative : null);
// The "free" Android flavor ships without Google Play Billing: no store at all.
const isFreeFlavor = () => { const n = native(); try { return !!(n && n.flavor && n.flavor() === 'free'); } catch (e) { return false; } };

function product(id) { return PRODUCTS.find((p) => p.id === id); }

export const Billing = {
  mode: 'none',          // 'play' (Android play flavor) | 'none' (browser or free flavor: no purchases)
  free: false,           // true in the free Android flavor (the real-money store is hidden)
  connected: null,       // null = connecting, true/false = Google Play billing service answer
  prices: {},            // productId -> localized price string returned by Google Play
  answered: {},          // product type -> true once Google Play answered the product query
  missing: [],           // product IDs Google Play does not know (not set up in Play Console)
  queryErrors: {},       // product type -> error text from Google Play ('' = fine)
  periods: {},           // subscription productId -> ISO billing period from Google Play (e.g. P1M)
  handlers: null,        // { grant(product, quantity, token, purchase), message(key, kind) }

  init(handlers) {
    this.handlers = handlers;
    const n = native();
    window.__hopinetBilling = {
      onReady: (ok) => this._onReady(ok),
      onProducts: (json) => this._onProducts(json),
      onPurchase: (json) => this._onPurchase(json),
      onPurchaseFailed: (code, msg) => this._onFailed(code, msg),
      onRestoreDone: (json) => this._onRestoreDone(json),
    };
    this.free = isFreeFlavor();
    if (!this.free && n && typeof n.billingInit === 'function') {
      this.mode = 'play';
      const inapp = PRODUCTS.filter((p) => p.type === 'inapp').map((p) => p.id);
      const subs = PRODUCTS.filter((p) => p.type === 'subs').map((p) => p.id);
      try { n.billingInit(JSON.stringify({ inapp, subs })); } catch (e) { this.connected = false; }
    }
  },

  // True only when Google Play returned this product with a real price.
  available(id) { return this.mode === 'play' && this.connected === true && !!this.prices[id]; },
  price(id) { return this.prices[id] || ''; },

  // One honest word for the shop banner.
  status() {
    if (this.mode !== 'play') return 'web';
    if (this.connected === null) return 'connecting';
    if (this.connected === false || this.queryError()) return 'offline';
    const types = [...new Set(PRODUCTS.map((p) => p.type))];
    if (!types.every((ty) => this.answered[ty])) return 'connecting';
    if (!Object.keys(this.prices).length) return 'none';
    if (this.missing.length) return 'missing';
    return 'ok';
  },

  queryError() { return Object.values(this.queryErrors).filter(Boolean).join(' / '); },
  period(id) { return this.periods[id] || ''; },

  // Called when the shop opens: retry anything that failed (e.g. the game started offline).
  refresh() {
    if (this.mode !== 'play') return;
    const n = native();
    if (this.status() !== 'ok' && n && n.refreshProducts) { try { n.refreshProducts(); } catch (e) { /* ignore */ } }
  },

  buy(id) {
    if (!product(id)) return;
    if (this.mode !== 'play') { this.handlers.message('storeAndroidOnly', 'info'); return; }
    if (!this.available(id)) {
      this.refresh();
      this.handlers.message(this.missing.includes(id) || this.status() === 'none' ? 'productMissing' : 'storeUnavailable', 'error');
      return;
    }
    try { native().purchase(id); } catch (e) { this.handlers.message('purchaseFail', 'error'); }
  },

  restore() {
    if (this.mode !== 'play') { this.handlers.message('storeAndroidOnly', 'info'); return; }
    try { native().restorePurchases(); } catch (e) { this.handlers.message('storeUnavailable', 'error'); }
  },

  _onReady(ok) {
    this.connected = !!ok;
    if (ok) { this.queryErrors = {}; this.answered = {}; } // wait for Google's fresh answer
    if (this.handlers.onPrices) this.handlers.onPrices();
  },
  _onProducts(json) {
    let r;
    try { r = JSON.parse(json); } catch (e) { return; }
    if (!r || !r.type) return;
    this.answered[r.type] = true;
    if (!r.ok) {
      this.queryErrors[r.type] = r.type + ': ' + (r.error || 'error');
    } else {
      this.queryErrors[r.type] = '';
      const ofType = PRODUCTS.filter((p) => p.type === r.type).map((p) => p.id);
      this.missing = this.missing.filter((id) => !ofType.includes(id));
      for (const it of r.products || []) {
        if (it.productId && it.price) this.prices[it.productId] = it.price;
        if (it.productId && it.period) this.periods[it.productId] = it.period;
      }
      for (const m of r.missing || []) if (m.productId && !this.missing.includes(m.productId)) this.missing.push(m.productId);
      // A product Google Play did not mention at all is missing as well.
      for (const id of ofType) if (!this.prices[id] && !this.missing.includes(id)) this.missing.push(id);
    }
    if (this.handlers.onPrices) this.handlers.onPrices();
  },
  _onPurchase(json) {
    let p;
    try { p = JSON.parse(json); } catch (e) { return; }
    this._deliver(p);
  },
  _onFailed(code, msg) {
    // 'owned' means an earlier purchase is being re-delivered; the same failure can also be
    // reported twice (launch result + listener), so repeats within 1.5 s are dropped.
    if (code === 'owned') return;
    const now = Date.now();
    if (this._lastFail === code && now - this._lastFailAt < 1500) return;
    this._lastFail = code; this._lastFailAt = now;
    if (code === 'canceled') this.handlers.message('purchaseCancel', 'info');
    else if (code === 'unavailable') this.handlers.message('storeUnavailable', 'error');
    else if (code === 'item_unavailable') this.handlers.message('productMissing', 'error');
    else this.handlers.message('purchaseFail', 'error', msg);
  },
  _onRestoreDone(json) {
    // json: { ok, manual, subsActive: ["hopinet_club"], owned: ["starter_pack", ...] }
    let r = {};
    try { r = JSON.parse(json || '{}'); } catch (e) { /* ignore */ }
    if (this.handlers.onRestore) this.handlers.onRestore(r);
  },

  // Applies a purchase reported by Google Play. This is the only place rewards for real money
  // are granted.
  _deliver(p) {
    if (this.mode !== 'play') return;
    const def = product(p.productId);
    if (!def) return;
    if (p.state === 'pending') { this.handlers.message('purchasePending', 'info'); return; }
    if (p.state !== 'purchased') return;
    const qty = Math.max(1, p.quantity || 1);
    const firstTime = this.handlers.grant(def, qty, p.purchaseToken, p);
    if (firstTime && p.fresh !== false) this.handlers.message('purchaseOk', 'ok');
    // Tell Google Play the purchase was delivered: consume consumables so they can be bought
    // again, acknowledge everything else (unacknowledged purchases are refunded after 3 days).
    if (def.consumable) native().finishPurchase(p.purchaseToken, true);
    else if (!p.acknowledged) native().finishPurchase(p.purchaseToken, false);
  },
};
