package com.elevo.hopinet;

import android.app.Activity;
import android.content.Context;

/** "free" edition: no billing library, no BILLING permission, nothing to buy. */
final class BillingFactory {
    private BillingFactory() {
    }

    static BillingController create(Context context, JsSink js) {
        return new NoBilling();
    }

    private static final class NoBilling implements BillingController {
        @Override public void init(String productsJson) { }
        @Override public void launchPurchase(Activity activity, String productId) { }
        @Override public void finish(String purchaseToken, boolean consume) { }
        @Override public void refreshProducts() { }
        @Override public void queryPurchases(boolean manual) { }
        @Override public void onResume() { }
        @Override public void destroy() { }
    }
}
