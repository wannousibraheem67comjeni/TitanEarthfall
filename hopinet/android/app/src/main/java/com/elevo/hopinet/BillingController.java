package com.elevo.hopinet;

import android.app.Activity;

/**
 * What the game bridge needs from a billing backend. The "play" flavor implements it with Google
 * Play Billing; the "free" flavor ships a no-op implementation and does not even contain the
 * billing library or the BILLING permission.
 */
public interface BillingController {
    void init(String productsJson);

    void launchPurchase(Activity activity, String productId);

    void finish(String purchaseToken, boolean consume);

    void refreshProducts();

    void queryPurchases(boolean manual);

    void onResume();

    void destroy();
}
