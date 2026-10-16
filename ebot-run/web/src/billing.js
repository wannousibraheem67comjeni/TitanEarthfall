// Google Play Billing bridge.
//
// On Android the native layer (EbotNative JavascriptInterface, see BillingManager.java) talks
// to Google Play Billing Library and calls back into window.__ebotBilling. Rewards are granted
// only after Google Play reports a PURCHASED state; consumables are consumed (and one-time
// products acknowledged) only after the JS side has stored the grant, so a crash in between
// can never lose a purchase: unfinished purchases are re-delivered on the next launch and
// de-duplicated by purchase token.
//
// In a browser (web ZIP build / Artifact) there is no Google Play, so the store runs in a clearly
// labelled demo mode that grants items without any payment.
import { PRODUCTS } from './config.js';

const native = () => (typeof window !== 'undefined' ? window.EbotNative : null);

function product(id) { return PRODUCTS.find((p) => p.id === id); }

export const Billing = {
  mode: 'demo',          // 'play' | 'demo'
  ready: false,
  prices: {},            // productId -> localized price string from Google Play
  handlers: null,        // { grant(product, quantity, token), entitle(product, purchase), message(key) }
  demoConfirm: null,     // async (product) => boolean, provided by UI in demo mode

  init(handlers) {
    this.handlers = handlers;
    const n = native();
    window.__ebotBilling = {
      onReady: (ok) => this._onReady(ok),
      onProducts: (json) => this._onProducts(json),
      onPurchase: (json) => this._onPurchase(json),
      onPurchaseFailed: (code, msg) => this._onFailed(code, msg),
      onRestoreDone: (json) => this._onRestoreDone(json),
    };
    if (n && typeof n.billingInit === 'function') {
      this.mode = 'play';
      const inapp = PRODUCTS.filter((p) => p.type === 'inapp').map((p) => p.id);
      const subs = PRODUCTS.filter((p) => p.type === 'subs').map((p) => p.id);
      try { n.billingInit(JSON.stringify({ inapp, subs })); } catch (e) { console.warn('billingInit failed', e); }
    } else {
      this.mode = 'demo';
      this.ready = true;
    }
  },

  price(id) { return this.prices[id] || (product(id) ? product(id).price : ''); },

  async buy(id) {
    const p = product(id);
    if (!p) return;
    if (this.mode === 'play') {
      // When offline the native side answers 'unavailable' and reconnects in the background,
      // so the next tap works as soon as the device is back online.
      try { native().purchase(id); } catch (e) { this.handlers.message('purchaseFail', 'error'); }
      return;
    }
    // Demo mode (web): explicit confirmation, no payment collected.
    const ok = this.demoConfirm ? await this.demoConfirm(p) : true;
    if (!ok) return;
    const token = 'demo-' + id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    this._deliver({ productId: id, purchaseToken: token, state: 'purchased', quantity: 1, acknowledged: false, type: p.type, fresh: true });
  },

  restore() {
    if (this.mode === 'play') {
      try { native().restorePurchases(); } catch (e) { this.handlers.message('storeUnavailable', 'error'); }
    } else {
      this.handlers.message('restored', 'ok');
    }
  },

  _onReady(ok) {
    this.ready = !!ok;
    if (this.handlers.onReady) this.handlers.onReady(this.ready);
  },
  _onProducts(json) {
    try {
      const list = JSON.parse(json);
      for (const it of list) if (it.productId && it.price) this.prices[it.productId] = it.price;
    } catch (e) { console.warn('bad products json', e); }
    if (this.handlers.onPrices) this.handlers.onPrices();
  },
  _onPurchase(json) {
    let p;
    try { p = JSON.parse(json); } catch (e) { return; }
    this._deliver(p);
  },
  _onFailed(code, msg) {
    if (code === 'canceled') this.handlers.message('purchaseCancel', 'info');
    else if (code === 'unavailable') this.handlers.message('storeUnavailable', 'error');
    else this.handlers.message('purchaseFail', 'error', msg);
  },
  _onRestoreDone(json) {
    // json: { subsActive: ["ebot_club"], owned: ["starter_pack", ...] }
    let r = {};
    try { r = JSON.parse(json || '{}'); } catch (e) { /* ignore */ }
    if (this.handlers.onRestore) this.handlers.onRestore(r);
  },

  // Applies a purchase reported by Google Play (or by the demo store).
  _deliver(p) {
    const def = product(p.productId);
    if (!def) return;
    if (p.state === 'pending') { this.handlers.message('purchasePending', 'info'); return; }
    if (p.state !== 'purchased') return;
    const qty = Math.max(1, p.quantity || 1);
    const firstTime = this.handlers.grant(def, qty, p.purchaseToken, p);
    if (firstTime && p.fresh !== false) this.handlers.message('purchaseOk', 'ok');
    // Tell Google Play the purchase was delivered: consume consumables so they can be bought
    // again, acknowledge everything else (unacknowledged purchases are refunded after 3 days).
    if (this.mode === 'play') {
      if (def.consumable) native().finishPurchase(p.purchaseToken, true);
      else if (!p.acknowledged) native().finishPurchase(p.purchaseToken, false);
    }
  },
};
